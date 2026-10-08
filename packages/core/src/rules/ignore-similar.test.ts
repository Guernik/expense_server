import { describe, expect, it } from "vitest";
import { similarPattern } from "./ignore-similar";

describe("similarPattern", () => {
  it.each([
    ["Tu nuevo look, con promo💈✂️", "^Tu nuevo look, con promo💈✂️$"],
    ["Pagaste $15.000,01", "^Pagaste \\$[\\d.,]+$"],
    ["Ahorrá 25% (hasta $3.000)", "^Ahorrá [\\d.,]+% \\(hasta \\$[\\d.,]+\\)$"],
    ["2x1 en cines.", "^[\\d.,]+x[\\d.,]+ en cines\\.$"],
  ])("%s", (title, pattern) => {
    expect(similarPattern(title)).toBe(pattern);
    const regex = new RegExp(pattern, "u");
    expect(regex.test(title)).toBe(true);
  });

  it("matches the same title with other numbers", () => {
    const regex = new RegExp(similarPattern("Ahorrá 25% hasta $3.000"), "u");
    expect(regex.test("Ahorrá 30% hasta $12.500,50")).toBe(true);
    expect(regex.test("Ahorrá 30% hasta mañana")).toBe(false);
  });
});
