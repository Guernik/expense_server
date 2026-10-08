import { describe, expect, it } from "vitest";
import { DIGEST_MAX_ITEMS, digestText } from "./digest";
import type { StoredEvent, User } from "./ports";

const user = (locale: "en" | "es"): User => ({
  id: 1,
  telegramChatId: "42",
  locale,
  timezone: "America/Argentina/Cordoba",
});

let ids = 0;
const event = (title: string, app = "Galicia", text = ""): StoredEvent => ({
  id: ++ids,
  userId: 1,
  app,
  title,
  text,
  receivedAt: new Date("2026-10-07T12:00:00Z"),
  status: "unmatched",
  purchaseId: null,
});

describe("digestText", () => {
  it("is null when every section is empty", () => {
    expect(digestText(user("en"), { pending: 0, unmatched: [], possibleMisses: [] })).toBeNull();
  });

  it("shows only the sections with something to report", () => {
    expect(digestText(user("en"), { pending: 3, unmatched: [], possibleMisses: [] })).toBe(
      "📋 Daily summary\n\n🛒 Pending purchases: 3. Send /pending to answer them.",
    );
  });

  it("lists the three sections in Spanish", () => {
    const text = digestText(user("es"), {
      pending: 2,
      unmatched: [event("Tu nuevo look, con promo💈✂️")],
      possibleMisses: [event("Pagaste $100", "Galicia"), event("", "", "Debitamos $ 50")],
    });
    expect(text).toBe(
      [
        "📋 Resumen diario",
        "",
        "🛒 Compras pendientes: 2. Mandá /pending para responderlas.",
        "",
        "❓ Notificaciones no reconocidas sin responder: 1",
        '• Galicia: "Tu nuevo look, con promo💈✂️"',
        "",
        "🔍 Posibles errores del clasificador en las últimas 24 h: 2",
        "Marcadas como no compra, sin regla para ignorar.",
        '• Galicia: "Pagaste $100"',
        '• "Debitamos $ 50"',
      ].join("\n"),
    );
  });

  it("caps each list and truncates long titles", () => {
    const many = Array.from({ length: DIGEST_MAX_ITEMS + 2 }, (_, i) => event(`Promo ${i}`));
    const long = event(`${"🎉".repeat(100)}`);
    const text = digestText(user("en"), {
      pending: 0,
      unmatched: [long, ...many],
      possibleMisses: [],
    });
    const lines = text?.split("\n") ?? [];
    expect(lines).toContain("…and 3 more");
    expect(lines.filter((l) => l.startsWith("• "))).toHaveLength(DIGEST_MAX_ITEMS);
    expect(lines[3]).toBe(`• Galicia: "${"🎉".repeat(79)}…"`);
  });
});
