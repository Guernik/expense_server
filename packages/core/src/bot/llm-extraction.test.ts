import { describe, expect, it } from "vitest";
import type { ConfirmedFields, LlmProvider, ProposeRuleOutput, StoredEvent } from "../ports";
import {
  extractPurchase,
  proposeRule,
  validateExtraction,
  validateProposedRule,
} from "./llm-extraction";

const EVENT: StoredEvent = {
  id: 7,
  userId: 1,
  app: "Naranja X",
  title: "Compraste con tu tarjeta",
  text: "Pagaste $ 4.250,50 en FARMACIA CENTRAL con Visa 1234 a las 14:05.",
  receivedAt: new Date("2026-10-05T17:05:30Z"),
  status: "unmatched",
  purchaseId: null,
};

const CONFIRMED: ConfirmedFields = {
  amountMinor: 425050,
  currency: "ARS",
  merchant: "FARMACIA CENTRAL",
  paymentMethod: "Naranja X Visa 1234",
  time: "14:05",
};

const PROPOSAL: ProposeRuleOutput = {
  title: "^Compraste con tu tarjeta$",
  text: "^Pagaste (?<currency>\\$|USD) ?(?<amount>[\\d.,]+) en (?<merchant>.+?) con (?<method>.+?) (?<last4>\\d{4}) a las (?<time>\\d{2}:\\d{2})$",
  numberFormat: "es-AR",
  currencyMap: { $: "ARS", USD: "USD" },
  defaultCurrency: null,
  paymentMethod: "Naranja X {method} {last4}",
  merchant: null,
};

function llmFailing(): LlmProvider {
  const fail = async () => {
    throw new Error("timeout");
  };
  return { suggestCategory: fail, extractPurchase: fail, proposeRule: fail };
}

describe("validateExtraction", () => {
  it("accepts a full extraction", () => {
    expect(
      validateExtraction({
        amount: "4250.50",
        currency: "ARS",
        merchant: " FARMACIA  CENTRAL ",
        paymentMethod: "Naranja X Visa 1234",
        time: "14:05",
      }),
    ).toEqual(CONFIRMED);
  });

  it("defaults the currency to ARS, the merchant to Unknown, and drops a bad time", () => {
    expect(validateExtraction({ amount: "20", time: "25:00" })).toEqual({
      amountMinor: 2000,
      currency: "ARS",
      merchant: "Unknown",
      paymentMethod: null,
      time: null,
    });
  });

  it.each([
    { amount: null },
    { amount: "4.250,50" },
    { amount: "0" },
    { amount: "-5" },
    { amount: "1.234" },
    { amount: "10", currency: "EUR" },
  ])("rejects %j", (output) => {
    expect(validateExtraction(output)).toBeNull();
  });
});

describe("extractPurchase", () => {
  it("returns null without a provider or when it fails", async () => {
    expect(await extractPurchase(undefined, EVENT)).toBeNull();
    expect(await extractPurchase(llmFailing(), EVENT)).toBeNull();
  });

  it("sends the event normalized as the classifier sees it", async () => {
    let seen: unknown;
    const llm: LlmProvider = {
      ...llmFailing(),
      async extractPurchase(input) {
        seen = input;
        return { amount: "4250.5", merchant: "FARMACIA CENTRAL" };
      },
    };
    expect(await extractPurchase(llm, EVENT)).toMatchObject({ amountMinor: 425050 });
    expect(seen).toEqual({
      app: "Naranja X",
      title: "Compraste con tu tarjeta",
      text: "Pagaste $ 4.250,50 en FARMACIA CENTRAL con Visa 1234 a las 14:05",
    });
  });
});

describe("validateProposedRule", () => {
  it("keeps a rule that reproduces every confirmed field, with the event as its test", () => {
    const rule = validateProposedRule(PROPOSAL, EVENT, CONFIRMED);
    expect(rule).toMatchObject({
      id: expect.stringMatching(/^user\.[0-9a-f-]{36}$/),
      kind: "purchase",
      match: { title: PROPOSAL.title, text: PROPOSAL.text },
      transform: {
        amount: { number_format: "es-AR" },
        currency: { map: { $: "ARS", USD: "USD" } },
        payment_method: "Naranja X {method} {last4}",
      },
      tests: [
        {
          title: EVENT.title,
          text: EVENT.text,
          expect: { amount: "4250.5", currency: "ARS", merchant: "FARMACIA CENTRAL" },
        },
      ],
    });
  });

  it("only checks the fields the user confirmed", () => {
    const typed = { ...CONFIRMED, paymentMethod: null, time: null };
    expect(validateProposedRule(PROPOSAL, EVENT, typed)).not.toBeNull();
  });

  it.each<[string, ProposeRuleOutput, Partial<ConfirmedFields>]>([
    ["no pattern", { ...PROPOSAL, title: null, text: null }, {}],
    ["invalid regex", { ...PROPOSAL, title: "^Compraste (" }, {}],
    ["no amount group", { ...PROPOSAL, text: "^Pagaste .+$" }, {}],
    ["does not match", { ...PROPOSAL, title: "^Pagaste$" }, {}],
    ["wrong number format", { ...PROPOSAL, numberFormat: "en-US" }, {}],
    ["unmapped currency", { ...PROPOSAL, currencyMap: null }, {}],
    ["unsupported currency", { ...PROPOSAL, currencyMap: { $: "EUR" } }, {}],
    ["unknown number format", { ...PROPOSAL, numberFormat: "de-DE" }, {}],
    ["other merchant", PROPOSAL, { merchant: "FARMACIA" }],
    ["other payment method", PROPOSAL, { paymentMethod: "Visa 1234" }],
    ["other time", PROPOSAL, { time: "14:06" }],
    ["other amount", PROPOSAL, { amountMinor: 425000 }],
  ])("drops a proposal with %s", (_, output, confirmed) => {
    expect(validateProposedRule(output, EVENT, { ...CONFIRMED, ...confirmed })).toBeNull();
  });
});

describe("proposeRule", () => {
  it("returns null without a provider or when it fails", async () => {
    expect(await proposeRule(undefined, EVENT, CONFIRMED)).toBeNull();
    expect(await proposeRule(llmFailing(), EVENT, CONFIRMED)).toBeNull();
  });

  it("passes the confirmed fields with the amount as a decimal", async () => {
    let seen: unknown;
    const llm: LlmProvider = {
      ...llmFailing(),
      async proposeRule(input) {
        seen = input;
        return PROPOSAL;
      },
    };
    expect(await proposeRule(llm, EVENT, CONFIRMED)).not.toBeNull();
    expect(seen).toMatchObject({
      title: "Compraste con tu tarjeta",
      confirmed: {
        amount: "4250.5",
        currency: "ARS",
        merchant: "FARMACIA CENTRAL",
        paymentMethod: "Naranja X Visa 1234",
        time: "14:05",
      },
    });
  });
});
