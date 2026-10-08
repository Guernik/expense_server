import { compileRules, parsePack, processEvent } from "@denarii/core";
import { schema } from "@denarii/db";
import { PACK_SOURCES } from "@denarii/rules";
import { describe, expect, it } from "vitest";
import { GALICIA_PURCHASE, setup } from "./test-harness";

describe("POST /api/ingest", () => {
  it("rejects a missing or wrong secret without storing anything", async () => {
    const { db, ingest } = setup();
    expect((await ingest(GALICIA_PURCHASE, "")).status).toBe(401);
    expect((await ingest(GALICIA_PURCHASE, "wrong-secret-wrong-secret")).status).toBe(401);
    expect(db.select().from(schema.events).all()).toHaveLength(0);
  });

  it("checks the secret before validating the body", async () => {
    const { ingest } = setup();
    expect((await ingest({ title: 1 }, "")).status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    const { ingest } = setup();
    expect((await ingest({ title: "x" })).status).toBe(400);
  });

  it("stores the event, records the purchase and announces it in Telegram", async () => {
    const { db, messages, ingest, settled } = setup("es");
    const response = await ingest(GALICIA_PURCHASE);
    expect(response.status).toBe(202);
    await settled();

    const [purchase] = db.select().from(schema.purchases).all();
    expect(purchase).toMatchObject({
      kind: "purchase",
      status: "pending",
      amountMinor: 1500001,
      currency: "ARS",
      merchantRaw: "AXION VILLA ALLENDE",
      merchantNormalized: "AXION VILLA ALLENDE",
      telegramMessageId: 1001,
    });
    const [method] = db.select().from(schema.paymentMethods).all();
    expect(method?.label).toBe("Galicia Visa Crédito 3551");
    expect(purchase?.paymentMethodId).toBe(method?.id);

    const [event] = db.select().from(schema.events).all();
    expect(event).toMatchObject({
      status: "purchase",
      ruleId: "ar.galicia.card-purchase",
      ruleSource: "pack",
      purchaseId: purchase?.id,
    });

    expect(messages).toMatchObject([
      {
        chatId: "42",
        text: "🛒 $15.000,01 ARS · AXION VILLA ALLENDE\nGalicia Visa Crédito 3551 · 22:32",
      },
    ]);
  });

  it("dates the purchase with the notification time, rolling back after midnight", async () => {
    const { db, ingest, settled } = setup();
    await ingest({ ...GALICIA_PURCHASE, received_at: "2026-10-05T22:32:10-03:00" });
    await ingest({
      ...GALICIA_PURCHASE,
      text: "A AXION VILLA ALLENDE con tu Visa Crédito 3551 a las 23:59.",
      received_at: "2026-10-06T00:00:20-03:00",
    });
    await settled();
    expect(
      db
        .select()
        .from(schema.purchases)
        .all()
        .map((p) => p.occurredAt),
    ).toEqual(["2026-10-06T01:32:00.000Z", "2026-10-06T02:59:00.000Z"]);
  });

  it("records a Mercado Pago account purchase", async () => {
    const { db, messages, ingest, settled } = setup("es");
    await ingest({
      app: "Mercado Pago",
      title: "Pagaste a SHOWCASE CORDOBA",
      text: "Debitamos $ 10.200 de tu cuenta.",
      received_at: "2026-10-05T14:05:30-03:00",
    });
    await settled();
    const [purchase] = db.select().from(schema.purchases).all();
    expect(purchase).toMatchObject({
      amountMinor: 1020000,
      currency: "ARS",
      merchantNormalized: "SHOWCASE CORDOBA",
      occurredAt: "2026-10-05T17:05:30.000Z",
    });
    const [method] = db.select().from(schema.paymentMethods).all();
    expect(method?.label).toBe("Mercado Pago cuenta");
    expect(messages[0]?.text).toBe(
      "🛒 $10.200,00 ARS · SHOWCASE CORDOBA\nMercado Pago cuenta · 14:05",
    );
  });

  it("formats the notice in English", async () => {
    const { messages, ingest, settled } = setup("en");
    await ingest(GALICIA_PURCHASE);
    await settled();
    expect(messages[0]?.text).toBe(
      "🛒 $15,000.01 ARS · AXION VILLA ALLENDE\nGalicia Visa Crédito 3551 · 22:32",
    );
  });

  it("reuses the payment method for the same label", async () => {
    const { db, ingest, settled } = setup();
    await ingest(GALICIA_PURCHASE);
    await ingest({ ...GALICIA_PURCHASE, title: "Pagaste $100" });
    await settled();
    expect(db.select().from(schema.paymentMethods).all()).toHaveLength(1);
    expect(db.select().from(schema.purchases).all()).toHaveLength(2);
  });
});

describe("dedupe", () => {
  const at = (time: string) => ({ ...GALICIA_PURCHASE, received_at: `2026-10-07T01:${time}Z` });

  it("merges the same notification posted twice within 10 s", async () => {
    const { db, messages, ingest, settled } = setup();
    await ingest(at("32:10"));
    await ingest(at("32:20"));
    await settled();

    const purchases = db.select().from(schema.purchases).all();
    expect(purchases).toHaveLength(1);
    const events = db.select().from(schema.events).all();
    expect(events.map((e) => [e.status, e.purchaseId])).toEqual([
      ["purchase", purchases[0]?.id],
      ["duplicate", purchases[0]?.id],
    ]);
    expect(messages).toHaveLength(1);
  });

  it("merges an event received before the existing purchase's", async () => {
    const { db, ingest, settled } = setup();
    await ingest(at("32:10"));
    await ingest(at("32:00"));
    await settled();
    expect(db.select().from(schema.purchases).all()).toHaveLength(1);
  });

  it("keeps purchases 11 s apart separate", async () => {
    const { db, messages, ingest, settled } = setup();
    await ingest(at("32:10"));
    await ingest(at("32:21"));
    await settled();
    expect(db.select().from(schema.purchases).all()).toHaveLength(2);
    expect(messages).toHaveLength(2);
  });

  it("keeps purchases in different currencies separate", async () => {
    const { db, ingest, settled } = setup();
    await ingest(at("32:10"));
    await ingest({ ...at("32:10"), title: "Pagaste USD 15.000,01" });
    await settled();
    expect(
      db
        .select()
        .from(schema.purchases)
        .all()
        .map((p) => p.currency),
    ).toEqual(["ARS", "USD"]);
  });

  it("keeps the extraction with more non-null fields", async () => {
    const { db, runtime } = setup();
    const { store, messenger, clock } = runtime;
    const wallet = parsePack(
      "test.wallet",
      `pack: test.wallet
rules:
  - id: test.wallet.payment
    kind: purchase
    match: { title: '^Pagaste \\$(?<amount>[\\d.,]+)$' }
    transform: { amount: { number_format: es-AR }, currency: { default: ARS } }
    tests: [{ title: 'Pagaste $1', text: '', expect: { amount: "1" } }]
`,
    );
    const galicia = parsePack("ar.galicia", PACK_SOURCES["ar.galicia"] ?? "");
    const rules = compileRules([galicia, wallet]);
    const user = await store.ensureUser({ telegramChatId: "42", locale: "es", timezone: "UTC" });
    const receive = async (title: string, text: string, time: string) => {
      const event = await store.insertEvent({
        userId: user.id,
        app: "",
        title,
        text,
        receivedAt: new Date(`2026-10-07T01:${time}Z`),
      });
      await processEvent({ store, messenger, clock, packRules: rules }, user, event);
    };
    const purchases = () =>
      db
        .select()
        .from(schema.purchases)
        .all()
        .map((p) => [p.merchantRaw, p.paymentMethodId !== null]);

    await receive("Pagaste $15.000,01", "", "32:10");
    expect(purchases()).toEqual([["Unknown", false]]);
    await receive(GALICIA_PURCHASE.title, GALICIA_PURCHASE.text, "32:15");
    expect(purchases()).toEqual([["AXION VILLA ALLENDE", true]]);
    await receive("Pagaste $15.000,01", "", "32:20");
    expect(purchases()).toEqual([["AXION VILLA ALLENDE", true]]);
  });
});

describe("POST /api/telegram", () => {
  it("rejects a wrong secret", async () => {
    const { telegram } = setup();
    expect((await telegram({}, "nope")).status).toBe(401);
  });

  it("ignores chats other than the configured one", async () => {
    const { messages, telegram } = setup();
    const response = await telegram({
      message: { message_id: 1, chat: { id: 7 }, text: "/start" },
    });
    expect(response.status).toBe(200);
    expect(messages).toHaveLength(0);
  });

  it("answers /start in the configured chat", async () => {
    const { messages, telegram } = setup("es");
    await telegram({ message: { message_id: 1, chat: { id: 42 }, text: "/start" } });
    expect(messages).toMatchObject([
      { chatId: "42", text: "denarii está funcionando. Tus compras van a aparecer acá." },
    ]);
  });
});

describe("OpenAPI", () => {
  it("serves the spec", async () => {
    const { app } = setup();
    const response = await app.request("/api/openapi.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ openapi: "3.1.0" });
  });

  it("matches the committed docs/api/openapi.json (update with `npm run openapi -w @denarii/api`)", async () => {
    const { app } = setup();
    const spec = await (await app.request("/api/openapi.json")).json();
    await expect(`${JSON.stringify(spec, null, 2)}\n`).toMatchFileSnapshot(
      "../../../docs/api/openapi.json",
    );
  });
});
