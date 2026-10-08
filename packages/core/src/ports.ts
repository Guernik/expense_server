import type { Locale } from "./i18n";
import type { Currency } from "./money";
import type { Rule } from "./rules/schema";

/** Interfaces the core depends on. Runtimes (Cloudflare, Node) provide implementations. */

export type EventStatus =
  | "pending"
  | "purchase"
  | "transfer"
  | "ignored"
  | "unmatched"
  | "non_purchase"
  | "duplicate";

export type PurchaseKind = "purchase" | "transfer";
export type PurchaseStatus = "pending" | "categorized" | "excluded";
export type RuleSource = "pack" | "user";
export type ExtractedBy = "regex" | "llm" | "user";
export type CategorizedBy = "rule" | "user" | "import";
export type MerchantRuleSource = "user" | "import";

export interface User {
  id: number;
  telegramChatId: string;
  locale: Locale;
  timezone: string;
}

export interface NewEvent {
  userId: number;
  app: string;
  title: string;
  text: string;
  receivedAt: Date;
}

export interface StoredEvent extends NewEvent {
  id: number;
  status: EventStatus;
  purchaseId: number | null;
}

export interface NewPurchase {
  userId: number;
  kind: PurchaseKind;
  occurredAt: Date;
  amountMinor: number;
  currency: Currency;
  merchantRaw: string;
  merchantNormalized: string;
  paymentMethodId: number | null;
  sourceEventId: number;
}

/** The purchase fields that come from a rule's extraction. */
export type PurchaseExtraction = Pick<
  NewPurchase,
  "kind" | "merchantRaw" | "merchantNormalized" | "paymentMethodId"
>;

export type PurchaseInsert =
  | { created: true; purchase: StoredPurchase }
  /** A purchase in the dedupe window already existed; nothing was inserted. */
  | { created: false; purchase: StoredPurchase; sourceEvent: StoredEvent };

export interface StoredPurchase extends Omit<NewPurchase, "sourceEventId"> {
  id: number;
  /** Null for purchases recorded before dedupe (ADR-0011). */
  sourceEventId: number | null;
  status: PurchaseStatus;
  categoryId: number | null;
  paymentMethod: string | null;
  comment: string | null;
  telegramMessageId: number | null;
}

export interface Group {
  id: number;
  name: string;
}

/** A category with its group, which is always derived through the category (ADR-0006). */
export interface Category {
  id: number;
  name: string;
  group: Group;
}

/** Free-text answer the bot is waiting for in a chat (SPEC §9 `chat_state`). */
export type ChatState =
  | { step: "awaiting_category_name"; purchaseId: number }
  /** Group buttons are shown too; a tap answers it as well as free text. */
  | { step: "awaiting_group_name"; purchaseId: number; categoryName: string }
  /** `<amount> <merchant>` typed after PURCHASE on an unmatched event (SPEC §7.3). */
  | { step: "awaiting_manual_extraction"; eventId: number; messageId: number };

export interface EventClassification {
  status: EventStatus;
  ruleId?: string;
  ruleSource?: RuleSource;
  purchaseId?: number;
  extractedBy?: ExtractedBy;
}

export interface Store {
  /** Returns the user for this Telegram chat, creating it on first use. */
  ensureUser(user: Omit<User, "id">): Promise<User>;
  insertEvent(event: NewEvent): Promise<StoredEvent>;
  getEvent(userId: number, eventId: number): Promise<StoredEvent | null>;
  /** The first event linked to a purchase. */
  findPurchaseEvent(userId: number, purchaseId: number): Promise<StoredEvent | null>;
  classifyEvent(eventId: number, classification: EventClassification): Promise<void>;
  /** Returns the payment method id for this label, creating it on first sight. */
  upsertPaymentMethod(userId: number, label: string): Promise<number>;
  /**
   * Inserts the purchase unless one of the same user, amount and currency has a source event
   * received within `window` (dedupe, ADR-0011). Atomic, so concurrent duplicates insert once.
   */
  insertPurchase(purchase: NewPurchase, window: { from: Date; to: Date }): Promise<PurchaseInsert>;
  updatePurchaseExtraction(purchaseId: number, extraction: PurchaseExtraction): Promise<void>;
  getPurchase(userId: number, purchaseId: number): Promise<StoredPurchase | null>;
  setPurchaseTelegramMessage(purchaseId: number, messageId: number): Promise<void>;
  /** Sets the category and marks the purchase `categorized`. */
  categorizePurchase(purchaseId: number, categoryId: number, by: CategorizedBy): Promise<void>;
  /** Marks the purchase `excluded`: kept, not counted. */
  excludePurchase(purchaseId: number): Promise<void>;
  /** The purchase whose current Telegram message is `messageId`. */
  findPurchaseByTelegramMessage(userId: number, messageId: number): Promise<StoredPurchase | null>;
  /** Sets or overwrites the purchase's comment. */
  setPurchaseComment(purchaseId: number, comment: string): Promise<void>;
  /** `pending` purchases and transfers, oldest first. */
  listPendingPurchases(userId: number, limit: number): Promise<StoredPurchase[]>;

  /** Enabled user rules. Rows that no longer validate against the rule schema are skipped. */
  listUserRules(userId: number): Promise<Rule[]>;
  insertUserRule(userId: number, rule: Rule, createdFromEventId: number | null): Promise<void>;

  listGroups(userId: number): Promise<Group[]>;
  /** Returns the group with this name (case-insensitive), creating it if missing. */
  ensureGroup(userId: number, name: string): Promise<Group>;
  getCategory(userId: number, categoryId: number): Promise<Category | null>;
  findCategoryByName(userId: number, name: string): Promise<Category | null>;
  createCategory(userId: number, name: string, groupId: number): Promise<Category>;
  /** Moves a category to another group. Purchases are untouched: their group is derived. */
  setCategoryGroup(categoryId: number, groupId: number): Promise<void>;
  /** All categories, ordered by group name then category name. */
  listCategories(userId: number): Promise<Category[]>;
  /** Categories by number of categorized purchases since `since`, most used first, then by name. */
  topCategories(userId: number, since: Date, limit: number): Promise<Category[]>;

  findMerchantRule(userId: number, merchantNormalized: string): Promise<Category | null>;
  upsertMerchantRule(
    userId: number,
    merchantNormalized: string,
    categoryId: number,
    source: MerchantRuleSource,
  ): Promise<void>;

  /** Returns the chat's state unless it expired at `now`. */
  getChatState(chatId: string, now: Date): Promise<ChatState | null>;
  setChatState(userId: number, chatId: string, state: ChatState, expiresAt: Date): Promise<void>;
  clearChatState(chatId: string): Promise<void>;
}

/** An inline keyboard button. `data` is Telegram `callback_data` and must stay under 64 bytes. */
export interface Button {
  text: string;
  data: string;
}

export type Keyboard = Button[][];

export interface Messenger {
  send(chatId: string, text: string, keyboard?: Keyboard): Promise<{ messageId: number }>;
  /** Replaces a message's text and keyboard. No keyboard removes it. */
  edit(chatId: string, messageId: number, text: string, keyboard?: Keyboard): Promise<void>;
  /** Acknowledges a button tap, optionally with a short toast. */
  answerCallback(callbackId: string, text?: string): Promise<void>;
  /** Marks a message from the user as handled (SPEC §7.2: the bot reacts ✅). */
  acknowledge(chatId: string, messageId: number): Promise<void>;
}

export interface Clock {
  now(): Date;
}
