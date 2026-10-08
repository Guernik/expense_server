import type { Locale } from "./i18n";
import type { Currency } from "./money";

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

export interface StoredPurchase extends NewPurchase {
  id: number;
  status: PurchaseStatus;
}

export interface EventClassification {
  status: EventStatus;
  ruleId?: string;
  ruleSource?: RuleSource;
  purchaseId?: number;
}

export interface Store {
  /** Returns the user for this Telegram chat, creating it on first use. */
  ensureUser(user: Omit<User, "id">): Promise<User>;
  insertEvent(event: NewEvent): Promise<StoredEvent>;
  classifyEvent(eventId: number, classification: EventClassification): Promise<void>;
  /** Returns the payment method id for this label, creating it on first sight. */
  upsertPaymentMethod(userId: number, label: string): Promise<number>;
  /**
   * Inserts the purchase unless one of the same user, amount and currency has a source event
   * received within `window` (dedupe, ADR-0011). Atomic, so concurrent duplicates insert once.
   */
  insertPurchase(purchase: NewPurchase, window: { from: Date; to: Date }): Promise<PurchaseInsert>;
  updatePurchaseExtraction(purchaseId: number, extraction: PurchaseExtraction): Promise<void>;
  setPurchaseTelegramMessage(purchaseId: number, messageId: number): Promise<void>;
}

export interface Messenger {
  send(chatId: string, text: string): Promise<{ messageId: number }>;
}

export interface Clock {
  now(): Date;
}
