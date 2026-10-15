import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

/**
 * Plain SQLite through Node's built-in driver: one file, no native dependencies, no ORM.
 * Each entry in `migrations` runs once, in order; append new ones, never edit old ones.
 */
const migrations = [
  `
  CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE responses (
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    response TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (activity_id, user_id)
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    id_token TEXT,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE presentations (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE activities ADD COLUMN presentation_id TEXT REFERENCES presentations(id) ON DELETE SET NULL;
  CREATE TABLE scores (
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    points INTEGER NOT NULL,
    PRIMARY KEY (activity_id, user_id)
  );
  `,
  `
  ALTER TABLE activities ADD COLUMN members_only INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE activities ADD COLUMN counts_to_leaderboard INTEGER NOT NULL DEFAULT 1;
  `,
]

export type Database = DatabaseSync

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number }
  for (let i = version; i < migrations.length; i++) {
    db.exec("BEGIN")
    try {
      db.exec(migrations[i] as string)
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
  return db
}
