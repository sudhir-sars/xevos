import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";
import { EMBEDDING_DIMS } from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let db: DB | null = null;

/**
 * Open (once) the local SQLite database that is the org's single source of
 * truth: WAL for durable concurrent reads, sqlite-vec for memory KNN, Drizzle
 * for typed access. Migrations are applied and the vector virtual table is
 * ensured on first open, so the runtime is ready to use immediately.
 *
 * cwd is `packages/core` for both `dev` (tsx) and `start` (node dist), so the
 * default paths resolve the same in either mode.
 */
export function getDb(): DB {
  if (db) return db;

  const file = process.env.XEVOS_DB_PATH ?? "./storage/xevos.db";
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");

  // Load the sqlite-vec extension BEFORE any vec0 table is touched.
  sqliteVec.load(conn);

  const handle = drizzle(conn, { schema });

  // Apply Drizzle migrations (idempotent).
  migrate(handle, {
    migrationsFolder: process.env.XEVOS_MIGRATIONS ?? "./drizzle",
  });

  // The memory-warehouse vector index is a sqlite-vec virtual table, not a
  // Drizzle table, so it is created here. Its rowid maps 1:1 to
  // memory_warehouse.rowid.
  conn.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory USING vec0(embedding float[${EMBEDDING_DIMS}])`,
  );

  sqlite = conn;
  db = handle;
  return handle;
}

/** Raw better-sqlite3 handle, for the sqlite-vec queries Drizzle can't express. */
export function getSqlite(): Database.Database {
  if (!sqlite) getDb();
  return sqlite as Database.Database;
}

/** Serialize an embedding to the Float32 BLOB sqlite-vec expects. */
export function toVecBlob(embedding: readonly number[]): Uint8Array {
  return new Uint8Array(new Float32Array(embedding).buffer);
}

/** Close the database (tests / graceful shutdown). */
export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
}
