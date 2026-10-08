import { normalizeText } from "../normalize";
import type {
  Category,
  Group,
  LlmProvider,
  Store,
  StoredPurchase,
  SuggestCategoryOutput,
  Suggestion,
  User,
} from "../ports";
import { MAX_NAME_LENGTH } from "./views";

/** How many of the user's own categorizations the LLM sees as examples (SPEC §7.1). */
export const SUGGESTION_EXAMPLES = 20;

/**
 * Asks the LLM for a category (SPEC §7.1 step 2) and stores it on the purchase. Returns null, and
 * stores nothing, without a provider, on error or timeout, or when the output doesn't validate.
 */
export async function suggestCategory(
  deps: { store: Store; llm?: LlmProvider | undefined },
  user: User,
  purchase: StoredPurchase,
): Promise<Suggestion | null> {
  const { store, llm } = deps;
  if (!llm) return null;
  const [categories, groups, examples] = await Promise.all([
    store.listCategories(user.id),
    store.listGroups(user.id),
    store.listUserCategorized(user.id, SUGGESTION_EXAMPLES),
  ]);
  let output: SuggestCategoryOutput;
  try {
    output = await llm.suggestCategory({
      merchant: purchase.merchantRaw,
      amountMinor: purchase.amountMinor,
      currency: purchase.currency,
      paymentMethod: purchase.paymentMethod,
      categories,
      groups,
      examples,
    });
  } catch {
    // Degrade to the picker without a suggestion (ADR-0010). Providers log their own failures.
    return null;
  }
  const suggestion = validateSuggestion(output, categories, groups);
  if (suggestion) await store.setPurchaseSuggestion(purchase.id, suggestion);
  return suggestion;
}

/**
 * Turns raw LLM output into a suggestion the bot can apply: ids must exist, new names must be
 * usable names. A "new" category that already exists (case-insensitive) becomes that category.
 */
export function validateSuggestion(
  output: SuggestCategoryOutput,
  categories: Category[],
  groups: Group[],
): Suggestion | null {
  const byId = categories.find((c) => c.id === output.categoryId);
  if (byId) return { categoryId: byId.id };

  const categoryName = validName(output.newCategoryName);
  if (!categoryName) return null;
  const existing = categories.find((c) => sameName(c.name, categoryName));
  if (existing) return { categoryId: existing.id };

  const groupName =
    groups.find((g) => g.id === output.groupId)?.name ?? validName(output.newGroupName);
  return groupName ? { categoryName, groupName } : null;
}

/** The suggested category and group names, for the picker button. */
export async function suggestionLabel(
  store: Store,
  user: User,
  suggestion: Suggestion | null,
): Promise<{ category: string; group: string } | null> {
  if (!suggestion) return null;
  if ("categoryName" in suggestion) {
    return { category: suggestion.categoryName, group: suggestion.groupName };
  }
  const category = await store.getCategory(user.id, suggestion.categoryId);
  return category ? { category: category.name, group: category.group.name } : null;
}

function validName(name: string | null | undefined): string | null {
  const normalized = normalizeText(name ?? "");
  if (!normalized || normalized.startsWith("/")) return null;
  return [...normalized].length <= MAX_NAME_LENGTH ? normalized : null;
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
