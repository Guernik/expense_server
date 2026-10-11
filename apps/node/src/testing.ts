import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteDatabase } from "@denarii/db/sqlite";

/** A fresh SQLite file opened the way the Node runtime opens `DATABASE_PATH`. For tests. */
export function createTestDatabase() {
  return openSqliteDatabase(join(mkdtempSync(join(tmpdir(), "denarii-")), "denarii.db"));
}
