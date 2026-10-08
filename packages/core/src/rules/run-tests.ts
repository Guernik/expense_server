import { classify, compileRules } from "./engine";
import type { Pack } from "./schema";

export interface RuleTestFailure {
  ruleId: string;
  index: number;
  message: string;
}

/**
 * Runs every rule's inline tests against the full rule set, so precedence between
 * rules is exercised too (a test of rule A fails if rule B shadows it).
 */
export function runPackTests(packs: Pack[]): RuleTestFailure[] {
  const rules = compileRules(packs);
  const failures: RuleTestFailure[] = [];

  for (const pack of packs) {
    for (const rule of pack.rules) {
      for (const [index, test] of rule.tests.entries()) {
        const fail = (message: string) => failures.push({ ruleId: rule.id, index, message });
        const result = classify(rules, { app: test.app ?? "", title: test.title, text: test.text });
        const expectedKind = test.expect_kind ?? rule.kind;

        if (result.kind !== expectedKind) {
          fail(`expected kind ${expectedKind}, got ${result.kind}`);
          continue;
        }
        // A test may assert another kind (e.g. a near-miss that a different rule ignores).
        if (result.kind === "unmatched" || expectedKind !== rule.kind) continue;
        if (result.rule.rule.id !== rule.id) {
          fail(`matched by ${result.rule.rule.id} instead`);
          continue;
        }
        if (!test.expect || result.kind === "ignore") continue;

        const actual = {
          amount: result.fields.amount,
          currency: result.fields.currency,
          merchant: result.fields.merchant,
          payment_method: result.fields.paymentMethod,
          time: result.fields.time,
        };
        for (const [field, expected] of Object.entries(test.expect)) {
          const got = actual[field as keyof typeof actual];
          if (expected !== undefined && String(got) !== String(expected)) {
            fail(`${field}: expected "${expected}", got "${got}"`);
          }
        }
      }
    }
  }
  return failures;
}
