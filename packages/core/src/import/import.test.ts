import { describe, expect, it } from "vitest";
import { parseImportFile, type RawImportRow } from "./parse";
import { type ImportPlan, planImport } from "./plan";

const TZ = "America/Argentina/Cordoba";

function plan(rows: RawImportRow[]): ImportPlan {
  const result = planImport(rows, { timezone: TZ, stripPrefixes: ["MERPAGO=", "DLO*"] });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.plan;
}

function row(line: number, values: Record<string, unknown>): RawImportRow {
  return {
    line,
    values: {
      date: "2026-09-14",
      merchant: "AXION VILLA ALLENDE",
      amount: "15000.01",
      currency: "ARS",
      payment_method: "Galicia Visa Crédito 3551",
      category: "Fuel",
      group: "Transport",
      ...values,
    },
  };
}

describe("parseImportFile", () => {
  it("reads a JSON array with the line each row starts on", () => {
    const json = `[
  { "date": "2026-09-14", "time": "22:32", "merchant": "AXION VILLA ALLENDE",
    "amount": "15000.01", "currency": "ARS", "payment_method": "Galicia Visa Crédito 3551",
    "category": "Fuel", "group": "Transport", "comment": null },
  {"date": "2026-09-15", "merchant": "a, \\"b\\" [c]", "amount": "1"},
  {
    "date": "2026-09-16"
  }
]`;
    const result = parseImportFile("history.JSON", json);
    expect(result).toMatchObject({
      ok: true,
      rows: [
        { line: 2, values: { time: "22:32", comment: null } },
        { line: 5, values: { merchant: 'a, "b" [c]' } },
        { line: 6, values: { date: "2026-09-16" } },
      ],
    });
  });

  it("rejects JSON that is not an array of objects", () => {
    expect(parseImportFile("a.json", "{}")).toMatchObject({ ok: false });
    expect(parseImportFile("a.json", "[1]")).toMatchObject({ ok: false });
    expect(parseImportFile("a.json", "[")).toMatchObject({ ok: false });
  });

  it("reads CSV with quoted fields, CRLF and blank optional cells", () => {
    const csv =
      "date,time,merchant,amount,currency,payment_method,category,group,comment\r\n" +
      '2026-09-14,22:32,"AXION, VILLA ""ALLENDE""",15000.01,ARS,Galicia Visa Crédito 3551,Fuel,Transport,\r\n' +
      '2026-09-15,,CAFE,10,USD,Mercado Pago cuenta,Coffee,Food,"two\nlines"\r\n' +
      "2026-09-16,,BAR,10,USD,Mercado Pago cuenta,Coffee,Food,\r\n";
    const result = parseImportFile("history.csv", csv);
    expect(result).toMatchObject({
      ok: true,
      rows: [
        { line: 2, values: { merchant: 'AXION, VILLA "ALLENDE"', time: "22:32" } },
        { line: 3, values: { merchant: "CAFE", comment: "two\nlines" } },
        { line: 5, values: { merchant: "BAR" } },
      ],
    });
    if (result.ok) expect(result.rows[0]?.values).not.toHaveProperty("comment");
  });

  it("reports CSV rows with the wrong number of columns by line", () => {
    const csv = "date,merchant\n2026-09-14,A\n2026-09-15,B,extra\n";
    expect(parseImportFile("a.csv", csv)).toEqual({
      ok: false,
      errors: [{ line: 3, message: "Expected 2 columns, found 3" }],
    });
  });

  it("rejects other extensions", () => {
    expect(parseImportFile("a.txt", "")).toMatchObject({ ok: false });
  });
});

describe("planImport", () => {
  it("builds the taxonomy, payment methods and purchases from the rows", () => {
    const result = plan([
      row(2, { time: "22:32", comment: "full tank" }),
      row(3, {
        merchant: "MERPAGO=Rappi",
        amount: "8500",
        payment_method: "Mercado Pago cuenta",
        category: "Delivery",
        group: "Food",
      }),
      row(4, {
        merchant: "Coto",
        amount: "20.5",
        currency: "usd",
        category: "groceries",
        group: "food",
      }),
    ]);
    expect(result.groups).toEqual(["Transport", "Food"]);
    expect(result.categories).toEqual([
      { name: "Fuel", group: "Transport" },
      { name: "Delivery", group: "Food" },
      { name: "groceries", group: "Food" },
    ]);
    expect(result.paymentMethods).toEqual(["Galicia Visa Crédito 3551", "Mercado Pago cuenta"]);
    expect(result.purchases).toMatchObject([
      {
        line: 2,
        amountMinor: 1500001,
        currency: "ARS",
        merchantRaw: "AXION VILLA ALLENDE",
        merchantNormalized: "AXION VILLA ALLENDE",
        comment: "full tank",
        occurrence: 1,
      },
      {
        merchantRaw: "MERPAGO=Rappi",
        merchantNormalized: "RAPPI",
        amountMinor: 850000,
        comment: null,
      },
      { merchantNormalized: "COTO", amountMinor: 2050, currency: "USD" },
    ]);
  });

  it("resolves occurred_at in the time zone, midnight without a time", () => {
    const [withTime, withoutTime] = plan([row(2, { time: "22:32" }), row(3, {})]).purchases;
    expect(withTime?.occurredAt.toISOString()).toBe("2026-09-15T01:32:00.000Z");
    expect(withoutTime?.occurredAt.toISOString()).toBe("2026-09-14T03:00:00.000Z");
    expect(withoutTime?.day.from.toISOString()).toBe("2026-09-14T03:00:00.000Z");
    expect(withoutTime?.day.to.toISOString()).toBe("2026-09-15T03:00:00.000Z");
  });

  it("creates merchant rules only for merchants with exactly one category", () => {
    const result = plan([
      row(2, { merchant: "AXION" }),
      row(3, { merchant: "axion", date: "2026-09-20" }),
      row(4, { merchant: "COTO", category: "Groceries", group: "Food" }),
      row(5, { merchant: "COTO", category: "Pharmacy", group: "Health" }),
      row(6, { merchant: "Unknown", category: "Groceries", group: "Food" }),
      row(7, { merchant: "CAFE", category: "Coffee", group: "Food" }),
      row(8, { merchant: "CAFE", category: "coffee", group: "Food" }),
    ]);
    expect(result.merchantRules).toEqual([
      { merchantNormalized: "AXION", category: "Fuel" },
      { merchantNormalized: "CAFE", category: "Coffee" },
    ]);
  });

  it("numbers rows that repeat the same date, merchant, amount and currency", () => {
    const result = plan([row(2, {}), row(3, {}), row(4, { currency: "USD" }), row(5, {})]);
    expect(result.purchases.map((p) => p.occurrence)).toEqual([1, 2, 1, 3]);
  });

  it("reports every invalid row with its line and plans nothing", () => {
    const result = planImport(
      [
        row(2, {}),
        row(3, { date: "2026-02-30", amount: "1,5" }),
        row(4, { currency: "EUR", merchant: "  " }),
        row(5, { time: "25:00", category: undefined }),
        row(6, { amount: "1.001" }),
        row(7, { category: "fuel", group: "Car" }),
      ],
      { timezone: TZ },
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { line: 3, message: "date: is not a valid date" },
        {
          line: 3,
          message: 'amount: must be a positive number with "." as the decimal separator',
        },
        { line: 4, message: "merchant: must not be empty" },
        { line: 4, message: "currency: must be one of ARS, USD" },
        { line: 5, message: "time: must be HH:MM" },
        { line: 5, message: expect.stringContaining("category:") },
        { line: 6, message: "amount: too many decimals for ARS" },
        { line: 7, message: 'category: "Fuel" is in group "Transport" on line 2, not "Car"' },
      ],
    });
  });

  it("rejects an empty file", () => {
    expect(planImport([], { timezone: TZ })).toMatchObject({ ok: false });
  });
});
