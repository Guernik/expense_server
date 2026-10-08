import {
  CURRENCIES,
  type ExtractPurchaseInput,
  formatMoney,
  type ProposeRuleInput,
  type SuggestCategoryInput,
} from "@denarii/core";
import { z } from "zod";

/** Structured output shared by every provider (ADR-0010). Validated again by the core. */
export const suggestCategorySchema = z.object({
  category_id: z.number().int().nullable(),
  new_category_name: z.string().nullable(),
  group_id: z.number().int().nullable(),
  new_group_name: z.string().nullable(),
});

export const SUGGEST_CATEGORY_SYSTEM = [
  "You categorize purchases for a personal expense tracker.",
  "Each category belongs to exactly one group.",
  "Pick the existing category that best fits the purchase and set category_id.",
  "Only when none fits, leave category_id null, set new_category_name to a short name " +
    "(at most 40 characters, in the language of the existing categories), and set group_id " +
    "to an existing group or new_group_name to a new one.",
  "The user's own past choices are the strongest signal: follow them for similar merchants.",
].join("\n");

/** The purchase, the taxonomy and the examples as plain text for the user turn. */
export function suggestCategoryPrompt(input: SuggestCategoryInput): string {
  const money = (minor: number, currency: SuggestCategoryInput["currency"]) =>
    formatMoney(minor, currency, "en-US");
  const lines = [
    "Purchase:",
    `- merchant: ${input.merchant}`,
    `- amount: ${money(input.amountMinor, input.currency)}`,
    `- payment method: ${input.paymentMethod ?? "unknown"}`,
    "",
    "Groups (id: name):",
    ...(input.groups.length ? input.groups.map((g) => `- ${g.id}: ${g.name}`) : ["- (none)"]),
    "",
    "Categories (id: name, group):",
    ...(input.categories.length
      ? input.categories.map((c) => `- ${c.id}: ${c.name}, ${c.group.name}`)
      : ["- (none)"]),
    "",
    "Recent purchases the user categorized:",
    ...(input.examples.length
      ? input.examples.map(
          (e) =>
            `- ${e.merchant} (${money(e.amountMinor, e.currency)}) -> ${e.category.name} (${e.category.group.name})`,
        )
      : ["- (none)"]),
  ];
  return lines.join("\n");
}

/** Structured output for `extractPurchase`. Validated again by the core. */
export const extractPurchaseSchema = z.object({
  amount: z.string().nullable(),
  currency: z.enum(CURRENCIES).nullable(),
  merchant: z.string().nullable(),
  payment_method: z.string().nullable(),
  time: z.string().nullable(),
});

export const EXTRACT_PURCHASE_SYSTEM = [
  "You read one bank or wallet notification from Argentina that the user confirmed is a purchase.",
  "Extract its fields. Never invent a value: use null when the notification doesn't state it.",
  "amount: digits with '.' as the decimal separator and no thousands separator, e.g. 15000.01. " +
    "Notifications usually write amounts in es-AR format ('.' thousands, ',' decimals).",
  "currency: ARS or USD. '$' alone means ARS.",
  "merchant: who was paid, as written in the notification.",
  "payment_method: the card or account used, as written, e.g. 'Visa Crédito 3551'.",
  "time: the purchase time as HH:MM (24 h) if the notification states it.",
].join("\n");

export function notificationPrompt(input: ExtractPurchaseInput): string {
  return [`app: ${input.app}`, `title: ${input.title}`, `text: ${input.text}`].join("\n");
}

/** Structured output for `proposeRule`. The core builds the rule and validates it. */
export const proposeRuleSchema = z.object({
  title: z.string().nullable(),
  text: z.string().nullable(),
  number_format: z.enum(["es-AR", "en-US", "plain"]),
  currency_map: z.array(z.object({ token: z.string(), currency: z.enum(CURRENCIES) })),
  default_currency: z.enum(CURRENCIES).nullable(),
  payment_method: z.string().nullable(),
  merchant: z.string().nullable(),
});

export const PROPOSE_RULE_SYSTEM = [
  "You write a classifier rule that recognizes purchase notifications shaped like the given one " +
    "and extracts their fields.",
  "title and text are JavaScript regular expressions (u flag) matched against the notification's " +
    "title and text exactly as given. Set one or both; every pattern set must match.",
  "Anchor patterns with ^ and $. Keep the fixed wording literal and escape regex syntax. " +
    "Capture the parts that change between purchases with named groups: amount (required), " +
    "currency, merchant, method, last4, time (HH:MM).",
  "number_format says how the amount group is written: es-AR ('.' thousands, ',' decimals), " +
    "en-US (',' thousands, '.' decimals) or plain.",
  "currency_map maps each captured currency token (e.g. '$', 'USD') to ARS or USD. " +
    "default_currency is used when no currency group is captured.",
  "payment_method is a template with {group} placeholders (e.g. 'Galicia {method} {last4}') " +
    "or a literal (e.g. 'Mercado Pago cuenta'); null when there is none.",
  "merchant is a literal only for notifications that never name the merchant; otherwise null " +
    "and capture a merchant group.",
  "Applied to this notification, the rule must reproduce the confirmed fields exactly.",
].join("\n");

export function proposeRulePrompt(input: ProposeRuleInput): string {
  const { confirmed } = input;
  return [
    "Notification:",
    notificationPrompt(input),
    "",
    "Confirmed fields:",
    `- amount: ${confirmed.amount}`,
    `- currency: ${confirmed.currency}`,
    `- merchant: ${confirmed.merchant}`,
    `- payment method: ${confirmed.paymentMethod ?? "none"}`,
    `- time: ${confirmed.time ?? "none"}`,
  ].join("\n");
}
