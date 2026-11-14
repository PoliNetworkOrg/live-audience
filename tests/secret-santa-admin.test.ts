import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MiddlewareHandler } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { secretSanta } from "../src/activities/secret-santa/definition.ts"
import { createApp } from "../src/server/app.ts"
import type { AuthVariables } from "../src/server/auth.ts"
import { openDatabase } from "../src/server/db.ts"
import { type Mailer, runSecretSantaJobs } from "../src/server/jobs.ts"
import { Store } from "../src/server/store.ts"

const actor = { id: "admin", name: "Organizzatore" }
const session: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const id = c.req.header("x-user")
  c.set("user", id ? { id, name: id, isAdmin: id === "admin", canParticipate: false } : null)
  await next()
}
function setup() {
  const db = openDatabase(":memory:")
  const store = new Store(db)
  const activity = store.createActivity({ type: secretSanta.type, title: "Natale", slug: "santa" })
  store.updateActivity(activity.id, {
    config: { ...secretSanta.defaultConfig(), visible: true, confirmationDueAt: "2026-12-10T12:00:00Z" },
  })
  for (const id of ["a", "b", "c", "d"])
    store.joinSecretSanta(
      activity.id,
      { id, name: `Person ${id}`, email: `${id}@example.test` },
      { likes: `likes-${id}`, dislikes: "", gadget: true },
    )
  store.drawSecretSanta(activity.id)
  const app = createApp({ store, session })
  const call = (path: string, method = "GET", body?: unknown, user: string | null = "admin") =>
    app.request(path, {
      method,
      headers: { ...(user ? { "x-user": user } : {}), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const state = () => store.getSecretSantaAdmin(activity.id)
  const changed = () => {
    const original = state().participants
    const order: string[] = []
    let current: string | undefined = original[0]?.userId
    while (current && !order.includes(current)) {
      order.push(current)
      current = original.find((p) => p.userId === current)?.match?.userId
    }
    const first = order[1] as string
    order[1] = order[2] as string
    order[2] = first
    return Object.fromEntries(order.map((id, i) => [id, order[(i + 1) % order.length] as string]))
  }
  const mailer = {
    sendSecretSanta: vi.fn<Mailer["sendSecretSanta"]>(async () => {}),
    sendSecretSantaReassigned: vi.fn<Mailer["sendSecretSantaReassigned"]>(async () => {}),
    sendSecretSantaStatus: vi.fn<Mailer["sendSecretSantaStatus"]>(async () => {}),
  }
  return { db, store, activity, app, call, state, changed, mailer }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-14T12:00:00Z"))
})
afterEach(() => vi.useRealTimers())

describe("Secret Santa organizer controls", () => {
  it("upgrades an existing database while preserving participants and their letters", () => {
    const directory = mkdtempSync(join(tmpdir(), "santa-admin-migration-"))
    const path = join(directory, "live.db")
    try {
      const old = openDatabase(path)
      old.exec("DROP TABLE secret_santa_admin_actions; PRAGMA user_version = 2;")
      const store = new Store(old)
      const activity = store.createActivity({ type: secretSanta.type, title: "Existing", slug: "existing" })
      store.updateActivity(activity.id, { config: { ...secretSanta.defaultConfig(), visible: true } })
      store.joinSecretSanta(
        activity.id,
        { id: "old-person", name: "Existing person" },
        { likes: "Existing letter", dislikes: "", gadget: true },
      )
      old.close()
      const upgraded = openDatabase(path)
      expect(new Store(upgraded).getSecretSantaAdmin(activity.id).participants[0]).toMatchObject({
        userId: "old-person",
        entry: { likes: "Existing letter" },
      })
      upgraded.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it("shows the full operational view only to admins and keeps presentation results anonymous", async () => {
    const { call, store, activity, state } = setup()
    store.confirmSecretSantaGift(activity.id, "a")
    const url = `/api/admin/secret-santa/${activity.id}`
    expect((await call(url, "GET", undefined, null)).status).toBe(401)
    expect((await call(url, "GET", undefined, "a")).status).toBe(403)
    expect((await call(url)).status).toBe(200)
    const data = state()
    expect(data.counters).toMatchObject({ active: 4, confirmed: 1, pending: 3, unmatched: 0, gadget: 4 })
    expect(data.participants.every((p) => p.match && p.giver && p.email && p.entry.likes)).toBe(true)
    const mine = await (await call("/api/secret-santa", "GET", undefined, "a")).json()
    expect(mine[0].giver).toBeUndefined()
    expect(mine[0].participants).toBe(4)
    expect(JSON.stringify(store.getResults(activity.id))).not.toMatch(
      /Person|example.test|likes-|giftConfirmed|revision|history/,
    )
  })

  it("saves a valid correction atomically, preserves confirmations and notifies only changed Santas", async () => {
    const { store, activity, state, changed, mailer, db } = setup()
    store.confirmSecretSantaGift(activity.id, "a")
    await runSecretSantaJobs(store, mailer, "https://live.example")
    const before = state()
    const assignments = changed()
    const after = store.updateSecretSantaAssignments(activity.id, actor, {
      revision: before.revision,
      assignments,
      reason: "Coppia da correggere",
    })
    expect(after.participants.find((p) => p.userId === "a")?.giftConfirmedAt).toBe(
      before.participants.find((p) => p.userId === "a")?.giftConfirmedAt,
    )
    const affected = before.participants
      .filter((p) => p.match?.userId !== assignments[p.userId])
      .map((p) => p.userId)
      .sort()
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(mailer.sendSecretSantaReassigned.mock.calls.map(([mail]) => mail.userId).sort()).toEqual(affected)
    expect(mailer.sendSecretSantaReassigned.mock.calls.every(([mail]) => mail.reason === "admin")).toBe(true)
    expect(after.history[0]).toMatchObject({
      actor: actor.name,
      kind: "Abbinamenti",
      reason: "Coppia da correggere",
    })
    expect(after.history[0]?.changes).toHaveLength(affected.length)
    expect(new Store(db).getSecretSantaAdmin(activity.id).history).toEqual(after.history)
  })

  it.each([
    { a: "b", b: "a", c: "d", d: "c" },
    { a: "a", b: "c", c: "d", d: "b" },
    { a: "b", b: "c", c: "b", d: "a" },
    { a: "b", b: "c", c: "unknown", d: "a" },
    { a: "b", b: "a" },
  ])("rejects invalid maps without changing assignments or creating notifications", (assignments) => {
    const { store, activity, state } = setup()
    const before = state()
    expect(() =>
      store.updateSecretSantaAssignments(activity.id, actor, {
        revision: before.revision,
        reason: "Test",
        assignments,
      }),
    ).toThrow()
    expect(state()).toEqual(before)
    expect(store.pendingSecretSantaReassignMails()).toEqual([])
  })

  it("rejects a stale revision after a participant confirms, preserving both changes", () => {
    const { store, activity, state, changed } = setup()
    const before = state()
    const assignments = changed()
    store.confirmSecretSantaGift(activity.id, "a")
    expect(() =>
      store.updateSecretSantaAssignments(activity.id, actor, {
        revision: before.revision,
        assignments,
        reason: "Old screen",
      }),
    ).toThrow(/situazione è cambiata/)
    expect(state().participants.map((p) => p.match)).toEqual(before.participants.map((p) => p.match))
    expect(state().counters.confirmed).toBe(1)
  })

  it("supports an explicit confirmation override after the deadline and records its author and reason", async () => {
    const { call, activity, store, state } = setup()
    vi.setSystemTime(new Date("2026-12-11T00:01:00Z"))
    const url = `/api/admin/secret-santa/${activity.id}/participants/a/confirmation`
    const body = { revision: state().revision, reason: "Confermato al telefono", confirmed: true }
    expect((await call(url, "PATCH", body, "a")).status).toBe(403)
    expect((await call(url, "PATCH", { ...body, reason: " " })).status).toBe(400)
    expect((await call(url, "PATCH", body)).status).toBe(200)
    store.runSecretSantaConfirmationSchedule()
    expect(store.listSecretSantas("a")[0]?.removed).toBeNull()
    expect(state().history[0]).toMatchObject({ actor: "admin", reason: body.reason, kind: "Conferma regalo" })
  })

  it("requires admin rights for assignment changes and audits manual removal", async () => {
    const { call, activity, state, changed } = setup()
    const assignments = { revision: state().revision, assignments: changed(), reason: "Test" }
    expect(
      (await call(`/api/admin/secret-santa/${activity.id}/assignments`, "PATCH", assignments, "a")).status,
    ).toBe(403)
    expect(
      (
        await call(`/api/admin/secret-santa/${activity.id}/participants/a`, "DELETE", {
          revision: state().revision,
          reason: "Non può venire",
        })
      ).status,
    ).toBe(200)
    expect(state().history[0]).toMatchObject({ kind: "Rimozione", reason: "Non può venire", actor: "admin" })
    expect(state().counters.active).toBe(3)
  })

  it("rolls back both assignments and notifications if recording the intervention fails", () => {
    const { db, store, activity, state, changed } = setup()
    const before = state()
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON secret_santa_admin_actions BEGIN SELECT RAISE(ABORT, 'Audit failed'); END;",
    )
    expect(() =>
      store.updateSecretSantaAssignments(activity.id, actor, {
        revision: before.revision,
        assignments: changed(),
        reason: "Test",
      }),
    ).toThrow("Audit failed")
    expect(state()).toEqual(before)
  })

  it("keeps a record of an undone and repeated manual draw", async () => {
    const { call, activity, state } = setup()
    expect((await call(`/api/admin/secret-santa/${activity.id}/undo-draw`, "POST")).status).toBe(200)
    expect(state().history[0]).toMatchObject({ actor: "admin", kind: "Annullamento estrazione" })
    expect((await call(`/api/admin/secret-santa/${activity.id}/draw`, "POST")).status).toBe(200)
    expect(state().history[0]).toMatchObject({ actor: "admin", kind: "Estrazione regali" })
    expect(state().history).toHaveLength(2)
  })
})
