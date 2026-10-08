import { describe, expect, it } from "vitest";
import { parseManualPurchase } from "./manual-purchase";

describe("parseManualPurchase", () => {
  it.each([
    ["15000,50 Axion", { amountMinor: 1500050, currency: "ARS", merchant: "Axion" }],
    [
      "$15.000,50  Axion Villa Allende",
      { amountMinor: 1500050, currency: "ARS", merchant: "Axion Villa Allende" },
    ],
    ["USD 20 Claude", { amountMinor: 2000, currency: "USD", merchant: "Claude" }],
    ["20 usd Claude", { amountMinor: 2000, currency: "USD", merchant: "Claude" }],
    ["usd20 Claude", { amountMinor: 2000, currency: "USD", merchant: "Claude" }],
  ])("es: %s", (input, expected) => {
    expect(parseManualPurchase(input, "es")).toEqual(expected);
  });

  it("uses the en-US number format in English", () => {
    expect(parseManualPurchase("15,000.50 Axion", "en")).toEqual({
      amountMinor: 1500050,
      currency: "ARS",
      merchant: "Axion",
    });
  });

  it.each(["Axion", "15000", "0 Axion", "1,234 Axion", "abc 15000"])("rejects %s", (input) => {
    expect(parseManualPurchase(input, "es")).toBeNull();
  });
});
