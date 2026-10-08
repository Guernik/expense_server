import type { Messenger } from "@denarii/core";
import { createStore, schema } from "@denarii/db";
import { createTestDatabase } from "@denarii/db/testing";
import { describe, expect, it } from "vitest";
import { createApp, type Runtime } from "./app";
import { parseConfig } from "./config";

const WEBHOOK_SECRET = "test-webhook-secret-0123";
const TELEGRAM_SECRET = "test-telegram-secret-0123";

function setup(locale: "en" | "es" = "es") {
  const db = createTestDatabase();
  const sent: { chatId: string; text: string }[] = [];
  const messenger: Messenger = {
    async send(chatId, text) {
      sent.push({ chatId, text });
      return { messageId: 1000 + sent.length };
    },
  };
  const tasks: Promise<unknown>[] = [];
  const runtime: Runtime = {
    config: parseConfig({
      WEBHOOK_SECRET,
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "42",
      TELEGRAM_WEBHOOK_SECRET: TELEGRAM_SECRET,
      RULE_PACKS: "ar.galicia,ar.mercadopago",
      LOCALE: locale,
    }),
    store: createStore(db),
    messenger,
    clock: { now: () => new Date("2026-10-07T01:32:10Z") },
    defer: (task) => tasks.push(task),
  };
  const app = createApp(() => runtime);
  const settled = () => Promise.all(tasks);

  const ingest = (body: unknown, secret = WEBHOOK_SECRET) =>
    app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(body),
    });
  const telegram = (update: unknown, secret = TELEGRAM_SECRET) =>
    app.request("/api/telegram", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(update),
    });

  return { app, db, sent, ingest, telegram, settled };
}

const GALICIA_PURCHASE = {
  app: "Galicia",
  title: "Pagaste $15.000,01",
  text: "A AXION VILLA ALLENDE con tu Visa Crédito 3551 a las 22:32.",
};

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
    const { db, sent, ingest, settled } = setup("es");
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

    expect(sent).toEqual([
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
    const { db, sent, ingest, settled } = setup("es");
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
    expect(sent[0]?.text).toBe("🛒 $10.200,00 ARS · SHOWCASE CORDOBA\nMercado Pago cuenta · 14:05");
  });

  it("formats the notice in English", async () => {
    const { sent, ingest, settled } = setup("en");
    await ingest(GALICIA_PURCHASE);
    await settled();
    expect(sent[0]?.text).toBe(
      "🛒 $15,000.01 ARS · AXION VILLA ALLENDE\nGalicia Visa Crédito 3551 · 22:32",
    );
  });

  it("stores unrecognized notifications as unmatched without messaging", async () => {
    const { db, sent, ingest, settled } = setup();
    await ingest({ app: "Galicia", title: "Tu nuevo look 💈", text: "25% off" });
    await settled();
    expect(db.select().from(schema.events).all()[0]?.status).toBe("unmatched");
    expect(db.select().from(schema.purchases).all()).toHaveLength(0);
    expect(sent).toHaveLength(0);
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

describe("POST /api/telegram", () => {
  it("rejects a wrong secret", async () => {
    const { telegram } = setup();
    expect((await telegram({}, "nope")).status).toBe(401);
  });

  it("ignores chats other than the configured one", async () => {
    const { sent, telegram } = setup();
    const response = await telegram({ message: { chat: { id: 7 }, text: "/start" } });
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("answers /start in the configured chat", async () => {
    const { sent, telegram } = setup("es");
    await telegram({ message: { chat: { id: 42 }, text: "/start" } });
    expect(sent).toEqual([
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
