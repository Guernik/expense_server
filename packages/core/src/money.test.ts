import { describe, expect, it } from "vitest";
import { formatMoney, fromMinor, parseAmount, toMinor } from "./money";

describe("parseAmount", () => {
  it.each([
    ["15.000,01", "es-AR", "15000.01"],
    ["1.172,30", "es-AR", "1172.3"],
    ["20", "es-AR", "20"],
    [" 28,64", "es-AR", "28.64"],
    ["19990", "es-AR", "19990"],
    ["1,172.30", "en-US", "1172.3"],
    ["0050.10", "plain", "50.1"],
  ] as const)("%s (%s) -> %s", (raw, format, expected) => {
    expect(parseAmount(raw, format)).toBe(expected);
  });

  it("rejects garbage", () => {
    expect(() => parseAmount("12a", "es-AR")).toThrow();
  });
});

describe("toMinor", () => {
  it("converts to minor units", () => {
    expect(toMinor("15000.01", "ARS")).toBe(1500001);
    expect(toMinor("1172.3", "USD")).toBe(117230);
    expect(toMinor("20", "USD")).toBe(2000);
  });

  it("rejects extra precision", () => {
    expect(() => toMinor("1.234", "ARS")).toThrow();
  });
});

describe("formatMoney", () => {
  it("formats per locale with currency code", () => {
    expect(formatMoney(1500001, "ARS", "es-AR")).toBe("$15.000,01 ARS");
    expect(formatMoney(2000, "USD", "en-US")).toBe("US$20.00 USD");
  });
});

describe("fromMinor", () => {
  it.each([
    [1500001, "15000.01"],
    [1500050, "15000.5"],
    [2000, "20"],
    [5, "0.05"],
  ])("%i -> %s", (minor, decimal) => {
    expect(fromMinor(minor, "ARS")).toBe(decimal);
    expect(toMinor(decimal, "ARS")).toBe(minor);
  });
});
