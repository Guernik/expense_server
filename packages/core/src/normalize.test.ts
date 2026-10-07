import { describe, expect, it } from "vitest";
import { decodeEntities, normalizeBody, normalizeMerchant } from "./normalize";

describe("decodeEntities", () => {
  it("decodes hex, decimal and named entities", () => {
    expect(decodeEntities("MERPAGO&#x3D;CARREFOU")).toBe("MERPAGO=CARREFOU");
    expect(decodeEntities("A&#61;B &amp; C")).toBe("A=B & C");
    expect(decodeEntities("&unknown;")).toBe("&unknown;");
  });
});

describe("normalizeBody", () => {
  it("collapses whitespace and strips the trailing dot", () => {
    expect(normalizeBody("  A AXION   VILLA ALLENDE con tu Visa Crédito 3551 a las 22:32. ")).toBe(
      "A AXION VILLA ALLENDE con tu Visa Crédito 3551 a las 22:32",
    );
  });
});

describe("normalizeMerchant", () => {
  it("uppercases and strips the first matching processor prefix", () => {
    expect(normalizeMerchant("MERPAGO=Carrefou ", ["MERPAGO=", "DLO*"])).toBe("CARREFOU");
    expect(normalizeMerchant("DLO*PedidosYa Propina", ["MERPAGO=", "DLO*"])).toBe(
      "PEDIDOSYA PROPINA",
    );
    expect(normalizeMerchant("GOOGLE *Google One", ["MERPAGO=", "DLO*"])).toBe(
      "GOOGLE *GOOGLE ONE",
    );
  });
});
