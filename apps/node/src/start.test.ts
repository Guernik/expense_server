import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@denarii/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeTelegram } from "./fake-telegram";
import { start } from "./start";

const CHAT_ID = 42;
const WEBHOOK_SECRET = "test-webhook-secret-0123";

const ENV = {
  WEBHOOK_SECRET,
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_CHAT_ID: String(CHAT_ID),
  RULE_PACKS: "ar.galicia,ar.mercadopago",
  LOCALE: "es",
  PORT: "0",
};

const running: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.stop()));
});

async function startNode(env: Record<string, string> = {}, webhookUrl?: string) {
  const telegram = createFakeTelegram({ ...(webhookUrl && { webhookUrl }) });
  const databasePath = join(mkdtempSync(join(tmpdir(), "denarii-")), "data", "denarii.db");
  const instance = await start(
    { ...ENV, DATABASE_PATH: databasePath, ...env },
    { fetch: telegram.fetch, polling: { retryMs: 10 } },
  );
  running.push(instance);
  const url = (path: string) => `http://localhost:${instance.port}${path}`;
  return { ...instance, telegram, databasePath, url };
}

const ingest = (url: string) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
    body: JSON.stringify({
      app: "Galicia",
      title: "Pagaste $15.000,01",
      text: "A AXION VILLA ALLENDE con tu Visa Crédito 3551 a las 22:32.",
    }),
  });

describe("Node runtime", () => {
  it("applies migrations on startup, creating the database file", async () => {
    const { db } = await startNode();
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(["users", "events", "purchases", "categories", "chat_state"]),
    );
  });

  it("keeps data across restarts of the same database file", async () => {
    const first = await startNode();
    expect((await ingest(first.url("/api/ingest"))).status).toBe(202);
    await first.idle();
    await first.stop();
    running.splice(running.indexOf(first), 1);

    const second = await startNode({ DATABASE_PATH: first.databasePath });
    expect(second.db.select().from(schema.events).all()).toHaveLength(1);
    expect(second.db.select().from(schema.purchases).all()).toHaveLength(1);
  });

  it("processes an ingested event in-process after answering 202", async () => {
    const { url, idle, telegram } = await startNode();
    const response = await ingest(url("/api/ingest"));
    expect(response.status).toBe(202);
    await idle();
    expect(telegram.sent()).toEqual([
      expect.objectContaining({
        chat_id: String(CHAT_ID),
        text: expect.stringContaining("AXION VILLA ALLENDE"),
      }),
    ]);
  });

  it("serves the built SPA, falling back to index.html for client routes", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "denarii-web-"));
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>denarii</title>");
    writeFileSync(join(webRoot, "assets", "app.js"), "console.log(1);");
    const { url } = await startNode({ WEB_ROOT: webRoot });

    expect(await (await fetch(url("/assets/app.js"))).text()).toBe("console.log(1);");
    expect(await (await fetch(url("/months/2026-10"))).text()).toContain("<title>denarii");
    expect((await fetch(url("/api/openapi.json"))).headers.get("content-type")).toContain("json");
    expect((await fetch(url("/api/nope"))).status).toBe(404);
  });

  describe("TELEGRAM_MODE=polling (default)", () => {
    it("works without a webhook secret or public URL", async () => {
      const { telegram, runtime } = await startNode();
      expect(runtime.config.TELEGRAM_MODE).toBe("polling");
      telegram.push({ message: { message_id: 1, chat: { id: CHAT_ID }, text: "/start" } });
      await vi.waitFor(() => expect(telegram.sent()).toHaveLength(1));
      expect(telegram.sent()[0]).toMatchObject({
        chat_id: String(CHAT_ID),
        text: "denarii está funcionando. Tus compras van a aparecer acá.",
      });
    });

    it("drives the category picker from polled button taps", async () => {
      const { url, idle, telegram, db } = await startNode();
      await ingest(url("/api/ingest"));
      await idle();
      const picker = telegram.sent()[0] as {
        reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] };
      };
      const newCategory = picker.reply_markup.inline_keyboard
        .flat()
        .find((b) => b.text.includes("Nueva categoría"));
      expect(newCategory).toBeDefined();
      telegram.push({
        callback_query: {
          id: "1",
          data: newCategory?.callback_data,
          message: { message_id: 501, chat: { id: CHAT_ID } },
        },
      });
      await vi.waitFor(() => expect(db.select().from(schema.chatState).all()).toHaveLength(1));
    });

    it("ignores updates from other chats", async () => {
      const { telegram } = await startNode();
      telegram.push({ message: { message_id: 1, chat: { id: 7 }, text: "/start" } });
      telegram.push({ message: { message_id: 2, chat: { id: CHAT_ID }, text: "/start" } });
      await vi.waitFor(() => expect(telegram.sent()).toHaveLength(1));
      const offsets = telegram.calls
        .filter((c) => c.method === "getUpdates")
        .map((c) => c.params.offset);
      expect(offsets.at(-1)).toBeGreaterThan(1);
    });

    it("refuses to poll a bot that has a webhook", async () => {
      const { polling } = await startNode({}, "https://example.com/api/telegram");
      await expect(polling).rejects.toThrow(/has a webhook/);
    });

    it("rejects webhook requests", async () => {
      const { url } = await startNode();
      const response = await fetch(url("/api/telegram"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(401);
    });
  });

  describe("TELEGRAM_MODE=webhook", () => {
    const secret = "test-telegram-secret-0123";

    it("requires TELEGRAM_WEBHOOK_SECRET", async () => {
      await expect(startNode({ TELEGRAM_MODE: "webhook" })).rejects.toThrow(
        /TELEGRAM_WEBHOOK_SECRET/,
      );
    });

    it("receives updates on /api/telegram and does not poll", async () => {
      const { url, telegram } = await startNode({
        TELEGRAM_MODE: "webhook",
        TELEGRAM_WEBHOOK_SECRET: secret,
      });
      const response = await fetch(url("/api/telegram"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": secret,
        },
        body: JSON.stringify({
          message: { message_id: 1, chat: { id: CHAT_ID }, text: "/start" },
        }),
      });
      expect(response.status).toBe(200);
      expect(telegram.sent()).toHaveLength(1);
      expect(telegram.calls.some((c) => c.method === "getUpdates")).toBe(false);
    });
  });
});
