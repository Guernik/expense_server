import type {
  ExtractPurchaseOutput,
  LlmProvider,
  ProposeRuleInput,
  ProposeRuleOutput,
} from "@denarii/core";
import { schema } from "@denarii/db";
import { describe, expect, it } from "vitest";
import { setup } from "./test-harness";

type Harness = ReturnType<typeof setup>;

/** An unmatched notification shape: no bundled pack knows it. Anonymized. */
const NOTIFICATION = {
  app: "Naranja X",
  title: "Compraste con tu tarjeta",
  text: "Pagaste $ 4.250,50 en FARMACIA CENTRAL con Visa 1234 a las 14:05.",
  received_at: "2026-10-05T14:05:30-03:00",
};
const NOTICE =
  '❓ Notificación no reconocida (Naranja X)\n"Compraste con tu tarjeta"\n' +
  '"Pagaste $ 4.250,50 en FARMACIA CENTRAL con Visa 1234 a las 14:05"';

const EXTRACTION: ExtractPurchaseOutput = {
  amount: "4250.50",
  currency: "ARS",
  merchant: "FARMACIA CENTRAL",
  paymentMethod: "Naranja X Visa 1234",
  time: "14:05",
};
const EXTRACTION_TEXT =
  "🔎 $4.250,50 ARS · FARMACIA CENTRAL\nNaranja X Visa 1234 · 14:05\n¿Es correcto?";

const TEXT_PATTERN =
  "^Pagaste (?<currency>\\$|USD) ?(?<amount>[\\d.,]+) en (?<merchant>.+?) con (?<method>.+?) (?<last4>\\d{4}) a las (?<time>\\d{2}:\\d{2})$";
const PROPOSAL: ProposeRuleOutput = {
  title: "^Compraste con tu tarjeta$",
  text: TEXT_PATTERN,
  numberFormat: "es-AR",
  currencyMap: { $: "ARS", USD: "USD" },
  defaultCurrency: null,
  paymentMethod: "Naranja X {method} {last4}",
  merchant: null,
};
const PROPOSAL_TEXT =
  "¿Guardar una regla para registrar automáticamente las notificaciones como esta?\n" +
  `título: ^Compraste con tu tarjeta$\ntexto: ${TEXT_PATTERN}`;

/** A fake provider: no network. Each answer may be an Error to reject with. */
function fakeLlm(
  extraction: ExtractPurchaseOutput | Error = EXTRACTION,
  proposal: ProposeRuleOutput | Error = PROPOSAL,
) {
  const proposeCalls: ProposeRuleInput[] = [];
  const llm: LlmProvider = {
    async suggestCategory() {
      throw new Error("no suggestion");
    },
    async extractPurchase() {
      if (extraction instanceof Error) throw extraction;
      return extraction;
    },
    async proposeRule(input) {
      proposeCalls.push(input);
      if (proposal instanceof Error) throw proposal;
      return proposal;
    },
  };
  return { llm, proposeCalls };
}

async function ingest(h: Harness, body: object) {
  const count = h.messages.length;
  await h.ingest(body);
  await h.settled();
  return h.messages.length > count ? h.messages.at(-1) : undefined;
}

const events = (h: Harness) => h.db.select().from(schema.events).all();
const purchases = (h: Harness) => h.db.select().from(schema.purchases).all();
const userRules = (h: Harness) => h.db.select().from(schema.classifierRules).all();
const paymentMethods = (h: Harness) => h.db.select().from(schema.paymentMethods).all();

/** PURCHASE on a fresh unmatched notification. Returns the notice and the extraction message. */
async function answerPurchase(h: Harness) {
  const notice = await ingest(h, NOTIFICATION);
  await h.tap(notice, "💳 COMPRA");
  return { notice, extraction: h.messages.at(-1) };
}

describe("LLM extraction for an unmatched PURCHASE", () => {
  it("shows the extraction with Correct / Edit", async () => {
    const h = setup("es", { llm: fakeLlm().llm });
    const { extraction } = await answerPurchase(h);
    expect(extraction?.text).toBe(EXTRACTION_TEXT);
    expect(h.buttons(extraction)).toEqual([["✅ Correcto", "✏️ Editar"]]);
    expect(purchases(h)).toHaveLength(0);
  });

  it("Correct records the purchase, offers the rule, then opens the category picker", async () => {
    const h = setup("es", { llm: fakeLlm().llm });
    const { notice, extraction } = await answerPurchase(h);
    await h.tap(extraction, "✅ Correcto");

    expect(h.message(extraction?.messageId)?.text).toBe(EXTRACTION_TEXT);
    expect(h.buttons(extraction)).toBeUndefined();
    expect(h.message(notice?.messageId)?.text).toBe(`${NOTICE}\n\n💳 COMPRA`);

    expect(purchases(h)).toEqual([
      expect.objectContaining({
        kind: "purchase",
        status: "pending",
        amountMinor: 425050,
        currency: "ARS",
        merchantRaw: "FARMACIA CENTRAL",
        merchantNormalized: "FARMACIA CENTRAL",
        paymentMethodId: paymentMethods(h)[0]?.id,
        occurredAt: "2026-10-05T17:05:00.000Z",
      }),
    ]);
    expect(paymentMethods(h)[0]?.label).toBe("Naranja X Visa 1234");
    expect(events(h)[0]).toMatchObject({
      status: "purchase",
      purchaseId: purchases(h)[0]?.id,
      extractedBy: "llm",
    });

    const [proposal, picker] = h.messages.slice(-2);
    expect(proposal?.text).toBe(PROPOSAL_TEXT);
    expect(h.buttons(proposal)).toEqual([["Guardar regla", "No"]]);
    expect(picker?.text).toBe("🛒 $4.250,50 ARS · FARMACIA CENTRAL\nNaranja X Visa 1234 · 14:05");
    expect(h.buttons(picker)?.at(-1)).toEqual(["🚫 No es una compra", "Omitir"]);
  });

  it("Edit falls back to the typed amount and merchant", async () => {
    const h = setup("es", { llm: fakeLlm().llm });
    const { extraction } = await answerPurchase(h);
    await h.tap(extraction, "✏️ Editar");
    expect(h.buttons(extraction)).toBeUndefined();
    expect(h.messages.at(-1)?.text).toBe(
      "Escribí el monto y el comercio, por ejemplo 15000,50 Axion. Agregá USD si fue en dólares.",
    );

    await h.say("4300 Farmacia");
    expect(purchases(h)[0]).toMatchObject({
      amountMinor: 430000,
      merchantRaw: "Farmacia",
      paymentMethodId: null,
    });
    expect(events(h)[0]).toMatchObject({ status: "purchase", extractedBy: "user" });
  });

  it("typing instead of tapping answers like Edit", async () => {
    const h = setup("es", { llm: fakeLlm().llm });
    await answerPurchase(h);
    await h.say("4250,50 Farmacia Central");
    expect(purchases(h)[0]).toMatchObject({ amountMinor: 425050, merchantRaw: "Farmacia Central" });
    expect(events(h)[0]?.extractedBy).toBe("user");
  });

  it("asks for typed entry when the LLM fails", async () => {
    const h = setup("es", { llm: fakeLlm(new Error("timeout")).llm });
    await answerPurchase(h);
    expect(h.messages.at(-1)?.text).toBe(
      "Escribí el monto y el comercio, por ejemplo 15000,50 Axion. Agregá USD si fue en dólares.",
    );
    expect(h.buttons(h.messages.at(-1))).toBeUndefined();
  });

  it("asks for typed entry when the extraction doesn't validate", async () => {
    const h = setup("es", { llm: fakeLlm({ amount: "cuatro mil" }).llm });
    await answerPurchase(h);
    expect(h.messages.at(-1)?.text).toContain("Escribí el monto y el comercio");
  });

  it("asks for typed entry without a provider and proposes no rule", async () => {
    const h = setup("es");
    await answerPurchase(h);
    expect(h.messages.at(-1)?.text).toContain("Escribí el monto y el comercio");
    await h.say("4250,50 FARMACIA CENTRAL");
    expect(purchases(h)).toHaveLength(1);
    expect(userRules(h)).toHaveLength(0);
  });

  it("refuses Correct once the extraction is no longer pending", async () => {
    const h = setup("es", { llm: fakeLlm().llm });
    const { extraction } = await answerPurchase(h);
    const stale = h.messages.find((m) => m.messageId === extraction?.messageId);
    const data = stale?.keyboard?.[0]?.[0]?.data;
    await h.tap(extraction, "✅ Correcto");
    await h.telegram({
      callback_query: {
        id: "again",
        data,
        message: { message_id: extraction?.messageId, chat: { id: 42 } },
      },
    });
    expect(purchases(h)).toHaveLength(1);
    expect(h.toasts.at(-1)).toBe("Esto expiró. Abrí el selector de nuevo.");
  });
});

describe("LLM rule proposal", () => {
  it("saves the rule only on Save rule, and later notifications use it", async () => {
    const h = setup("es", { llm: fakeLlm().llm });
    const { extraction } = await answerPurchase(h);
    await h.tap(extraction, "✅ Correcto");
    const proposal = h.messages.at(-2);
    expect(userRules(h)).toEqual([expect.objectContaining({ enabled: false })]);

    // Before Save rule, the proposal is never evaluated.
    h.clock.current = new Date("2026-10-06T12:00:00Z");
    const before = await ingest(h, { ...NOTIFICATION, received_at: "2026-10-06T09:00:00-03:00" });
    expect(before?.text).toContain("❓ Notificación no reconocida");
    expect(events(h)[1]?.status).toBe("unmatched");

    await h.tap(proposal, "Guardar regla");
    expect(h.message(proposal?.messageId)?.text).toBe(
      `${PROPOSAL_TEXT}\n\n✅ Regla guardada. Las notificaciones como esta se van a registrar automáticamente.`,
    );
    expect(h.buttons(proposal)).toBeUndefined();
    const [rule] = userRules(h);
    expect(rule).toMatchObject({ enabled: true, createdFromEventId: events(h)[0]?.id });
    expect(rule?.definition).toMatchObject({
      id: expect.stringMatching(/^user\.[0-9a-f-]{36}$/),
      kind: "purchase",
      match: { title: "^Compraste con tu tarjeta$", text: TEXT_PATTERN },
    });

    const picker = await ingest(h, {
      ...NOTIFICATION,
      text: "Pagaste $ 12.000 en KIOSCO NORTE con Visa 1234 a las 20:10.",
      received_at: "2026-10-07T20:10:30-03:00",
    });
    expect(events(h)[2]).toMatchObject({
      status: "purchase",
      ruleId: (rule?.definition as { id: string } | undefined)?.id,
      ruleSource: "user",
      extractedBy: "regex",
    });
    expect(purchases(h)[1]).toMatchObject({
      amountMinor: 1200000,
      merchantNormalized: "KIOSCO NORTE",
      paymentMethodId: paymentMethods(h)[0]?.id,
    });
    expect(picker?.text).toBe("🛒 $12.000,00 ARS · KIOSCO NORTE\nNaranja X Visa 1234 · 20:10");
  });

  it("No discards the proposal", async () => {
    const h = setup("es", { llm: fakeLlm().llm });
    const { extraction } = await answerPurchase(h);
    await h.tap(extraction, "✅ Correcto");
    const proposal = h.messages.at(-2);
    await h.tap(proposal, "No");
    expect(h.message(proposal?.messageId)?.text).toBe(`${PROPOSAL_TEXT}\n\nNo se guardó la regla.`);
    expect(h.buttons(proposal)).toBeUndefined();
    expect(userRules(h)).toHaveLength(0);
  });

  it("never shows a proposal that doesn't reproduce the confirmed fields", async () => {
    const h = setup("es", { llm: fakeLlm(EXTRACTION, { ...PROPOSAL, numberFormat: "en-US" }).llm });
    const { extraction } = await answerPurchase(h);
    await h.tap(extraction, "✅ Correcto");
    expect(h.messages.some((m) => m.text.includes("¿Guardar una regla"))).toBe(false);
    expect(userRules(h)).toHaveLength(0);
    expect(h.messages.at(-1)?.text).toContain("🛒 $4.250,50 ARS · FARMACIA CENTRAL");
  });

  it("skips the proposal when the LLM fails", async () => {
    const h = setup("es", { llm: fakeLlm(EXTRACTION, new Error("timeout")).llm });
    const { extraction } = await answerPurchase(h);
    await h.tap(extraction, "✅ Correcto");
    expect(userRules(h)).toHaveLength(0);
    expect(h.messages.at(-1)?.text).toContain("🛒 $4.250,50 ARS · FARMACIA CENTRAL");
  });

  it("validates a proposal after typed entry against the typed fields", async () => {
    const { llm, proposeCalls } = fakeLlm();
    const h = setup("es", { llm });
    const { extraction } = await answerPurchase(h);
    await h.tap(extraction, "✏️ Editar");
    await h.say("4250,50 FARMACIA CENTRAL");
    expect(proposeCalls[0]?.confirmed).toEqual({
      amount: "4250.5",
      currency: "ARS",
      merchant: "FARMACIA CENTRAL",
      paymentMethod: null,
      time: null,
    });
    expect(userRules(h)).toEqual([expect.objectContaining({ enabled: false })]);
  });

  it("English strings", async () => {
    const h = setup("en", { llm: fakeLlm().llm });
    const notice = await ingest(h, NOTIFICATION);
    await h.tap(notice, "💳 PURCHASE");
    const extraction = h.messages.at(-1);
    expect(extraction?.text).toBe(
      "🔎 $4,250.50 ARS · FARMACIA CENTRAL\nNaranja X Visa 1234 · 14:05\nIs this right?",
    );
    await h.tap(extraction, "✅ Correct");
    const proposal = h.messages.at(-2);
    expect(proposal?.text).toContain(
      "Save a rule so notifications like this are recorded automatically?\ntitle: ",
    );
    await h.tap(proposal, "Save rule");
    expect(h.message(proposal?.messageId)?.text).toContain(
      "✅ Rule saved. Notifications like this will be recorded automatically.",
    );
  });
});
