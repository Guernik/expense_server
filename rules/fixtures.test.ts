import { readdirSync, readFileSync } from "node:fs";
import { classify, compileRules, parsePack, toMinor } from "@denarii/core";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { PACK_SOURCES } from "./index";

/** One anonymized notification and the classification it must keep producing. */
interface Fixture {
  app?: string;
  title: string;
  text: string;
  expect: Record<string, unknown>;
}

const FIXTURES_DIR = new URL("../fixtures/", import.meta.url);

const files = readdirSync(FIXTURES_DIR, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".yaml"))
  .sort();

describe("fixture corpus", () => {
  const rules = compileRules(Object.entries(PACK_SOURCES).map(([n, y]) => parsePack(n, y)));

  it("is not empty", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  describe.each(files)("%s", (file) => {
    const fixtures = parseYaml(readFileSync(new URL(file, FIXTURES_DIR), "utf8")) as Fixture[];

    it.each(fixtures.map((f) => [`${f.title} | ${f.text}`, f] as const))("%s", (_, fixture) => {
      const result = classify(rules, { app: fixture.app ?? "", ...fixture });
      const actual =
        result.kind === "unmatched"
          ? { kind: result.kind }
          : result.kind === "ignore"
            ? { kind: result.kind, rule: result.rule.rule.id }
            : {
                kind: result.kind,
                rule: result.rule.rule.id,
                amount_minor: toMinor(result.fields.amount, result.fields.currency),
                currency: result.fields.currency,
                merchant: result.fields.merchant,
                merchant_normalized: result.fields.merchantNormalized,
                payment_method: result.fields.paymentMethod,
                time: result.fields.time,
              };
      expect(actual).toEqual(fixture.expect);
    });
  });
});
