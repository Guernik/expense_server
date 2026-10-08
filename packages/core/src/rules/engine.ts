import { parse as parseYaml } from "yaml";
import { type Currency, parseAmount } from "../money";
import { normalizeBody, normalizeMerchant, normalizeText } from "../normalize";
import type { RuleSource } from "../ports";
import { type Pack, packSchema, type Rule } from "./schema";

export interface CompiledRule {
  rule: Rule;
  source: RuleSource;
  title?: RegExp;
  text?: RegExp;
  app?: RegExp;
}

export interface Notification {
  app: string;
  title: string;
  text: string;
}

export interface ExtractedFields {
  amount: string;
  currency: Currency;
  merchant: string;
  merchantNormalized: string;
  paymentMethod?: string;
  time?: string;
}

/** Merchant of a rule that neither captures nor sets one. */
export const UNKNOWN_MERCHANT = "Unknown";

export type Classification =
  | { kind: "unmatched" }
  | { kind: "ignore"; rule: CompiledRule }
  | { kind: "purchase" | "transfer"; rule: CompiledRule; fields: ExtractedFields };

/** Parses and validates a YAML rule pack. Throws with the pack name on invalid input. */
export function parsePack(name: string, yaml: string): Pack {
  const result = packSchema.safeParse(parseYaml(yaml));
  if (!result.success) throw new Error(`Invalid rule pack ${name}: ${result.error.message}`);
  if (result.data.pack !== name)
    throw new Error(`Rule pack ${name} declares pack: ${result.data.pack}`);
  return result.data;
}

/** User rules first, then packs in the given order; each sorted by priority (stable). */
export function compileRules(packs: Pack[], userRules: Rule[] = []): CompiledRule[] {
  const compile = (rule: Rule, source: RuleSource): CompiledRule => ({
    rule,
    source,
    title: rule.match.title ? new RegExp(rule.match.title, "u") : undefined,
    text: rule.match.text ? new RegExp(rule.match.text, "u") : undefined,
    app: rule.match.app ? new RegExp(rule.match.app, "u") : undefined,
  });
  const byPriority = (a: CompiledRule, b: CompiledRule) => b.rule.priority - a.rule.priority;
  return [
    ...userRules.map((r) => compile(r, "user")).sort(byPriority),
    ...packs.flatMap((p) => p.rules.map((r) => compile(r, "pack"))).sort(byPriority),
  ];
}

/** First matching rule wins (SPEC §5.1). Only regex rules decide the kind (ADR-0001). */
export function classify(rules: CompiledRule[], notification: Notification): Classification {
  const app = normalizeText(notification.app);
  const title = normalizeText(notification.title);
  const text = normalizeBody(notification.text);

  for (const compiled of rules) {
    const groups: Record<string, string> = {};
    const matched = (
      [
        [compiled.app, app],
        [compiled.title, title],
        [compiled.text, text],
      ] as const
    ).every(([pattern, value]) => {
      if (!pattern) return true;
      const match = pattern.exec(value);
      if (match) Object.assign(groups, match.groups);
      return match !== null;
    });
    if (!matched) continue;

    if (compiled.rule.kind === "ignore") return { kind: "ignore", rule: compiled };
    return { kind: compiled.rule.kind, rule: compiled, fields: extract(compiled.rule, groups) };
  }
  return { kind: "unmatched" };
}

function extract(rule: Rule, groups: Record<string, string>): ExtractedFields {
  const { transform } = rule;
  const rawAmount = groups.amount;
  if (rawAmount === undefined) throw new Error(`Rule ${rule.id} matched without an amount`);

  const token = groups.currency?.trim();
  const currency =
    (token !== undefined ? transform.currency?.map?.[token] : undefined) ??
    transform.currency?.default;
  if (!currency) throw new Error(`Rule ${rule.id}: no currency for token "${token ?? ""}"`);

  const merchant = transform.merchant ?? groups.merchant?.trim() ?? UNKNOWN_MERCHANT;
  const paymentMethod = transform.payment_method
    ? fillTemplate(transform.payment_method, groups)
    : undefined;

  return {
    amount: parseAmount(rawAmount, transform.amount?.number_format ?? "plain"),
    currency,
    merchant,
    merchantNormalized: normalizeMerchant(merchant, transform.strip_prefixes),
    paymentMethod,
    time: groups.time,
  };
}

function fillTemplate(template: string, groups: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, name: string) => groups[name]?.trim() ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
