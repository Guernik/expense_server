import { z } from "zod";
import { CURRENCIES } from "../money";

/** Classifier rule schema (SPEC §5.2, ADR-0002). Shared by bundled packs and user rules. */

const regex = z.string().refine(
  (source) => {
    try {
      new RegExp(source, "u");
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid regular expression" },
);

const currency = z.enum(CURRENCIES);

const ruleTest = z.object({
  title: z.string(),
  text: z.string(),
  app: z.string().optional(),
  expect_kind: z.enum(["purchase", "transfer", "ignore", "unmatched"]).optional(),
  expect: z
    .object({
      amount: z.string().optional(),
      currency: currency.optional(),
      merchant: z.string().optional(),
      payment_method: z.string().optional(),
      time: z.string().optional(),
    })
    .optional(),
});

export const ruleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/),
    kind: z.enum(["purchase", "transfer", "ignore"]),
    priority: z.number().int().default(0),
    match: z
      .object({ title: regex.optional(), text: regex.optional(), app: regex.optional() })
      .refine((m) => m.title || m.text || m.app, { message: "At least one match pattern" }),
    transform: z
      .object({
        amount: z.object({ number_format: z.enum(["es-AR", "en-US", "plain"]) }).optional(),
        currency: z
          .object({ map: z.record(z.string(), currency).optional(), default: currency.optional() })
          .optional(),
        payment_method: z.string().optional(),
        merchant: z.string().optional(),
        strip_prefixes: z.array(z.string()).optional(),
      })
      .default({}),
    tests: z.array(ruleTest).default([]),
  })
  .refine(
    (rule) =>
      rule.kind === "ignore" ||
      [rule.match.title, rule.match.text].some((p) => p?.includes("(?<amount>")),
    { message: "purchase/transfer rules must capture an `amount` group" },
  );

export const packSchema = z
  .object({
    pack: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
    rules: z.array(ruleSchema).min(1),
  })
  .superRefine((pack, ctx) => {
    for (const [i, rule] of pack.rules.entries()) {
      if (!rule.id.startsWith(`${pack.pack}.`)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", i, "id"],
          message: `Must start with "${pack.pack}."`,
        });
      }
      if (rule.tests.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", i, "tests"],
          message: "Pack rules need tests",
        });
      }
    }
  });

export type Rule = z.infer<typeof ruleSchema>;
export type RuleTest = z.infer<typeof ruleTest>;
export type Pack = z.infer<typeof packSchema>;
