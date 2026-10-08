import { formatMoney, type SuggestCategoryInput } from "@denarii/core";
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
