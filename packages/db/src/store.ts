import type {
  EventClassification,
  NewEvent,
  NewPurchase,
  Store,
  StoredEvent,
  StoredPurchase,
  User,
} from "@denarii/core";
import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
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
      const stored = required(row);
      return { ...event, id: stored.id, status: stored.status };
    },

    async classifyEvent(eventId: number, c: EventClassification) {
      await db
        .update(schema.events)
        .set({
          status: c.status,
          ruleId: c.ruleId ?? null,
          ruleSource: c.ruleSource ?? null,
          purchaseId: c.purchaseId ?? null,
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

    async insertPurchase(purchase: NewPurchase): Promise<StoredPurchase> {
      const [row] = await db
        .insert(schema.purchases)
        .values({ ...purchase, occurredAt: purchase.occurredAt.toISOString() })
        .returning();
      const stored = required(row);
      return { ...purchase, id: stored.id, status: stored.status };
    },

    async setPurchaseTelegramMessage(purchaseId: number, messageId: number) {
      await db
        .update(schema.purchases)
        .set({ telegramMessageId: messageId })
        .where(eq(schema.purchases.id, purchaseId));
    },
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

function required<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("Expected a row from RETURNING");
  return row;
}
