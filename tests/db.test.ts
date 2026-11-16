import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { openDatabase } from "../src/server/db.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), "live-audience-db-"))
  dirs.push(dir)
  return join(dir, "test.db")
}

const FIRST = `
  CREATE TABLE activities (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, type TEXT NOT NULL, title TEXT NOT NULL,
    config TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE responses (activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
    user_name TEXT NOT NULL, response TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (activity_id, user_id));
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user TEXT NOT NULL, id_token TEXT, expires_at INTEGER NOT NULL);
`
/** How the pre-merge Secret Santa branch numbered its migrations, right after the first one. */
const BRANCH = [
  FIRST,
  "ALTER TABLE responses ADD COLUMN user_email TEXT;",
  `CREATE TABLE secret_santa_admin_actions (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id)
    ON DELETE CASCADE, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL,
    changes TEXT NOT NULL, created_at INTEGER NOT NULL);`,
]

function columns(db: DatabaseSync, table: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
}

function tables(db: DatabaseSync) {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (t) => t.name,
  )
}

describe("openDatabase", () => {
  it.each([2, 3])("upgrades a database the Secret Santa branch left at version %i", (version) => {
    const path = tempPath()
    const old = new DatabaseSync(path)
    for (const migration of BRANCH.slice(0, version)) old.exec(migration)
    old.exec(`PRAGMA user_version = ${version}`)
    old.exec("INSERT INTO activities VALUES ('a1', 'santa', 'secret-santa', 'Natale', '{}', 0, 0)")
    old.close()

    const db = openDatabase(path)
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(5)
    expect(tables(db)).toEqual(
      expect.arrayContaining(["presentations", "scores", "secret_santa_admin_actions"]),
    )
    expect(columns(db, "activities")).toEqual(
      expect.arrayContaining(["presentation_id", "members_only", "counts_to_leaderboard"]),
    )
    expect(columns(db, "responses")).toContain("user_email")
    expect(db.prepare("SELECT slug FROM activities").all()).toEqual([{ slug: "santa" }])
    db.close()
  })

  it("leaves databases built by main to the regular migrations", () => {
    const path = tempPath()
    openDatabase(path).close()
    const db = openDatabase(path)
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(5)
    db.close()
  })
})
