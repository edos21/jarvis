import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

// Pass ":memory:" in tests.
export const openDb = (file: string): Db => {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
};
