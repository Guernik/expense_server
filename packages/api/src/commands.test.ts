import { DEDUPE_WINDOW_MS } from "@denarii/core";
import { schema } from "@denarii/db";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GALICIA_PURCHASE, setup } from "./test-harness";

type Harness = ReturnType<typeof setup>;

const purchases = (h: Harness) => h.db.select().from(schema.purchases).all();

/** Ingests a Galicia card purchase and returns the bot's message for it. */
async function ingestPurchase(h: Harness, merchant: string, title = "Pagaste $100") {
  await h.ingest({
    ...GALICIA_PURCHASE,
    title,
    text: `A ${merchant} con tu Visa Crédito 3551 a las 22:32`,
  });
  await h.settled();
  // The next purchase must fall outside the dedupe window.
  h.clock.current = new Date(h.clock.current.getTime() + DEDUPE_WINDOW_MS + 1000);
  return h.messages.at(-1);
}

async function ingestTransfer(h: Harness, title = "Transferiste: $300.000") {
  await h.ingest({ app: "Galicia", title, text: "La transferencia ya está en la cuenta." });
  await h.settled();
  h.clock.current = new Date(h.clock.current.getTime() + DEDUPE_WINDOW_MS + 1000);
  return h.messages.at(-1);
}

/** Categorizes the purchase (in English) through ➕ New category / ➕ New group. */
async function categorize(h: Harness, picker: Parameters<Harness["tap"]>[0], cat: string) {
  await h.tap(picker, "➕ New category");
  await h.say(cat);
  await h.tap(h.messages.at(-1), "➕ New group");
  await h.say("Food");
}

/** Totals per group, joined through the category (ADR-0006). */
function totalsByGroup(h: Harness) {
  return h.db
    .select({ group: schema.groups.name, total: sql<number>`sum(${schema.purchases.amountMinor})` })
    .from(schema.purchases)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.purchases.categoryId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.categories.groupId))
    .where(eq(schema.purchases.status, "categorized"))
    .groupBy(schema.groups.name)
    .orderBy(schema.groups.name)
    .all();
}

describe("comments by reply", () => {
  it("stores a reply as the purchase's comment, overwrites it, and reacts", async () => {
    const h = setup();
    const picker = await ingestPurchase(h, "AXION VILLA ALLENDE");
    const sent = h.messages.length;

    await h.say("  Nafta para el viaje ", 42, picker);
    expect(purchases(h)[0]?.comment).toBe("Nafta para el viaje");
    expect(h.acknowledged).toEqual([1]);

    await h.say("Viaje a Córdoba", 42, picker);
    expect(purchases(h)[0]?.comment).toBe("Viaje a Córdoba");
    expect(h.acknowledged).toEqual([1, 2]);
    expect(h.messages).toHaveLength(sent);
    expect(purchases(h)[0]?.status).toBe("pending");
  });

  it("works on a categorized purchase's confirmation and does not touch other purchases", async () => {
    const h = setup("en");
    const first = await ingestPurchase(h, "AXION VILLA ALLENDE");
    await categorize(h, first, "Fuel");
    await ingestPurchase(h, "PEDIDOSYA", "Pagaste $200");

    await h.say("Con amigos", 42, first);
    expect(purchases(h).map((p) => p.comment)).toEqual(["Con amigos", null]);
    expect(purchases(h)[0]?.status).toBe("categorized");
  });

  it("does not treat a reply to a non-purchase message as a comment", async () => {
    const h = setup();
    await ingestPurchase(h, "AXION VILLA ALLENDE");
    await h.say("/help");
    await h.say("hola", 42, h.messages.at(-1));
    expect(purchases(h)[0]?.comment).toBeNull();
    expect(h.acknowledged).toEqual([]);
  });

  it("does not let a reply in another chat set a comment", async () => {
    const h = setup();
    const picker = await ingestPurchase(h, "AXION VILLA ALLENDE");
    await h.say("intruso", 7, picker);
    expect(purchases(h)[0]?.comment).toBeNull();
  });
});

describe("/pending", () => {
  it("re-sends the prompts of pending purchases and transfers, oldest first", async () => {
    const h = setup("en");
    const axion = await ingestPurchase(h, "AXION VILLA ALLENDE");
    await ingestTransfer(h);
    const done = await ingestPurchase(h, "PEDIDOSYA", "Pagaste $200");
    await categorize(h, done, "Delivery");
    const sent = h.messages.length;

    await h.say("/pending");
    const resent = h.messages.slice(sent);
    expect(resent.map((m) => m.text.split("\n")[0])).toEqual([
      "🛒 $100.00 ARS · AXION VILLA ALLENDE",
      "↗️ Transfer $300,000.00 ARS",
    ]);
    // The picker reflects the current top categories.
    expect(h.buttons(resent[0])?.[0]).toEqual(["Delivery"]);
    expect(h.message(axion?.messageId)?.text).toBe(resent[0]?.text);

    // The re-sent prompt is now the purchase's message: picking there updates it.
    await h.tap(resent[0], "Delivery");
    expect(h.message(resent[0]?.messageId)?.text).toContain("Delivery (Food)");
    expect(purchases(h)[0]).toMatchObject({
      status: "categorized",
      telegramMessageId: resent[0]?.messageId,
    });
  });

  it("re-sends at most 10, the oldest ones", async () => {
    const h = setup();
    for (let i = 1; i <= 12; i++) await ingestPurchase(h, `COMERCIO ${i}`, `Pagaste $${i}`);
    const sent = h.messages.length;

    await h.say("/pending");
    const resent = h.messages.slice(sent);
    expect(resent).toHaveLength(10);
    expect(resent[0]?.text).toContain("COMERCIO 1\n");
    expect(resent[9]?.text).toContain("COMERCIO 10\n");
  });

  it("says when nothing is pending", async () => {
    const h = setup("en");
    await h.say("/pending");
    expect(h.messages.at(-1)?.text).toBe("Nothing pending.");
  });
});

describe("/setgroup", () => {
  it("moves a category to a new group; group totals follow without touching purchases", async () => {
    const h = setup("en");
    const picker = await ingestPurchase(h, "PEDIDOSYA");
    await h.tap(picker, "➕ New category");
    await h.say("Delivery");
    await h.tap(h.messages.at(-1), "➕ New group");
    await h.say("Shopping");
    expect(totalsByGroup(h)).toEqual([{ group: "Shopping", total: 10000 }]);
    const before = purchases(h);

    await h.say("/setgroup delivery Food");
    expect(h.messages.at(-1)?.text).toBe("Delivery is now in Food.");
    expect(totalsByGroup(h)).toEqual([{ group: "Food", total: 10000 }]);
    expect(purchases(h)).toEqual(before);
    const groups = h.db.select({ name: schema.groups.name }).from(schema.groups).all();
    expect(groups.map((g) => g.name).sort()).toEqual(["Food", "Shopping"]);
  });

  it("moves to an existing group and accepts multi-word names", async () => {
    const h = setup("en");
    const first = await ingestPurchase(h, "MOSTAZA");
    await h.tap(first, "➕ New category");
    await h.say("Fast food");
    await h.tap(h.messages.at(-1), "➕ New group");
    await h.say("Eating out");
    const second = await ingestPurchase(h, "COTO");
    await h.tap(second, "➕ New category");
    await h.say("Groceries");
    await h.tap(h.messages.at(-1), "➕ New group");
    await h.say("Food");

    await h.say("/setgroup Fast food food");
    expect(h.messages.at(-1)?.text).toBe("Fast food is now in Food.");
    expect(h.db.select().from(schema.groups).all()).toHaveLength(2);
    expect(totalsByGroup(h)).toEqual([{ group: "Food", total: 20000 }]);
  });

  it("answers with an error for an unknown category", async () => {
    const h = setup();
    await h.say("/setgroup Delivery Food");
    expect(h.messages.at(-1)?.text).toBe("No hay ninguna categoría llamada Delivery.");
    expect(h.db.select().from(schema.groups).all()).toEqual([]);
  });

  it("explains the usage when arguments are missing", async () => {
    const h = setup("en");
    await h.say("/setgroup Delivery");
    expect(h.messages.at(-1)?.text).toBe(
      "Usage: /setgroup <category> <group>, e.g. /setgroup Delivery Food",
    );
  });
});

describe("/help", () => {
  it.each([
    ["en", "Commands:"],
    ["es", "Comandos:"],
  ] as const)("lists the commands in %s", async (locale, heading) => {
    const h = setup(locale);
    await h.say("/help");
    const text = h.messages.at(-1)?.text ?? "";
    expect(text.startsWith(heading)).toBe(true);
    for (const command of ["/pending", "/setgroup", "/help"]) expect(text).toContain(command);
  });
});
