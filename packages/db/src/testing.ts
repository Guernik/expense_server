import { openSqliteDatabase } from "./sqlite";

/** In-memory SQLite with all migrations applied. Node-only; for tests. */
export function createTestDatabase() {
  return openSqliteDatabase(":memory:");
}
