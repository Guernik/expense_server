import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

/** In-memory SQLite with all migrations applied. Node-only; for tests. */
export function createTestDatabase() {
  const db = drizzle({ client: new Database(":memory:"), schema });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  return db;
}
