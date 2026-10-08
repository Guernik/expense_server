import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** SQLite schema shared by D1 and better-sqlite3 (ADR-0005). Timestamps are UTC ISO strings. */

const createdAt = () =>
  text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email"),
    telegramChatId: text("telegram_chat_id").notNull(),
    locale: text("locale", { enum: ["en", "es"] }).notNull(),
    timezone: text("timezone").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_telegram_chat_id").on(t.telegramChatId)],
);

export const paymentMethods = sqliteTable(
  "payment_methods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    label: text("label").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payment_methods_user_label").on(t.userId, t.label)],
);

export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("groups_user_name").on(t.userId, t.name)],
);

/** A category's group is the only link to groups; purchases never store one (ADR-0006). */
export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("categories_user_name").on(t.userId, t.name)],
);

export const merchantRules = sqliteTable(
  "merchant_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    merchantNormalized: text("merchant_normalized").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    source: text("source", { enum: ["user", "import"] }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("merchant_rules_user_merchant").on(t.userId, t.merchantNormalized)],
);

/** Pending free-text conversation step per chat (ADR-0012). */
export const chatState = sqliteTable("chat_state", {
  chatId: text("chat_id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  state: text("state", { mode: "json" }).notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const purchases = sqliteTable(
  "purchases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: ["purchase", "transfer"] }).notNull(),
    status: text("status", { enum: ["pending", "categorized", "excluded"] })
      .notNull()
      .default("pending"),
    occurredAt: text("occurred_at").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency", { enum: ["ARS", "USD"] }).notNull(),
    merchantRaw: text("merchant_raw").notNull(),
    merchantNormalized: text("merchant_normalized").notNull(),
    paymentMethodId: integer("payment_method_id").references(() => paymentMethods.id),
    categoryId: integer("category_id").references(() => categories.id),
    categorizedBy: text("categorized_by", { enum: ["rule", "user", "import"] }),
    comment: text("comment"),
    source: text("source", { enum: ["live", "import"] })
      .notNull()
      .default("live"),
    telegramMessageId: integer("telegram_message_id"),
    /** The event that created this purchase. Its `received_at` anchors dedupe (ADR-0011). */
    sourceEventId: integer("source_event_id").references((): AnySQLiteColumn => events.id),
    createdAt: createdAt(),
    updatedAt: text("updated_at")
      .$defaultFn(() => new Date().toISOString())
      .$onUpdate(() => new Date().toISOString()),
  },
  (t) => [
    index("purchases_user_occurred").on(t.userId, t.occurredAt),
    uniqueIndex("purchases_source_event").on(t.sourceEventId),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    app: text("app").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    receivedAt: text("received_at").notNull(),
    status: text("status", {
      enum: [
        "pending",
        "purchase",
        "transfer",
        "ignored",
        "unmatched",
        "non_purchase",
        "duplicate",
      ],
    })
      .notNull()
      .default("pending"),
    ruleId: text("rule_id"),
    ruleSource: text("rule_source", { enum: ["pack", "user"] }),
    purchaseId: integer("purchase_id").references(() => purchases.id),
    createdAt: createdAt(),
  },
  (t) => [index("events_user_received").on(t.userId, t.receivedAt)],
);
