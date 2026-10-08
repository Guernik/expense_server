/**
 * Inline button actions, encoded as short opaque `callback_data` (Telegram limit: 64 bytes).
 * Format: `<tag>:<id>[:<arg>]` with decimal ids. The id is a purchase or an event, by tag.
 */
export type Action =
  | { type: "pick"; purchaseId: number; categoryId: number }
  /** `✨` LLM suggestion stored on the purchase. */
  | { type: "suggestion"; purchaseId: number }
  | { type: "more"; purchaseId: number; page: number }
  /** Shows the top picker: `Change` on a confirmation, or back from `More…`. */
  | { type: "picker"; purchaseId: number }
  | { type: "newCategory"; purchaseId: number }
  | { type: "group"; purchaseId: number; groupId: number }
  | { type: "newGroup"; purchaseId: number }
  | { type: "skip"; purchaseId: number }
  /** `🚫 Not a purchase` on the picker. */
  | { type: "notPurchase"; purchaseId: number }
  /** `💸 Expense` / `↔️ Not an expense` on a transfer (SPEC §7.4). */
  | { type: "transferExpense"; purchaseId: number }
  | { type: "transferNotExpense"; purchaseId: number }
  /** PURCHASE / NON-PURCHASE on an unmatched event. */
  | { type: "eventPurchase"; eventId: number }
  | { type: "eventNonPurchase"; eventId: number }
  /** `🔇 Ignore similar`, then Confirm / Cancel of the generated user rule. */
  | { type: "ignoreSimilar"; eventId: number }
  | { type: "confirmRule"; eventId: number }
  | { type: "cancelRule"; eventId: number }
  /** Non-interactive button, e.g. a group header in `More…`. */
  | { type: "noop" };

export const MAX_CALLBACK_BYTES = 64;

export function encodeAction(action: Action): string {
  switch (action.type) {
    case "pick":
      return `c:${action.purchaseId}:${action.categoryId}`;
    case "suggestion":
      return `a:${action.purchaseId}`;
    case "more":
      return `m:${action.purchaseId}:${action.page}`;
    case "picker":
      return `p:${action.purchaseId}`;
    case "newCategory":
      return `n:${action.purchaseId}`;
    case "group":
      return `g:${action.purchaseId}:${action.groupId}`;
    case "newGroup":
      return `G:${action.purchaseId}`;
    case "skip":
      return `s:${action.purchaseId}`;
    case "notPurchase":
      return `x:${action.purchaseId}`;
    case "transferExpense":
      return `e:${action.purchaseId}`;
    case "transferNotExpense":
      return `t:${action.purchaseId}`;
    case "eventPurchase":
      return `b:${action.eventId}`;
    case "eventNonPurchase":
      return `o:${action.eventId}`;
    case "ignoreSimilar":
      return `i:${action.eventId}`;
    case "confirmRule":
      return `y:${action.eventId}`;
    case "cancelRule":
      return `z:${action.eventId}`;
    case "noop":
      return "_";
  }
}

/** Returns null for anything this version doesn't recognize (e.g. buttons from older messages). */
export function decodeAction(data: string): Action | null {
  if (data === "_") return { type: "noop" };
  const match = /^([a-zA-Z]):(\d{1,16})(?::(\d{1,16}))?$/.exec(data);
  if (!match) return null;
  const [, tag, rawId, rawArg] = match;
  const id = Number(rawId);
  if (rawArg !== undefined) {
    const arg = Number(rawArg);
    switch (tag) {
      case "c":
        return { type: "pick", purchaseId: id, categoryId: arg };
      case "m":
        return { type: "more", purchaseId: id, page: arg };
      case "g":
        return { type: "group", purchaseId: id, groupId: arg };
      default:
        return null;
    }
  }
  switch (tag) {
    case "a":
      return { type: "suggestion", purchaseId: id };
    case "p":
      return { type: "picker", purchaseId: id };
    case "n":
      return { type: "newCategory", purchaseId: id };
    case "G":
      return { type: "newGroup", purchaseId: id };
    case "s":
      return { type: "skip", purchaseId: id };
    case "x":
      return { type: "notPurchase", purchaseId: id };
    case "e":
      return { type: "transferExpense", purchaseId: id };
    case "t":
      return { type: "transferNotExpense", purchaseId: id };
    case "b":
      return { type: "eventPurchase", eventId: id };
    case "o":
      return { type: "eventNonPurchase", eventId: id };
    case "i":
      return { type: "ignoreSimilar", eventId: id };
    case "y":
      return { type: "confirmRule", eventId: id };
    case "z":
      return { type: "cancelRule", eventId: id };
    default:
      return null;
  }
}
