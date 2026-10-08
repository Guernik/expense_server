import {
  type Category,
  type ChatState,
  type EventClassification,
  type NewEvent,
  type NewPurchase,
  type PurchaseExtraction,
  type PurchaseInsert,
  ruleSchema,
  type Store,
  type StoredEvent,
  type StoredPurchase,
  type User,
} from "@denarii/core";
import { and, asc, between, count, desc, eq, gte, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

/** Any Drizzle SQLite database: D1 (async) or better-sqlite3 (sync). */
// biome-ignore lint/suspicious/noExplicitAny: the run result type differs per driver and is unused
export type Database = BaseSQLiteDatabase<"sync" | "async", any, typeof schema>;

export function createStore(db: Database): Store {
  return {
    async ensureUser(user) {
      const [row] = await db
        .insert(schema.users)
        .values(user)
        .onConflictDoUpdate({
          target: schema.users.telegramChatId,
          set: { locale: user.locale, timezone: user.timezone },
        })
        .returning();
      return toUser(required(row));
    },

    async insertEvent(event: NewEvent): Promise<StoredEvent> {
      const [row] = await db
        .insert(schema.events)
        .values({ ...event, receivedAt: event.receivedAt.toISOString() })
        .returning();
      return toEvent(required(row));
    },

    async getEvent(userId, eventId) {
      const [row] = await db
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.userId, userId), eq(schema.events.id, eventId)));
      return row ? toEvent(row) : null;
    },

    async findPurchaseEvent(userId, purchaseId) {
      const [row] = await db
        .select()
        .from(schema.events)
        .where(and(eq(schema.events.userId, userId), eq(schema.events.purchaseId, purchaseId)))
        .orderBy(asc(schema.events.id))
        .limit(1);
      return row ? toEvent(row) : null;
    },

    async classifyEvent(eventId: number, c: EventClassification) {
      await db
        .update(schema.events)
        .set({
          status: c.status,
          ruleId: c.ruleId ?? null,
          ruleSource: c.ruleSource ?? null,
          purchaseId: c.purchaseId ?? null,
          extractedBy: c.extractedBy ?? null,
        })
        .where(eq(schema.events.id, eventId));
    },

    async upsertPaymentMethod(userId: number, label: string) {
      const [row] = await db
        .insert(schema.paymentMethods)
        .values({ userId, label })
        // no-op update so RETURNING yields the existing row
        .onConflictDoUpdate({
          target: [schema.paymentMethods.userId, schema.paymentMethods.label],
          set: { label },
        })
        .returning({ id: schema.paymentMethods.id });
      return required(row).id;
    },

    async insertPurchase(purchase: NewPurchase, window): Promise<PurchaseInsert> {
      const from = window.from.toISOString();
      const to = window.to.toISOString();
      const occurredAt = purchase.occurredAt.toISOString();
      // One statement, so concurrent duplicates can't both pass the check (D1 serializes writes).
      const inserted = await db.all<{ id: number }>(sql`
        INSERT INTO purchases (user_id, kind, occurred_at, amount_minor, currency, merchant_raw,
          merchant_normalized, payment_method_id, source_event_id, updated_at)
        SELECT ${purchase.userId}, ${purchase.kind}, ${occurredAt}, ${purchase.amountMinor},
          ${purchase.currency}, ${purchase.merchantRaw}, ${purchase.merchantNormalized},
          ${purchase.paymentMethodId}, ${purchase.sourceEventId}, ${new Date().toISOString()}
        WHERE NOT EXISTS (
          SELECT 1 FROM purchases p JOIN events e ON e.id = p.source_event_id
          WHERE p.user_id = ${purchase.userId} AND p.amount_minor = ${purchase.amountMinor}
            AND p.currency = ${purchase.currency} AND e.received_at BETWEEN ${from} AND ${to}
        )
        RETURNING id`);
      const [row] = inserted;
      if (row) {
        return {
          created: true,
          purchase: required(await this.getPurchase(purchase.userId, row.id)),
        };
      }

      const [existing] = await db
        .select({ purchase: schema.purchases, event: schema.events })
        .from(schema.purchases)
        .innerJoin(schema.events, eq(schema.events.id, schema.purchases.sourceEventId))
        .where(
          and(
            eq(schema.purchases.userId, purchase.userId),
            eq(schema.purchases.amountMinor, purchase.amountMinor),
            eq(schema.purchases.currency, purchase.currency),
            between(schema.events.receivedAt, from, to),
          ),
        )
        .orderBy(asc(schema.events.receivedAt), asc(schema.purchases.id))
        .limit(1);
      const { purchase: p, event: e } = required(existing);
      return {
        created: false,
        purchase: required(await this.getPurchase(p.userId, p.id)),
        sourceEvent: toEvent(e),
      };
    },

    async getPurchase(userId, purchaseId) {
      const [row] = await db
        .select({ purchase: schema.purchases, paymentMethod: schema.paymentMethods.label })
        .from(schema.purchases)
        .leftJoin(
          schema.paymentMethods,
          eq(schema.paymentMethods.id, schema.purchases.paymentMethodId),
        )
        .where(and(eq(schema.purchases.userId, userId), eq(schema.purchases.id, purchaseId)));
      if (!row) return null;
      const { purchase: p } = row;
      return {
        id: p.id,
        userId: p.userId,
        kind: p.kind,
        status: p.status,
        occurredAt: new Date(p.occurredAt),
        amountMinor: p.amountMinor,
        currency: p.currency,
        merchantRaw: p.merchantRaw,
        merchantNormalized: p.merchantNormalized,
        paymentMethodId: p.paymentMethodId,
        sourceEventId: p.sourceEventId,
        paymentMethod: row.paymentMethod,
        categoryId: p.categoryId,
        telegramMessageId: p.telegramMessageId,
      };
    },

    async updatePurchaseExtraction(purchaseId: number, extraction: PurchaseExtraction) {
      await db.update(schema.purchases).set(extraction).where(eq(schema.purchases.id, purchaseId));
    },

    async setPurchaseTelegramMessage(purchaseId: number, messageId: number) {
      await db
        .update(schema.purchases)
        .set({ telegramMessageId: messageId })
        .where(eq(schema.purchases.id, purchaseId));
    },

    async categorizePurchase(purchaseId, categoryId, by) {
      await db
        .update(schema.purchases)
        .set({ categoryId, categorizedBy: by, status: "categorized" })
        .where(eq(schema.purchases.id, purchaseId));
    },

    async excludePurchase(purchaseId) {
      await db
        .update(schema.purchases)
        .set({ status: "excluded" })
        .where(eq(schema.purchases.id, purchaseId));
    },

    async listUserRules(userId) {
      const rows = await db
        .select({ definition: schema.classifierRules.definition })
        .from(schema.classifierRules)
        .where(
          and(eq(schema.classifierRules.userId, userId), eq(schema.classifierRules.enabled, true)),
        )
        .orderBy(asc(schema.classifierRules.id));
      return rows.flatMap((row) => {
        const result = ruleSchema.safeParse(row.definition);
        return result.success ? [result.data] : [];
      });
    },

    async insertUserRule(userId, rule, createdFromEventId) {
      await db
        .insert(schema.classifierRules)
        .values({ userId, definition: rule, createdFromEventId });
    },

    async listGroups(userId) {
      return db
        .select({ id: schema.groups.id, name: schema.groups.name })
        .from(schema.groups)
        .where(eq(schema.groups.userId, userId))
        .orderBy(asc(schema.groups.name));
    },

    async ensureGroup(userId, name) {
      const [existing] = await db
        .select({ id: schema.groups.id, name: schema.groups.name })
        .from(schema.groups)
        .where(and(eq(schema.groups.userId, userId), sameName(schema.groups.name, name)));
      if (existing) return existing;
      const [row] = await db
        .insert(schema.groups)
        .values({ userId, name })
        .returning({ id: schema.groups.id, name: schema.groups.name });
      return required(row);
    },

    async getCategory(userId, categoryId) {
      const [row] = await selectCategories(db).where(
        and(eq(schema.categories.userId, userId), eq(schema.categories.id, categoryId)),
      );
      return row ? toCategory(row) : null;
    },

    async findCategoryByName(userId, name) {
      const [row] = await selectCategories(db).where(
        and(eq(schema.categories.userId, userId), sameName(schema.categories.name, name)),
      );
      return row ? toCategory(row) : null;
    },

    async createCategory(userId, name, groupId) {
      const [row] = await db
        .insert(schema.categories)
        .values({ userId, name, groupId })
        .returning({ id: schema.categories.id });
      return required(await this.getCategory(userId, required(row).id));
    },

    async listCategories(userId) {
      const rows = await selectCategories(db)
        .where(eq(schema.categories.userId, userId))
        .orderBy(asc(schema.groups.name), asc(schema.categories.name));
      return rows.map(toCategory);
    },

    async topCategories(userId, since, limit) {
      const uses = count(schema.purchases.id);
      const rows = await selectCategories(db)
        .leftJoin(
          schema.purchases,
          and(
            eq(schema.purchases.categoryId, schema.categories.id),
            eq(schema.purchases.status, "categorized"),
            gte(schema.purchases.occurredAt, since.toISOString()),
          ),
        )
        .where(eq(schema.categories.userId, userId))
        .groupBy(schema.categories.id)
        .orderBy(desc(uses), asc(schema.categories.name))
        .limit(limit);
      return rows.map(toCategory);
    },

    async findMerchantRule(userId, merchantNormalized) {
      const [row] = await selectCategories(db)
        .innerJoin(schema.merchantRules, eq(schema.merchantRules.categoryId, schema.categories.id))
        .where(
          and(
            eq(schema.merchantRules.userId, userId),
            eq(schema.merchantRules.merchantNormalized, merchantNormalized),
          ),
        );
      return row ? toCategory(row) : null;
    },

    async upsertMerchantRule(userId, merchantNormalized, categoryId, source) {
      const updatedAt = new Date().toISOString();
      await db
        .insert(schema.merchantRules)
        .values({ userId, merchantNormalized, categoryId, source, updatedAt })
        .onConflictDoUpdate({
          target: [schema.merchantRules.userId, schema.merchantRules.merchantNormalized],
          set: { categoryId, source, updatedAt },
        });
    },

    async getChatState(chatId, now) {
      const [row] = await db
        .select({ state: schema.chatState.state, expiresAt: schema.chatState.expiresAt })
        .from(schema.chatState)
        .where(eq(schema.chatState.chatId, chatId));
      if (!row || row.expiresAt <= now.toISOString()) return null;
      return row.state as ChatState;
    },

    async setChatState(userId, chatId, state, expiresAt) {
      const values = { userId, state, expiresAt: expiresAt.toISOString() };
      await db
        .insert(schema.chatState)
        .values({ chatId, ...values })
        .onConflictDoUpdate({ target: schema.chatState.chatId, set: values });
    },

    async clearChatState(chatId) {
      await db.delete(schema.chatState).where(eq(schema.chatState.chatId, chatId));
    },
  };
}

function selectCategories(db: Database) {
  return db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      groupId: schema.groups.id,
      groupName: schema.groups.name,
    })
    .from(schema.categories)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.categories.groupId))
    .$dynamic();
}

function toCategory(row: {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
}): Category {
  return { id: row.id, name: row.name, group: { id: row.groupId, name: row.groupName } };
}

/** Case-insensitive name match (ASCII), so "delivery" finds "Delivery". */
function sameName(column: SQLiteColumn, name: string) {
  return sql`${column} = ${name} COLLATE NOCASE`;
}

function toEvent(row: typeof schema.events.$inferSelect): StoredEvent {
  return {
    id: row.id,
    userId: row.userId,
    app: row.app,
    title: row.title,
    text: row.text,
    receivedAt: new Date(row.receivedAt),
    status: row.status,
    purchaseId: row.purchaseId,
  };
}

function toUser(row: typeof schema.users.$inferSelect): User {
  return {
    id: row.id,
    telegramChatId: row.telegramChatId,
    locale: row.locale,
    timezone: row.timezone,
  };
}

function required<T>(row: T | null | undefined): T {
  if (row == null) throw new Error("Expected a row");
  return row;
}
