import { DEDUPE_WINDOW_MS } from "@denarii/core";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import { GALICIA_PURCHASE, setup } from "./test-harness";

type Harness = ReturnType<typeof setup>;

/** 21:00 in Córdoba (UTC-3) on 2026-10-07: the default DIGEST_CRON after the harness clock. */
const DIGEST_AT = new Date("2026-10-08T00:00:00Z");

const PROMO = { app: "Galicia", title: "Ahorrá 25% con MODO", text: "Miércoles y jueves." };

/** Ingests a notification and returns the bot's message for it, moving past the dedupe window. */
async function ingest(h: Harness, body: object) {
  await h.ingest(body);
  await h.settled();
  h.clock.current = new Date(h.clock.current.getTime() + DEDUPE_WINDOW_MS + 1000);
  return h.messages.at(-1);
}

/** Runs the tick and returns the digest it sent, if any. */
async function digest(h: Harness, at = DIGEST_AT) {
  const sent = h.messages.length;
  await h.tick(at);
  return h.messages.slice(sent).map((m) => m.text);
}

describe("daily digest", () => {
  it("sends nothing when there is nothing to report", async () => {
    const h = setup("en");
    expect(await digest(h)).toEqual([]);

    // Answered and categorized items are not reported either.
    const picker = await ingest(h, GALICIA_PURCHASE);
    await h.tap(picker, "➕ New category");
    await h.say("Fuel");
    await h.tap(h.messages.at(-1), "➕ New group");
    await h.say("Transport");
    const transfer = await ingest(h, { app: "Galicia", title: "Transferiste: $300.000", text: "" });
    await h.tap(transfer, "↔️ Not an expense");
    expect(await digest(h)).toEqual([]);
  });

  it("reports pending purchases, unanswered unmatched events and possible misses", async () => {
    const h = setup("en");
    await ingest(h, GALICIA_PURCHASE);
    await ingest(h, { app: "Galicia", title: "Transferiste: $300.000", text: "" });
    await ingest(h, PROMO);
    const rejected = await ingest(h, { app: "MP", title: "Tenés un regalo", text: "Entrá ya" });
    await h.tap(rejected, "🚫 NON-PURCHASE");
    const excluded = await ingest(h, { ...GALICIA_PURCHASE, title: "Pagaste $1.000" });
    await h.tap(excluded, "🚫 Not a purchase");

    expect(await digest(h)).toEqual([
      [
        "📋 Daily summary",
        "",
        "🛒 Pending purchases: 2. Send /pending to answer them.",
        "",
        "❓ Unrecognized notifications without an answer: 1",
        '• Galicia: "Ahorrá 25% con MODO"',
        "",
        "🔍 Possible classifier misses in the last 24 h: 2",
        "Marked as not a purchase, with no ignore rule.",
        '• MP: "Tenés un regalo"',
        '• Galicia: "Pagaste $1.000"',
      ].join("\n"),
    ]);
  });

  it("drops misses covered by an ignore rule and those older than 24 h", async () => {
    const h = setup("en");
    const old = await ingest(h, { app: "MP", title: "Promo vieja", text: "" });
    await h.tap(old, "🚫 NON-PURCHASE");
    h.clock.current = new Date(DIGEST_AT.getTime() - 60 * 60_000);
    const ignored = await ingest(h, { app: "MP", title: "Tenés 3 regalos", text: "" });
    await h.tap(ignored, "🚫 NON-PURCHASE");
    await h.tap(ignored, "🔇 Ignore similar");
    await h.tap(ignored, "Confirm");

    // `old` was received 22:32 the day before, more than 24 h before the next day's digest.
    expect(await digest(h, new Date(DIGEST_AT.getTime() + 24 * 60 * 60_000))).toEqual([]);
    expect((await digest(h))[0]).toContain('• MP: "Promo vieja"');
    expect((await digest(h))[0]).not.toContain("regalos");
  });

  it("only runs at DIGEST_CRON, read in TIMEZONE", async () => {
    const h = setup("es", { DIGEST_CRON: "30 8 * * 1-5" });
    await ingest(h, GALICIA_PURCHASE);
    // Thursday 2026-10-08 08:30 in Córdoba is 11:30 UTC.
    expect(await digest(h, new Date("2026-10-08T08:30:00Z"))).toEqual([]);
    expect(await digest(h, new Date("2026-10-08T11:31:00Z"))).toEqual([]);
    expect(await digest(h, new Date("2026-10-08T11:30:00Z"))).toEqual([
      "📋 Resumen diario\n\n🛒 Compras pendientes: 1. Mandá /pending para responderlas.",
    ]);
    // Saturday.
    expect(await digest(h, new Date("2026-10-10T11:30:00Z"))).toEqual([]);
  });

  it("defaults to 21:00 local and rejects an invalid DIGEST_CRON", () => {
    const env = {
      WEBHOOK_SECRET: "test-webhook-secret-0123",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "42",
      TELEGRAM_WEBHOOK_SECRET: "test-telegram-secret-0123",
      RULE_PACKS: "ar.galicia",
    };
    expect(parseConfig(env).DIGEST_CRON).toBe("0 21 * * *");
    expect(() => parseConfig({ ...env, DIGEST_CRON: "21:00" })).toThrow(/DIGEST_CRON/);
  });
});
