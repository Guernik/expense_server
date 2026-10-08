/**
 * Inline button actions, encoded as short opaque `callback_data` (Telegram limit: 64 bytes).
 * Format: `<tag>:<purchaseId>[:<arg>]` with decimal ids.
 */
export type Action =
  | { type: "pick"; purchaseId: number; categoryId: number }
  | { type: "more"; purchaseId: number; page: number }
  /** Shows the top picker: `Change` on a confirmation, or back from `More…`. */
  | { type: "picker"; purchaseId: number }
  | { type: "newCategory"; purchaseId: number }
  | { type: "group"; purchaseId: number; groupId: number }
  | { type: "newGroup"; purchaseId: number }
  | { type: "skip"; purchaseId: number }
  /** Non-interactive button, e.g. a group header in `More…`. */
  | { type: "noop" };

export const MAX_CALLBACK_BYTES = 64;

export function encodeAction(action: Action): string {
  switch (action.type) {
    case "pick":
      return `c:${action.purchaseId}:${action.categoryId}`;
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
  const purchaseId = Number(rawId);
  const arg = rawArg === undefined ? undefined : Number(rawArg);
  switch (tag) {
    case "c":
      return arg === undefined ? null : { type: "pick", purchaseId, categoryId: arg };
    case "m":
      return arg === undefined ? null : { type: "more", purchaseId, page: arg };
    case "g":
      return arg === undefined ? null : { type: "group", purchaseId, groupId: arg };
    case "p":
      return arg === undefined ? { type: "picker", purchaseId } : null;
    case "n":
      return arg === undefined ? { type: "newCategory", purchaseId } : null;
    case "G":
      return arg === undefined ? { type: "newGroup", purchaseId } : null;
    case "s":
      return arg === undefined ? { type: "skip", purchaseId } : null;
    default:
      return null;
  }
}
