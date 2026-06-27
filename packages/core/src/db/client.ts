import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";
import { EMBEDDING_DIMS } from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

const defaultDbPath = join(homedir(), ".xevos", "xevos.db");

let sqlite: Database.Database | null = null;
let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;

  mkdirSync(join(defaultDbPath, ".."), { recursive: true });

  const conn = new Database(defaultDbPath);

  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");

  sqliteVec.load(conn);

  conn.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memory USING vec0(embedding float[${EMBEDDING_DIMS}] distance_metric=cosine)`,
  );

  sqlite = conn;
  db = drizzle(conn, { schema });
  return db;
}

export function getSqlite(): Database.Database {
  if (!sqlite) getDb();
  return sqlite!;
}

export function toVecBlob(embedding: readonly number[]): Uint8Array {
  return new Uint8Array(new Float32Array(embedding).buffer);
}

export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
}