import { describe, expect, it } from "vitest";
import { classify, compileRules, parsePack } from "./engine";
import { runPackTests } from "./run-tests";

const PACK = `
pack: test.bank
rules:
  - id: test.bank.ignore-bill
    kind: ignore
    priority: 10
    match:
      title: '^Pagaste tu tarjeta'
    tests:
      - title: 'Pagaste tu tarjeta VISA'
        text: 'Se debitaron $1,00 de tu cuenta.'
  - id: test.bank.purchase
    kind: purchase
    match:
      title: '^Pagaste (?<currency>\\$|USD) ?(?<amount>[\\d.,]+)$'
      text: '^A (?<merchant>.+?) con tu (?<method>.+?) (?<last4>\\d{4})$'
    transform:
      amount: { number_format: es-AR }
      currency: { map: { "$": ARS, USD: USD } }
      payment_method: 'Bank {method} {last4}'
      strip_prefixes: ['MERPAGO=']
    tests:
      - title: 'Pagaste $1.500,50'
        text: 'A MERPAGO&#x3D;Kiosco con tu Visa 1234.'
        expect: { amount: "1500.5", currency: ARS, merchant: "MERPAGO=Kiosco", payment_method: Bank Visa 1234 }
      - title: 'Pagaste tu tarjeta AMEX'
        text: 'x'
        expect_kind: ignore
`;

describe("rule engine", () => {
  const pack = parsePack("test.bank", PACK);
  const rules = compileRules([pack]);

  it("passes the pack's inline tests", () => {
    expect(runPackTests([pack])).toEqual([]);
  });

  it("extracts and normalizes fields", () => {
    const result = classify(rules, {
      app: "Bank",
      title: "Pagaste USD20",
      text: "A MERPAGO&#x3D;Shop con tu Visa 9999",
    });
    expect(result).toMatchObject({
      kind: "purchase",
      fields: {
        amount: "20",
        currency: "USD",
        merchant: "MERPAGO=Shop",
        merchantNormalized: "SHOP",
        paymentMethod: "Bank Visa 9999",
      },
    });
  });

  it("evaluates higher priority first", () => {
    expect(classify(rules, { app: "", title: "Pagaste tu tarjeta VISA", text: "" }).kind).toBe(
      "ignore",
    );
  });

  it("returns unmatched when no rule matches", () => {
    expect(classify(rules, { app: "", title: "Promo", text: "25% off" }).kind).toBe("unmatched");
  });

  it("puts user rules before pack rules", () => {
    const userRule = parsePack("user.x", PACK.replaceAll("test.bank", "user.x")).rules[1];
    if (!userRule) throw new Error("fixture");
    const ordered = compileRules([pack], [{ ...userRule, kind: "ignore" }]);
    expect(ordered[0]?.source).toBe("user");
  });

  it("rejects invalid packs", () => {
    expect(() => parsePack("test.bank", "pack: test.bank\nrules: []")).toThrow(/Invalid rule pack/);
    expect(() => parsePack("other.name", PACK)).toThrow(/declares pack/);
    const noAmount = PACK.replace("(?<amount>[\\d.,]+)", "([\\d.,]+)");
    expect(() => parsePack("test.bank", noAmount)).toThrow(/amount/);
  });
});
