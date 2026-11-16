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
  // Where to email a participant, for activities that do (Secret Santa). Never part of results.
  `ALTER TABLE responses ADD COLUMN user_email TEXT;`,
  `CREATE TABLE secret_santa_admin_actions (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT NOT NULL,
    changes TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX secret_santa_admin_actions_activity ON secret_santa_admin_actions(activity_id, created_at);`,
]

export type Database = DatabaseSync

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
  const version = repairSecretSantaBranch(db, userVersion(db))
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

function userVersion(db: Database): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version
}

/** Main's migrations that the Secret Santa branch had not seen: presentations and scores, members only. */
const MAIN_ONLY = [1, 2]
/** Where the Secret Santa entries start in `migrations`. */
const FIRST_SANTA = 3

/**
 * Databases built by the pre-merge Secret Santa branch numbered its migrations right after the first
 * one (user_email as 2, the admin log as 3), so their user_version points into main's entries. They
 * have no presentations table: apply main's missing entries and renumber, so the loop carries on from
 * the right place. Databases built by main are left alone.
 */
function repairSecretSantaBranch(db: Database, version: number): number {
  if (version < 2 || version > FIRST_SANTA) return version
  const presentations = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'presentations'")
    .get()
  if (presentations) return version
  const repaired = FIRST_SANTA + (version - 1)
  db.exec("BEGIN")
  try {
    for (const i of MAIN_ONLY) db.exec(migrations[i] as string)
    db.exec(`PRAGMA user_version = ${repaired}`)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  return repaired
}
