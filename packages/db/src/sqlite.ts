import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

/** The shared migration set, also applied to D1 by wrangler (ADR-0005). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Opens a better-sqlite3 database (Node runtime) and applies pending migrations. `path` is a file,
 * created with its directory if missing, or `:memory:`. Node-only.
 */
export function openSqliteDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  const db = drizzle({ client, schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
