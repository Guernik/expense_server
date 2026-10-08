import type { ImportPlan, User } from "@denarii/core";

/**
 * SQL script that applies a backfill plan (SPEC §10). Self-contained (values inlined, ids looked
 * up by name), so it runs as one file through `wrangler d1 execute` locally or remotely, or
 * through `exec` on better-sqlite3. Every statement is idempotent: re-running it changes nothing.
 *
 * - The user is created on first use (as the bot would) and left as is otherwise.
 * - Groups and categories are matched by name, case-insensitively. An existing category keeps
 *   its group.
 * - Purchases are inserted as `categorized`, `source = import`, unless the user already has as
 *   many imports with the same local day, merchant, amount and currency (`occurrence`).
 * - Merchant rules never replace one the user made in Telegram (`source = user`).
 */
export function buildImportSql(plan: ImportPlan, user: Omit<User, "id">): string[] {
  const now = new Date().toISOString();
  const chatId = literal(user.telegramChatId);
  const fromUser = `FROM users u WHERE u.telegram_chat_id = ${chatId}`;
  const groupId = (name: string) =>
    `(SELECT id FROM groups WHERE user_id = u.id AND name = ${literal(name)} COLLATE NOCASE)`;
  const categoryId = (name: string) =>
    `(SELECT id FROM categories WHERE user_id = u.id AND name = ${literal(name)} COLLATE NOCASE)`;

  const statements = [
    `INSERT INTO users (telegram_chat_id, locale, timezone) VALUES (${chatId}, ${literal(user.locale)}, ${literal(user.timezone)}) ON CONFLICT (telegram_chat_id) DO NOTHING`,
  ];

  for (const name of plan.groups) {
    statements.push(
      `INSERT INTO groups (user_id, name) SELECT u.id, ${literal(name)} ${fromUser} AND NOT EXISTS (SELECT 1 FROM groups WHERE user_id = u.id AND name = ${literal(name)} COLLATE NOCASE)`,
    );
  }

  for (const { name, group } of plan.categories) {
    statements.push(
      `INSERT INTO categories (user_id, name, group_id) SELECT u.id, ${literal(name)}, ${groupId(group)} ${fromUser} AND ${categoryId(name)} IS NULL`,
    );
  }

  for (const label of plan.paymentMethods) {
    statements.push(
      `INSERT INTO payment_methods (user_id, label) SELECT u.id, ${literal(label)} ${fromUser} ON CONFLICT (user_id, label) DO NOTHING`,
    );
  }

  for (const p of plan.purchases) {
    const values = [
      "u.id",
      "'purchase'",
      "'categorized'",
      literal(p.occurredAt.toISOString()),
      literal(p.amountMinor),
      literal(p.currency),
      literal(p.merchantRaw),
      literal(p.merchantNormalized),
      `(SELECT id FROM payment_methods WHERE user_id = u.id AND label = ${literal(p.paymentMethod)})`,
      categoryId(p.category),
      "'import'",
      literal(p.comment),
      "'import'",
      literal(now),
    ];
    statements.push(
      `INSERT INTO purchases (user_id, kind, status, occurred_at, amount_minor, currency, merchant_raw, merchant_normalized, payment_method_id, category_id, categorized_by, comment, source, updated_at) SELECT ${values.join(", ")} ${fromUser} AND (SELECT count(*) FROM purchases WHERE user_id = u.id AND source = 'import' AND occurred_at >= ${literal(p.day.from.toISOString())} AND occurred_at < ${literal(p.day.to.toISOString())} AND merchant_normalized = ${literal(p.merchantNormalized)} AND amount_minor = ${literal(p.amountMinor)} AND currency = ${literal(p.currency)}) < ${literal(p.occurrence)}`,
    );
  }

  for (const rule of plan.merchantRules) {
    statements.push(
      `INSERT INTO merchant_rules (user_id, merchant_normalized, category_id, source, updated_at) SELECT u.id, ${literal(rule.merchantNormalized)}, ${categoryId(rule.category)}, 'import', ${literal(now)} ${fromUser} ON CONFLICT (user_id, merchant_normalized) DO UPDATE SET category_id = excluded.category_id, updated_at = excluded.updated_at WHERE merchant_rules.source = 'import'`,
    );
  }

  return statements.map((s) => `${s};`);
}

/** An SQLite literal. Strings are single-quoted with quotes doubled; NUL is not allowed. */
function literal(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`Not a safe integer: ${value}`);
    return String(value);
  }
  if (value.includes("\u0000")) throw new Error("NUL characters are not allowed");
  return `'${value.replaceAll("'", "''")}'`;
}
