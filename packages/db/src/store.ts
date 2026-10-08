import type {
  EventClassification,
  NewEvent,
  NewPurchase,
  PurchaseExtraction,
  PurchaseInsert,
  Store,
  StoredEvent,
  StoredPurchase,
  User,
} from "@denarii/core";
import { and, asc, between, eq, sql } from "drizzle-orm";
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

    async insertPurchase(purchase: NewPurchase, window): Promise<PurchaseInsert> {
      const from = window.from.toISOString();
      const to = window.to.toISOString();
      const occurredAt = purchase.occurredAt.toISOString();
      // One statement, so concurrent duplicates can't both pass the check (D1 serializes writes).
      const inserted = await db.all<{ id: number; status: StoredPurchase["status"] }>(sql`
        INSERT INTO purchases (user_id, kind, occurred_at, amount_minor, currency, merchant_raw,
          merchant_normalized, payment_method_id, source_event_id)
        SELECT ${purchase.userId}, ${purchase.kind}, ${occurredAt}, ${purchase.amountMinor},
          ${purchase.currency}, ${purchase.merchantRaw}, ${purchase.merchantNormalized},
          ${purchase.paymentMethodId}, ${purchase.sourceEventId}
        WHERE NOT EXISTS (
          SELECT 1 FROM purchases p JOIN events e ON e.id = p.source_event_id
          WHERE p.user_id = ${purchase.userId} AND p.amount_minor = ${purchase.amountMinor}
            AND p.currency = ${purchase.currency} AND e.received_at BETWEEN ${from} AND ${to}
        )
        RETURNING id, status`);
      const [row] = inserted;
      if (row) return { created: true, purchase: { ...purchase, ...row } };

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
        purchase: {
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
          sourceEventId: e.id,
        },
        sourceEvent: {
          id: e.id,
          userId: e.userId,
          app: e.app,
          title: e.title,
          text: e.text,
          receivedAt: new Date(e.receivedAt),
          status: e.status,
        },
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
  if (row === undefined) throw new Error("Expected a row");
  return row;
}
