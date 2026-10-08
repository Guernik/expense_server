import { schema } from "@denarii/db";
import { describe, expect, it } from "vitest";
import { GALICIA_PURCHASE, setup } from "./test-harness";

type Harness = ReturnType<typeof setup>;

const PROMO = {
  app: "Galicia",
  title: "Ahorrá 25% con MODO💈",
  text: "Miércoles y jueves, hasta $3.000.",
};
const PROMO_NOTICE =
  '❓ Notificación no reconocida (Galicia)\n"Ahorrá 25% con MODO💈"\n"Miércoles y jueves, hasta $3.000"';

async function ingest(h: Harness, body: object) {
  const count = h.messages.length;
  await h.ingest(body);
  await h.settled();
  return h.messages.length > count ? h.messages.at(-1) : undefined;
}

const events = (h: Harness) => h.db.select().from(schema.events).all();
const purchases = (h: Harness) => h.db.select().from(schema.purchases).all();
const userRules = (h: Harness) => h.db.select().from(schema.classifierRules).all();

/** Sends the Confirm callback for the first event directly, as a stale or forged button would. */
const confirmRule = (h: Harness, messageId: number | undefined) =>
  h.telegram({
    callback_query: {
      id: "stale",
      data: `y:${events(h)[0]?.id}`,
      message: { message_id: messageId, chat: { id: 42 } },
    },
  });

describe("unmatched events", () => {
  it("asks PURCHASE / NON-PURCHASE with the title and text", async () => {
    const h = setup();
    const notice = await ingest(h, PROMO);
    expect(notice?.text).toBe(PROMO_NOTICE);
    expect(h.buttons(notice)).toEqual([["💳 COMPRA", "🚫 NO ES COMPRA"]]);
    expect(events(h)[0]?.status).toBe("unmatched");
    expect(purchases(h)).toHaveLength(0);
  });

  it("PURCHASE takes a typed amount and merchant, then opens the category picker", async () => {
    const h = setup();
    const notice = await ingest(h, { ...PROMO, received_at: "2026-10-05T14:05:30-03:00" });
    await h.tap(notice, "💳 COMPRA");
    expect(h.messages.at(-1)?.text).toBe(
      "Escribí el monto y el comercio, por ejemplo 15000,50 Axion. Agregá USD si fue en dólares.",
    );

    await h.say("15000,50 Axion");
    expect(purchases(h)[0]).toMatchObject({
      kind: "purchase",
      status: "pending",
      amountMinor: 1500050,
      currency: "ARS",
      merchantRaw: "Axion",
      merchantNormalized: "AXION",
      paymentMethodId: null,
      occurredAt: "2026-10-05T17:05:30.000Z",
    });
    expect(events(h)[0]).toMatchObject({
      status: "purchase",
      purchaseId: purchases(h)[0]?.id,
      extractedBy: "user",
    });
    expect(h.message(notice?.messageId)).toEqual({
      messageId: notice?.messageId,
      chatId: "42",
      text: `${PROMO_NOTICE}\n\n💳 COMPRA`,
    });
    const picker = h.messages.at(-1);
    expect(picker?.text).toBe("🛒 $15.000,50 ARS · Axion\n14:05");
    expect(h.buttons(picker)?.at(-1)).toEqual(["🚫 No es una compra", "Omitir"]);
  });

  it("PURCHASE accepts USD and asks again on input it can't read", async () => {
    const h = setup();
    const notice = await ingest(h, PROMO);
    await h.tap(notice, "💳 COMPRA");
    await h.say("Axion");
    expect(h.messages.at(-1)?.text).toBe(
      "No lo entendí. Escribí el monto y el comercio, por ejemplo 15000,50 Axion.",
    );
    expect(purchases(h)).toHaveLength(0);

    await h.say("USD 20 Claude");
    expect(purchases(h)[0]).toMatchObject({ amountMinor: 2000, currency: "USD" });
  });

  it("NON-PURCHASE marks the event and offers Ignore similar", async () => {
    const h = setup();
    const notice = await ingest(h, PROMO);
    await h.tap(notice, "🚫 NO ES COMPRA");
    expect(events(h)[0]?.status).toBe("non_purchase");
    expect(h.message(notice?.messageId)?.text).toBe(`${PROMO_NOTICE}\n\n🚫 NO ES COMPRA`);
    expect(h.buttons(notice)).toEqual([["🔇 Ignorar similares"]]);
  });

  it("Ignore similar shows the regex and saves it only on Confirm", async () => {
    const h = setup();
    const notice = await ingest(h, PROMO);
    await h.tap(notice, "🚫 NO ES COMPRA");
    await h.tap(notice, "🔇 Ignorar similares");
    expect(h.message(notice?.messageId)?.text).toBe(
      `${PROMO_NOTICE}\n\n🚫 NO ES COMPRA\n\n` +
        "¿Ignorar las notificaciones cuyo título coincida con esto?\n^Ahorrá [\\d.,]+% con MODO💈$",
    );
    expect(h.buttons(notice)).toEqual([["Confirmar", "Cancelar"]]);
    expect(userRules(h)).toHaveLength(0);

    await h.tap(notice, "Confirmar");
    expect(h.message(notice?.messageId)?.text).toBe(
      `${PROMO_NOTICE}\n\n🚫 NO ES COMPRA\n\n🔇 Las notificaciones similares se van a ignorar.`,
    );
    expect(h.buttons(notice)).toBeUndefined();
    const [rule] = userRules(h);
    expect(rule).toMatchObject({ enabled: true, createdFromEventId: events(h)[0]?.id });
    expect(rule?.definition).toMatchObject({
      id: expect.stringMatching(/^user\.[0-9a-f-]{36}$/),
      kind: "ignore",
      match: { title: "^Ahorrá [\\d.,]+% con MODO💈$" },
    });
  });

  it("Cancel discards the rule", async () => {
    const h = setup();
    const notice = await ingest(h, PROMO);
    await h.tap(notice, "🚫 NO ES COMPRA");
    await h.tap(notice, "🔇 Ignorar similares");
    await h.tap(notice, "Cancelar");
    expect(h.message(notice?.messageId)?.text).toBe(`${PROMO_NOTICE}\n\n🚫 NO ES COMPRA`);
    expect(h.buttons(notice)).toBeUndefined();
    expect(userRules(h)).toHaveLength(0);
  });

  it("ignores later similar events through the user rule without prompting", async () => {
    const h = setup();
    const notice = await ingest(h, PROMO);
    await h.tap(notice, "🚫 NO ES COMPRA");
    await h.tap(notice, "🔇 Ignorar similares");
    await h.tap(notice, "Confirmar");
    const ruleId = (userRules(h)[0]?.definition as { id: string } | undefined)?.id;

    expect(await ingest(h, { ...PROMO, title: "Ahorrá 30% con MODO💈" })).toBeUndefined();
    expect(events(h)[1]).toMatchObject({ status: "ignored", ruleId, ruleSource: "user" });
  });

  it("does not save the same rule twice on a repeated Confirm", async () => {
    const h = setup();
    const notice = await ingest(h, PROMO);
    await h.tap(notice, "🚫 NO ES COMPRA");
    await h.tap(notice, "🔇 Ignorar similares");
    await h.tap(notice, "Confirmar");
    await confirmRule(h, notice?.messageId);
    expect(userRules(h)).toHaveLength(1);
  });
});

describe("Not a purchase", () => {
  it("excludes the purchase and offers Ignore similar", async () => {
    const h = setup();
    const picker = await ingest(h, GALICIA_PURCHASE);
    await h.tap(picker, "🚫 No es una compra");
    expect(purchases(h)[0]?.status).toBe("excluded");
    expect(h.message(picker?.messageId)?.text).toBe(
      "🚫 $15.000,01 ARS · AXION VILLA ALLENDE\nGalicia Visa Crédito 3551 · 22:32",
    );
    expect(h.buttons(picker)).toEqual([["🔇 Ignorar similares"]]);
  });

  it("user rules take precedence over pack rules", async () => {
    const h = setup();
    const picker = await ingest(h, GALICIA_PURCHASE);
    await h.tap(picker, "🚫 No es una compra");
    await h.tap(picker, "🔇 Ignorar similares");
    expect(h.message(picker?.messageId)?.text).toContain("\n^Pagaste \\$[\\d.,]+$");
    await h.tap(picker, "Confirmar");

    expect(await ingest(h, { ...GALICIA_PURCHASE, title: "Pagaste $200" })).toBeUndefined();
    expect(events(h)[1]).toMatchObject({ status: "ignored", ruleSource: "user" });
    expect(purchases(h)).toHaveLength(1);
  });

  it("refuses to save a rule for a purchase that was not excluded", async () => {
    const h = setup();
    const picker = await ingest(h, GALICIA_PURCHASE);
    await confirmRule(h, picker?.messageId);
    expect(userRules(h)).toHaveLength(0);
    expect(h.buttons(picker)?.at(-1)).toEqual(["🚫 No es una compra", "Omitir"]);
  });
});
