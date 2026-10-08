import { announcePurchase, DEDUPE_WINDOW_MS, handleBotInput } from "@denarii/core";
import { schema } from "@denarii/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GALICIA_PURCHASE, setup } from "./test-harness";

const PICKER_EMPTY = [["Más…", "➕ Nueva categoría"], ["Omitir"]];

type Harness = ReturnType<typeof setup>;

async function ingestPurchase(
  h: Harness,
  merchant = "AXION VILLA ALLENDE",
  title = "Pagaste $100",
) {
  await h.ingest({
    ...GALICIA_PURCHASE,
    title,
    text: `A ${merchant} con tu Visa Crédito 3551 a las 22:32`,
  });
  await h.settled();
  // The next same-amount purchase must fall outside the dedupe window.
  h.clock.current = new Date(h.clock.current.getTime() + DEDUPE_WINDOW_MS + 1000);
  return h.messages.at(-1);
}

/** Creates "Fuel (Transport)" through ➕ New category / ➕ New group on a fresh purchase. */
async function createFuelThroughPicker(h: Harness) {
  const picker = await ingestPurchase(h);
  await h.tap(picker, "➕ Nueva categoría");
  await h.say("Fuel");
  await h.tap(h.messages.at(-1), "➕ Nuevo grupo");
  await h.say("Transport");
  return picker;
}

function purchases(h: Harness) {
  return h.db.select().from(schema.purchases).all();
}

function merchantRules(h: Harness) {
  return h.db
    .select({
      merchant: schema.merchantRules.merchantNormalized,
      category: schema.categories.name,
    })
    .from(schema.merchantRules)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.merchantRules.categoryId))
    .all();
}

/** Seeds categories, each with `uses` categorized purchases at `occurredAt`. */
async function seedCategories(
  h: Harness,
  entries: { name: string; group: string; uses?: number; occurredAt?: string }[],
) {
  const { store } = h.runtime;
  const user = await store.ensureUser({ telegramChatId: "42", locale: "es", timezone: "UTC" });
  for (const { name, group, uses = 0, occurredAt = "2026-10-01T12:00:00.000Z" } of entries) {
    const category = await store.createCategory(
      user.id,
      name,
      (await store.ensureGroup(user.id, group)).id,
    );
    for (let i = 0; i < uses; i++) {
      h.db
        .insert(schema.purchases)
        .values({
          userId: user.id,
          kind: "purchase",
          status: "categorized",
          occurredAt,
          amountMinor: 100,
          currency: "ARS",
          merchantRaw: `SEED ${name}`,
          merchantNormalized: `SEED ${name}`,
          categoryId: category.id,
          categorizedBy: "user",
        })
        .run();
    }
  }
}

describe("category picker", () => {
  it("shows the picker when no merchant rule matches", async () => {
    const h = setup();
    const picker = await ingestPurchase(h);
    expect(picker?.text).toBe(
      "🛒 $100,00 ARS · AXION VILLA ALLENDE\nGalicia Visa Crédito 3551 · 22:32",
    );
    expect(h.buttons(picker)).toEqual(PICKER_EMPTY);
    expect(purchases(h)[0]).toMatchObject({
      status: "pending",
      telegramMessageId: picker?.messageId,
    });
  });

  it("creates a category and a group, applies them and creates the merchant rule", async () => {
    const h = setup();
    const picker = await ingestPurchase(h);
    await h.tap(picker, "➕ Nueva categoría");
    expect(h.messages.at(-1)?.text).toBe("¿Nombre de la nueva categoría para AXION VILLA ALLENDE?");

    await h.say("  Fuel ");
    const groupPrompt = h.messages.at(-1);
    expect(groupPrompt?.text).toBe(
      "¿A qué grupo pertenece Fuel? Tocá uno o escribí un nombre nuevo.",
    );
    expect(h.buttons(groupPrompt)).toEqual([["➕ Nuevo grupo"]]);

    await h.tap(groupPrompt, "➕ Nuevo grupo");
    expect(h.messages.at(-1)?.text).toBe("¿Nombre del nuevo grupo para Fuel?");
    await h.say("Transport");

    const [category] = h.db.select().from(schema.categories).all();
    const [group] = h.db.select().from(schema.groups).all();
    expect(category).toMatchObject({ name: "Fuel", groupId: group?.id });
    expect(group?.name).toBe("Transport");
    expect(purchases(h)[0]).toMatchObject({
      status: "categorized",
      categoryId: category?.id,
      categorizedBy: "user",
    });
    expect(merchantRules(h)).toEqual([{ merchant: "AXION VILLA ALLENDE", category: "Fuel" }]);
    expect(h.message(picker?.messageId)).toMatchObject({
      text: "✅ $100,00 ARS · AXION VILLA ALLENDE\nFuel (Transport) · Galicia Visa Crédito 3551 · 22:32",
    });
    expect(h.buttons(picker)).toEqual([["Cambiar"]]);
  });

  it("offers existing groups for a new category", async () => {
    const h = setup();
    await createFuelThroughPicker(h);
    const picker = await ingestPurchase(h, "YPF RUTA 9");
    await h.tap(picker, "➕ Nueva categoría");
    await h.say("Parking");
    const groupPrompt = h.messages.at(-1);
    expect(h.buttons(groupPrompt)).toEqual([["Transport"], ["➕ Nuevo grupo"]]);
    await h.tap(groupPrompt, "Transport");

    expect(h.message(groupPrompt?.messageId)).toMatchObject({ text: "✅ Parking (Transport)" });
    expect(h.message(groupPrompt?.messageId)?.keyboard).toBeUndefined();
    expect(h.db.select().from(schema.groups).all()).toHaveLength(1);
    expect(h.message(picker?.messageId)?.text).toContain("Parking (Transport)");
    expect(merchantRules(h)).toContainEqual({ merchant: "YPF RUTA 9", category: "Parking" });
  });

  it("accepts a typed group name while group buttons are shown", async () => {
    const h = setup();
    await createFuelThroughPicker(h);
    const picker = await ingestPurchase(h, "PEDIDOSYA");
    await h.tap(picker, "➕ Nueva categoría");
    await h.say("Delivery");
    await h.say("Food");
    expect(h.message(picker?.messageId)?.text).toContain("Delivery (Food)");
  });

  it("reuses an existing category typed with different case", async () => {
    const h = setup();
    await createFuelThroughPicker(h);
    const picker = await ingestPurchase(h, "YPF RUTA 9");
    await h.tap(picker, "➕ Nueva categoría");
    await h.say("fuel");
    expect(h.db.select().from(schema.categories).all()).toHaveLength(1);
    expect(h.message(picker?.messageId)?.text).toContain("Fuel (Transport)");
  });

  it("rejects names that are too long and keeps waiting", async () => {
    const h = setup();
    const picker = await ingestPurchase(h);
    await h.tap(picker, "➕ Nueva categoría");
    await h.say("x".repeat(41));
    expect(h.messages.at(-1)?.text).toBe("Demasiado largo. Usá como máximo 40 caracteres.");
    await h.say("Fuel");
    expect(h.messages.at(-1)?.text).toContain("¿A qué grupo pertenece Fuel?");
  });

  it("categorizes a later purchase from the same merchant automatically", async () => {
    const h = setup();
    await createFuelThroughPicker(h);
    const confirmation = await ingestPurchase(h, "AXION  villa allende", "Pagaste $2.500");
    expect(confirmation).toMatchObject({
      text: "✅ $2.500,00 ARS · AXION villa allende\nFuel (Transport) · Galicia Visa Crédito 3551 · 22:32",
    });
    expect(h.buttons(confirmation)).toEqual([["Cambiar"]]);
    expect(purchases(h)[1]).toMatchObject({
      status: "categorized",
      categorizedBy: "rule",
      telegramMessageId: confirmation?.messageId,
    });
  });

  it("Change reopens the picker and updates the purchase and the merchant rule", async () => {
    const h = setup();
    await createFuelThroughPicker(h);
    await seedCategories(h, [{ name: "Car wash", group: "Transport", uses: 1 }]);
    const confirmation = await ingestPurchase(h);

    await h.tap(confirmation, "Cambiar");
    expect(h.message(confirmation?.messageId)?.text).toMatch(/^🛒 /);
    await h.tap(confirmation, "Car wash");

    expect(h.message(confirmation?.messageId)?.text).toContain("Car wash (Transport)");
    const carWash = h.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.name, "Car wash"))
      .get();
    expect(purchases(h).at(-1)).toMatchObject({ categoryId: carWash?.id, categorizedBy: "user" });
    expect(merchantRules(h)).toEqual([{ merchant: "AXION VILLA ALLENDE", category: "Car wash" }]);
  });

  it("shows the top 6 categories by use in the last 90 days", async () => {
    const h = setup();
    await seedCategories(h, [
      { name: "Groceries", group: "Food", uses: 5 },
      { name: "Delivery", group: "Food", uses: 4 },
      { name: "Fuel", group: "Transport", uses: 3 },
      { name: "Restaurants", group: "Food", uses: 2 },
      { name: "Pharmacy", group: "Health", uses: 1 },
      { name: "Coffee", group: "Food", uses: 1 },
      { name: "Cinema", group: "Leisure", uses: 9, occurredAt: "2026-06-01T12:00:00.000Z" },
      { name: "Books", group: "Leisure" },
    ]);
    const picker = await ingestPurchase(h);
    expect(h.buttons(picker)).toEqual([
      ["Groceries", "Delivery", "Fuel"],
      ["Restaurants", "Coffee", "Pharmacy"],
      ...PICKER_EMPTY,
    ]);
  });

  it("More… lists every category grouped and paginated", async () => {
    const h = setup();
    const names = Array.from({ length: 14 }, (_, i) => `Cat ${String(i).padStart(2, "0")}`);
    await seedCategories(h, [
      ...names.slice(0, 10).map((name) => ({ name, group: "A" })),
      ...names.slice(10).map((name) => ({ name, group: "B" })),
    ]);
    const picker = await ingestPurchase(h);

    await h.tap(picker, "Más…");
    expect(h.buttons(picker)).toEqual([
      ["— A —"],
      ["Cat 00", "Cat 01", "Cat 02"],
      ["Cat 03", "Cat 04", "Cat 05"],
      ["Cat 06", "Cat 07", "Cat 08"],
      ["Cat 09"],
      ["— B —"],
      ["Cat 10", "Cat 11"],
      ["« Volver", "›"],
      ["➕ Nueva categoría"],
    ]);

    await h.tap(picker, "— A —");
    await h.tap(picker, "›");
    expect(h.buttons(picker)).toEqual([
      ["— B —"],
      ["Cat 12", "Cat 13"],
      ["‹", "« Volver"],
      ["➕ Nueva categoría"],
    ]);

    await h.tap(picker, "Cat 13");
    expect(h.message(picker?.messageId)?.text).toContain("Cat 13 (B)");

    await h.tap(picker, "Cambiar");
    await h.tap(picker, "Más…");
    await h.tap(picker, "« Volver");
    expect(h.buttons(picker)?.slice(-2)).toEqual(PICKER_EMPTY);
  });

  it("Skip leaves the purchase pending and removes the buttons", async () => {
    const h = setup();
    const picker = await ingestPurchase(h);
    await h.tap(picker, "Omitir");
    expect(h.message(picker?.messageId)?.keyboard).toBeUndefined();
    expect(h.toasts.at(-1)).toBe("Omitida. Queda pendiente.");
    expect(purchases(h)[0]?.status).toBe("pending");
  });

  it("expires the free-text state", async () => {
    const h = setup();
    const picker = await ingestPurchase(h);
    await h.tap(picker, "➕ Nueva categoría");
    await h.say("Fuel");
    const groupPrompt = h.messages.at(-1);

    h.clock.current = new Date(h.clock.current.getTime() + 16 * 60_000);
    const count = h.messages.length;
    await h.say("Transport");
    expect(h.messages).toHaveLength(count);
    await h.tap(groupPrompt, "➕ Nuevo grupo");
    expect(h.toasts.at(-1)).toBe("Esto expiró. Abrí el selector de nuevo.");
    expect(h.db.select().from(schema.categories).all()).toHaveLength(0);
    expect(purchases(h)[0]?.status).toBe("pending");
  });

  it("ignores button taps from other chats", async () => {
    const h = setup();
    const picker = await ingestPurchase(h);
    await h.tap(picker, "➕ Nueva categoría", 7);
    expect(h.messages).toHaveLength(1);
    expect(h.toasts).toHaveLength(0);
  });

  it("never matches or creates a merchant rule for merchant Unknown", async () => {
    const h = setup();
    const { store } = h.runtime;
    await seedCategories(h, [{ name: "Fuel", group: "Transport" }]);
    const user = await store.ensureUser({ telegramChatId: "42", locale: "es", timezone: "UTC" });
    const fuel = await store.findCategoryByName(user.id, "Fuel");
    const unknown = {
      userId: user.id,
      kind: "purchase",
      occurredAt: new Date("2026-10-07T01:00:00Z"),
      amountMinor: 1999000,
      currency: "ARS",
      merchantRaw: "Unknown",
      merchantNormalized: "UNKNOWN",
      paymentMethodId: null,
    } as const;
    const insert = async (amountMinor: number) => {
      const event = await store.insertEvent({
        userId: user.id,
        app: "",
        title: "",
        text: "",
        receivedAt: unknown.occurredAt,
      });
      const window = { from: unknown.occurredAt, to: unknown.occurredAt };
      const inserted = await store.insertPurchase(
        { ...unknown, amountMinor, sourceEventId: event.id },
        window,
      );
      return inserted.purchase;
    };
    const purchase = await insert(unknown.amountMinor);

    await announcePurchase(h.runtime, user, purchase);
    const picker = h.messages.at(-1);
    expect(picker?.text).toBe("🛒 $19.990,00 ARS · Unknown\n01:00");
    const pick = picker?.keyboard?.[0]?.[0];
    await handleBotInput(h.runtime, user, {
      kind: "callback",
      callbackId: "1",
      messageId: picker?.messageId ?? 0,
      data: pick?.data ?? "",
    });
    expect(purchases(h).at(-1)).toMatchObject({ status: "categorized", categoryId: fuel?.id });
    expect(merchantRules(h)).toEqual([]);

    await store.upsertMerchantRule(user.id, "UNKNOWN", fuel?.id ?? 0, "user");
    const second = await insert(500);
    await announcePurchase(h.runtime, user, second);
    expect(h.messages.at(-1)?.text).toMatch(/^🛒 /);
    expect(purchases(h).at(-1)?.status).toBe("pending");
  });
});
