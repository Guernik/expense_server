import { encodeAction } from "@denarii/core";
import { schema } from "@denarii/db";
import { describe, expect, it } from "vitest";
import { CHAT_ID, setup } from "./test-harness";

const TRANSFER = {
  app: "Galicia",
  title: "Transferiste: $300.000",
  text: "La transferencia ya está en la cuenta de destino.",
};

type Harness = ReturnType<typeof setup>;

async function ingestTransfer(h: Harness) {
  await h.ingest(TRANSFER);
  await h.settled();
  return h.messages.at(-1);
}

function purchases(h: Harness) {
  return h.db.select().from(schema.purchases).all();
}

describe("transfers", () => {
  it("records a transfer and asks whether it is an expense", async () => {
    const h = setup();
    const prompt = await ingestTransfer(h);

    expect(prompt?.text).toBe("↗️ Transferencia $300.000,00 ARS\n22:32");
    expect(h.buttons(prompt)).toEqual([["💸 Gasto", "↔️ No es un gasto"]]);
    expect(purchases(h)).toEqual([
      expect.objectContaining({
        kind: "transfer",
        status: "pending",
        amountMinor: 30_000_000,
        currency: "ARS",
        telegramMessageId: prompt?.messageId,
      }),
    ]);
    expect(h.db.select().from(schema.events).all()[0]?.status).toBe("transfer");
  });

  it("Expense asks for a description, then the category picker categorizes it", async () => {
    const h = setup();
    const prompt = await ingestTransfer(h);
    await h.tap(prompt, "💸 Gasto");
    expect(h.messages.at(-1)?.text).toBe(
      "¿En qué fue la transferencia de $300.000,00 ARS? Escribí una descripción corta.",
    );

    await h.say("  Alquiler octubre ");
    expect(h.message(prompt?.messageId)?.text).toBe("🛒 $300.000,00 ARS · Alquiler octubre\n22:32");
    expect(purchases(h)[0]).toMatchObject({
      kind: "transfer",
      status: "pending",
      merchantRaw: "Alquiler octubre",
      merchantNormalized: "ALQUILER OCTUBRE",
    });

    await h.tap(prompt, "➕ Nueva categoría");
    await h.say("Rent");
    await h.say("Home");

    const [category] = h.db.select().from(schema.categories).all();
    expect(purchases(h)[0]).toMatchObject({
      kind: "transfer",
      status: "categorized",
      categoryId: category?.id,
      categorizedBy: "user",
    });
    expect(h.message(prompt?.messageId)?.text).toBe(
      "✅ $300.000,00 ARS · Alquiler octubre\nRent (Home) · 22:32",
    );
    expect(h.db.select().from(schema.merchantRules).all()).toEqual([]);
  });

  it("Not an expense marks the transfer excluded", async () => {
    const h = setup();
    const prompt = await ingestTransfer(h);
    await h.tap(prompt, "↔️ No es un gasto");

    expect(purchases(h)[0]).toMatchObject({ kind: "transfer", status: "excluded" });
    expect(h.message(prompt?.messageId)).toMatchObject({
      text: "↗️ Transferencia $300.000,00 ARS\n22:32\n\n↔️ No es un gasto",
    });
    expect(h.message(prompt?.messageId)?.keyboard).toBeUndefined();
  });

  it("never creates a merchant rule, even when picking an existing category or changing it", async () => {
    const h = setup();
    const { store } = h.runtime;
    const user = await store.ensureUser({ telegramChatId: "42", locale: "es", timezone: "UTC" });
    const group = await store.ensureGroup(user.id, "Home");
    await store.createCategory(user.id, "Rent", group.id);
    await store.createCategory(user.id, "Services", group.id);

    const prompt = await ingestTransfer(h);
    await h.tap(prompt, "💸 Gasto");
    await h.say("Alquiler");
    await h.tap(prompt, "Más…");
    await h.tap(prompt, "Rent");
    await h.tap(prompt, "Cambiar");
    await h.tap(prompt, "Más…");
    await h.tap(prompt, "Services");

    expect(h.message(prompt?.messageId)?.text).toContain("Services (Home)");
    expect(h.db.select().from(schema.merchantRules).all()).toEqual([]);
  });

  it("ignores transfer buttons once the transfer was answered", async () => {
    const h = setup();
    const prompt = await ingestTransfer(h);
    await h.tap(prompt, "↔️ No es un gasto");

    // A stale Expense button (e.g. on another device) changes nothing.
    const sent = h.messages.length;
    const [purchase] = purchases(h);
    await h.telegram({
      callback_query: {
        id: "stale",
        data: encodeAction({ type: "transferExpense", purchaseId: purchase?.id ?? 0 }),
        message: { message_id: prompt?.messageId, chat: { id: CHAT_ID } },
      },
    });
    await h.say("Alquiler");
    expect(h.messages).toHaveLength(sent);
    expect(purchases(h)[0]).toMatchObject({ status: "excluded", merchantRaw: "Unknown" });
  });

  it("uses English strings with LOCALE=en", async () => {
    const h = setup("en");
    const prompt = await ingestTransfer(h);
    expect(prompt?.text).toBe("↗️ Transfer $300,000.00 ARS\n22:32");
    expect(h.buttons(prompt)).toEqual([["💸 Expense", "↔️ Not an expense"]]);
  });
});
