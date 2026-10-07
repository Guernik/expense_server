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
}

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
  insertPurchase(purchase: NewPurchase): Promise<StoredPurchase>;
  setPurchaseTelegramMessage(purchaseId: number, messageId: number): Promise<void>;
}

export interface Messenger {
  send(chatId: string, text: string): Promise<{ messageId: number }>;
}

export interface Clock {
  now(): Date;
}
