import { type ImportPlan, planImport, type RawImportRow } from "@denarii/core";
import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { buildImportSql } from "./import";
import * as schema from "./schema";
import { createStore } from "./store";
import { createTestDatabase } from "./testing";

const USER = { telegramChatId: "42", locale: "en" as const, timezone: "America/Argentina/Cordoba" };

function row(line: number, values: Record<string, unknown> = {}): RawImportRow {
  return {
    line,
    values: {
      date: "2026-09-14",
      time: "22:32",
      merchant: "AXION VILLA ALLENDE",
      amount: "15000.01",
      currency: "ARS",
      payment_method: "Galicia Visa Crédito 3551",
      category: "Fuel",
      group: "Transport",
      ...values,
    },
  };
}

function plan(rows: RawImportRow[]): ImportPlan {
  const result = planImport(rows, { timezone: USER.timezone });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.plan;
}

describe("buildImportSql", () => {
  let db: ReturnType<typeof createTestDatabase>;
  const run = (p: ImportPlan) => db.$client.exec(buildImportSql(p, USER).join("\n"));
  const purchases = () =>
    db.select().from(schema.purchases).orderBy(asc(schema.purchases.id)).all();

  beforeEach(() => {
    db = createTestDatabase();
  });

  it("creates the user, taxonomy, payment methods and categorized purchases", async () => {
    run(
      plan([
        row(2, { comment: "it's full" }),
        row(3, {
          merchant: "Rappi",
          amount: "8500",
          payment_method: "Mercado Pago cuenta",
          category: "Delivery",
          group: "Food",
          time: undefined,
        }),
      ]),
    );

    const store = createStore(db);
    const user = await store.ensureUser(USER);
    expect((await store.listCategories(user.id)).map((c) => [c.name, c.group.name])).toEqual([
      ["Delivery", "Food"],
      ["Fuel", "Transport"],
    ]);
    expect(
      db
        .select()
        .from(schema.paymentMethods)
        .all()
        .map((p) => p.label),
    ).toEqual(["Galicia Visa Crédito 3551", "Mercado Pago cuenta"]);

    const [fuel, delivery] = purchases();
    expect(fuel).toMatchObject({
      userId: user.id,
      kind: "purchase",
      status: "categorized",
      categorizedBy: "import",
      source: "import",
      occurredAt: "2026-09-15T01:32:00.000Z",
      amountMinor: 1500001,
      currency: "ARS",
      merchantRaw: "AXION VILLA ALLENDE",
      merchantNormalized: "AXION VILLA ALLENDE",
      comment: "it's full",
      sourceEventId: null,
      telegramMessageId: null,
    });
    expect((await store.getPurchase(user.id, fuel?.id ?? 0))?.paymentMethod).toBe(
      "Galicia Visa Crédito 3551",
    );
    expect(delivery).toMatchObject({ occurredAt: "2026-09-14T03:00:00.000Z", comment: null });
    expect((await store.getCategory(user.id, delivery?.categoryId ?? 0))?.name).toBe("Delivery");
  });

  it("creates merchant rules only for single-category merchants", async () => {
    run(
      plan([
        row(2),
        row(3, { merchant: "COTO", category: "Groceries", group: "Food" }),
        row(4, { merchant: "COTO", category: "Pharmacy", group: "Health" }),
      ]),
    );
    const store = createStore(db);
    const user = await store.ensureUser(USER);
    expect((await store.findMerchantRule(user.id, "AXION VILLA ALLENDE"))?.name).toBe("Fuel");
    expect(await store.findMerchantRule(user.id, "COTO")).toBeNull();
    expect(db.select().from(schema.merchantRules).all()).toMatchObject([{ source: "import" }]);
  });

  it("is idempotent: re-importing skips existing rows and keeps repeated ones", () => {
    const rows = [row(2), row(3), row(4, { date: "2026-09-15", time: "10:00" })];
    run(plan(rows));
    run(plan(rows));
    expect(purchases()).toHaveLength(3);
    expect(db.select().from(schema.groups).all()).toHaveLength(1);
    expect(db.select().from(schema.categories).all()).toHaveLength(1);
    expect(db.select().from(schema.merchantRules).all()).toHaveLength(1);

    // Same local day at another time still matches; a third identical row is new.
    run(plan([row(2, { time: "08:00" }), row(3), row(4), row(5, { currency: "USD" })]));
    expect(purchases()).toHaveLength(5);
  });

  it("does not count live purchases as existing imports", async () => {
    const store = createStore(db);
    const user = await store.ensureUser(USER);
    await db.insert(schema.purchases).values({
      userId: user.id,
      kind: "purchase",
      occurredAt: "2026-09-15T01:32:00.000Z",
      amountMinor: 1500001,
      currency: "ARS",
      merchantRaw: "AXION VILLA ALLENDE",
      merchantNormalized: "AXION VILLA ALLENDE",
    });
    run(plan([row(2)]));
    expect(purchases()).toHaveLength(2);
  });

  it("reuses existing taxonomy by name and keeps user merchant rules and settings", async () => {
    const store = createStore(db);
    const user = await store.ensureUser({ ...USER, locale: "es", timezone: "UTC" });
    const car = await store.ensureGroup(user.id, "Car");
    const fuel = await store.createCategory(user.id, "fuel", car.id);
    const coffee = await store.createCategory(user.id, "Coffee", car.id);
    await store.upsertMerchantRule(user.id, "AXION VILLA ALLENDE", coffee.id, "user");

    run(plan([row(2, { category: "Fuel", group: "transport" })]));

    expect(await store.listCategories(user.id)).toEqual([
      { id: coffee.id, name: "Coffee", group: car },
      { id: fuel.id, name: "fuel", group: car },
    ]);
    expect(purchases()[0]?.categoryId).toBe(fuel.id);
    expect((await store.findMerchantRule(user.id, "AXION VILLA ALLENDE"))?.id).toBe(coffee.id);
    expect(db.select().from(schema.users).all()).toMatchObject([{ locale: "es", timezone: "UTC" }]);
  });

  it("updates merchant rules from an earlier import", async () => {
    run(plan([row(2)]));
    run(plan([row(2, { category: "Gas", group: "Transport" })]));
    const store = createStore(db);
    const user = await store.ensureUser(USER);
    expect((await store.findMerchantRule(user.id, "AXION VILLA ALLENDE"))?.name).toBe("Gas");
  });

  it("stores quotes and SQL-looking text verbatim", () => {
    const merchant = `O'Hara's "Pub"; DROP TABLE purchases; --`;
    run(plan([row(2, { merchant, comment: "a;b\n'c'" })]));
    expect(purchases()).toMatchObject([{ merchantRaw: merchant, comment: "a;b\n'c'" }]);
  });
});
