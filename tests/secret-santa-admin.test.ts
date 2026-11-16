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
function setup({ draw = true } = {}) {
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
  if (draw) store.drawSecretSanta(activity.id)
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

describe("Secret Santa readmission and letter corrections", () => {
  const letter = (likes: string, gadget = true) => ({ likes, dislikes: "", gadget })
  const archive = (db: ReturnType<typeof setup>["db"], activityId: string) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`santa-archived:${activityId}`) as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as Record<string, { reason: string }>) : {}
  }
  /** The givers' map, checked to be one cycle through every active participant. */
  const cycle = (state: () => ReturnType<Store["getSecretSantaAdmin"]>) => {
    const people = state().participants
    const map = Object.fromEntries(people.map((p) => [p.userId, p.match?.userId ?? null]))
    if (people.length > 1) {
      const seen = new Set<string>()
      let current = people[0]?.userId as string
      while (!seen.has(current)) {
        seen.add(current)
        const next = map[current]
        expect(next).toBeTruthy()
        expect(next).not.toBe(current)
        current = next as string
      }
      expect(seen.size).toBe(people.length)
    }
    return map
  }
  const readmit = (
    s: ReturnType<typeof setup>,
    userId: string,
    extra: { giverId?: string | null; confirmed?: boolean; entry?: unknown } = {},
  ) =>
    s.store.readmitSecretSantaParticipant(s.activity.id, userId, actor, {
      revision: s.state().revision,
      reason: "Ha cambiato idea",
      entry: extra.entry ?? letter(`likes-${userId}`),
      giverId: extra.giverId,
      confirmed: extra.confirmed ?? false,
    })

  it("archives every kind of departure, keeps the archive on undo and clears it on reset", () => {
    const s = setup()
    const { store, activity, state, db } = s
    store.withdrawSecretSanta(activity.id, "a")
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"))
    store.removeSecretSantaParticipant(activity.id, "b", actor, { reason: "Non viene" })
    store.confirmSecretSantaGift(activity.id, "c")
    vi.setSystemTime(new Date("2026-12-11T00:01:00Z"))
    store.runSecretSantaConfirmationSchedule()
    expect(state().formerParticipants).toEqual([
      expect.objectContaining({
        userId: "d",
        reason: "unconfirmed",
        entry: letter("likes-d"),
        email: "d@example.test",
      }),
      expect.objectContaining({ userId: "b", reason: "admin", entry: letter("likes-b") }),
      expect.objectContaining({
        userId: "a",
        reason: "withdrawn",
        entry: letter("likes-a"),
        name: "Person a",
      }),
    ])
    expect(state().counters).toMatchObject({ former: 3, removed: 1 })
    store.undoSecretSantaDraw(activity.id, actor)
    expect(Object.keys(archive(db, activity.id)).sort()).toEqual(["a", "b", "d"])
    expect(state().formerParticipants.map((p) => p.userId)).toEqual(["d", "b", "a"])
    store.resetResponses(activity.id)
    expect(archive(db, activity.id)).toEqual({})
    expect(state().formerParticipants).toEqual([])
  })

  it("archives withdrawals before the draw and forgets them when the person signs up again", () => {
    const { store, activity, state, db } = setup({ draw: false })
    store.withdrawSecretSanta(activity.id, "a")
    expect(state().formerParticipants).toMatchObject([{ userId: "a", reason: "withdrawn" }])
    store.joinSecretSanta(activity.id, { id: "a", name: "Person a" }, letter("di nuovo"))
    expect(archive(db, activity.id)).toEqual({})
    expect(state().formerParticipants).toEqual([])
  })

  it("readmits before the draw even with sign-ups closed, without choosing a Santa", () => {
    const s = setup({ draw: false })
    const { store, activity, state } = s
    store.withdrawSecretSanta(activity.id, "a")
    store.updateActivity(activity.id, {
      config: { ...secretSanta.defaultConfig(), visible: true, signupsOpen: false },
    })
    expect(() => readmit(s, "a", { giverId: "b" })).toThrow(/Prima dell'estrazione/)
    const after = readmit(s, "a", { entry: letter("nuova letterina", false) })
    expect(after.participants.find((p) => p.userId === "a")).toMatchObject({
      email: "a@example.test",
      entry: letter("nuova letterina", false),
      hasMatch: null,
    })
    expect(after.formerParticipants).toEqual([])
    expect(after.history[0]).toMatchObject({
      kind: "Riammissione",
      reason: "Ha cambiato idea",
      actor: "Organizzatore",
    })
    expect(after.history[0]?.changes).toEqual([
      { userId: "a", name: "Person a", field: "Partecipazione", before: "Ritirato", after: "Attivo" },
      {
        userId: "a",
        name: "Person a",
        field: "Cose che ama",
        before: "Testo precedente",
        after: "Testo aggiornato",
      },
      { userId: "a", name: "Person a", field: "Adesione gadget", before: "Sì", after: "No" },
    ])
    expect(state().counters.active).toBe(4)
  })

  it("puts the readmitted person right after the chosen Santa and notifies exactly the two of them once", async () => {
    const s = setup()
    const { store, activity, state, mailer } = s
    await runSecretSantaJobs(store, mailer, "https://live.example")
    store.withdrawSecretSanta(activity.id, "a")
    await runSecretSantaJobs(store, mailer, "https://live.example")
    vi.clearAllMocks()
    const before = cycle(state)
    const giver = Object.keys(before)[0] as string
    const previous = before[giver] as string
    const after = readmit(s, "a", { giverId: giver })
    const map = cycle(state)
    expect(map).toEqual({ ...before, [giver]: "a", a: previous })
    expect(after.history[0]?.changes).toEqual([
      { userId: "a", name: "Person a", field: "Partecipazione", before: "Ritirato", after: "Attivo" },
      {
        userId: giver,
        name: `Person ${giver}`,
        field: "Destinatario",
        before: `Person ${previous}`,
        after: "Person a",
      },
      { userId: "a", name: "Person a", field: "Destinatario", before: null, after: `Person ${previous}` },
    ])
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(mailer.sendSecretSanta).not.toHaveBeenCalled()
    expect(
      mailer.sendSecretSantaReassigned.mock.calls.map(([m]) => [m.userId, m.reason, m.hasNewMatch]).sort(),
    ).toEqual(
      [
        ["a", "admin", true],
        [giver, "admin", true],
      ].sort(),
    )
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(mailer.sendSecretSantaReassigned).toHaveBeenCalledTimes(2)
    expect(store.listSecretSantas("a")[0]?.match?.name).toBe(`Person ${previous}`)
  })

  it("closes a two-person cycle when the chosen Santa had nobody", () => {
    const s = setup()
    for (const id of ["b", "c", "d"])
      s.store.removeSecretSantaParticipant(s.activity.id, id, actor, { reason: "Via" })
    expect(cycle(s.state)).toEqual({ a: null })
    readmit(s, "c", { giverId: "a" })
    expect(cycle(s.state)).toEqual({ a: "c", c: "a" })
  })

  it("readmits someone alone without a match when nobody is active", async () => {
    const s = setup()
    await runSecretSantaJobs(s.store, s.mailer, "https://live.example")
    for (const id of ["a", "b", "c", "d"]) s.store.withdrawSecretSanta(s.activity.id, id)
    await runSecretSantaJobs(s.store, s.mailer, "https://live.example")
    vi.clearAllMocks()
    expect(() => readmit(s, "b", { giverId: "a" })).toThrow(/Non ci sono partecipanti attivi/)
    expect(() => readmit(s, "b", { confirmed: true })).toThrow(/non ha un regalo da confermare/)
    const after = readmit(s, "b")
    expect(after.participants).toMatchObject([{ userId: "b", hasMatch: false, match: null }])
    await runSecretSantaJobs(s.store, s.mailer, "https://live.example")
    expect(s.mailer.sendSecretSanta).not.toHaveBeenCalled()
    expect(s.mailer.sendSecretSantaReassigned).not.toHaveBeenCalled()
  })

  it("requires the gift to be already bought once the confirmation deadline has passed", () => {
    const s = setup()
    s.store.confirmSecretSantaGift(s.activity.id, "a")
    s.store.removeSecretSantaParticipant(s.activity.id, "a", actor, { reason: "Errore" })
    vi.setSystemTime(new Date("2026-12-11T00:01:00Z"))
    for (const id of ["b", "c", "d"])
      s.store.confirmSecretSantaGift(s.activity.id, id, Date.parse("2026-12-10T20:00:00Z"))
    expect(() => readmit(s, "a", { giverId: "b" })).toThrow(/segna il regalo come già preso/)
    const after = readmit(s, "a", { giverId: "b", confirmed: true })
    expect(after.participants.find((p) => p.userId === "a")?.giftConfirmedAt).toBe(Date.now())
    expect(after.history[0]?.changes.at(-1)).toMatchObject({ field: "Conferma regalo", after: "Confermato" })
    s.store.runSecretSantaConfirmationSchedule()
    expect(s.state().counters.active).toBe(4)
    cycle(s.state)
  })

  it("after the deadline also confirms a Santa who had nobody, so the midnight job keeps both", () => {
    const s = setup()
    for (const id of ["b", "c", "d"]) {
      s.store.confirmSecretSantaGift(s.activity.id, id)
      s.store.withdrawSecretSanta(s.activity.id, id)
    }
    expect(cycle(s.state)).toEqual({ a: null })
    vi.setSystemTime(new Date("2026-12-11T00:01:00Z"))
    s.store.runSecretSantaConfirmationSchedule()
    expect(() => readmit(s, "b", { giverId: "a" })).toThrow(/segna il regalo come già preso/)
    const after = readmit(s, "b", { giverId: "a", confirmed: true })
    expect(cycle(s.state)).toEqual({ a: "b", b: "a" })
    expect(after.participants.map((p) => [p.userId, p.giftConfirmedAt])).toEqual([
      ["a", Date.now()],
      ["b", Date.now()],
    ])
    expect(after.history[0]?.changes.filter((c) => c.field === "Conferma regalo")).toEqual([
      {
        userId: "b",
        name: "Person b",
        field: "Conferma regalo",
        before: "Da confermare",
        after: "Confermato",
      },
      {
        userId: "a",
        name: "Person a",
        field: "Conferma regalo",
        before: "Da confermare",
        after: "Confermato",
      },
    ])
    s.store.runSecretSantaConfirmationSchedule()
    expect(s.state().counters).toMatchObject({ active: 2, removed: 0 })
    expect(
      s
        .state()
        .formerParticipants.map((p) => p.userId)
        .sort(),
    ).toEqual(["c", "d"])
    expect(cycle(s.state)).toEqual({ a: "b", b: "a" })
  })

  it("after the deadline confirms the first Santa when two people are readmitted into an empty round", () => {
    const s = setup()
    for (const id of ["a", "b", "c", "d"]) s.store.withdrawSecretSanta(s.activity.id, id)
    vi.setSystemTime(new Date("2026-12-11T00:01:00Z"))
    readmit(s, "a")
    readmit(s, "b", { giverId: "a", confirmed: true })
    s.store.runSecretSantaConfirmationSchedule()
    expect(s.state().counters).toMatchObject({ active: 2, confirmed: 2, removed: 0 })
    expect(cycle(s.state)).toEqual({ a: "b", b: "a" })
  })

  it("drops an old confirmation unless the organizer marks the gift as bought", () => {
    const s = setup()
    s.store.confirmSecretSantaGift(s.activity.id, "a")
    s.store.withdrawSecretSanta(s.activity.id, "a")
    const after = readmit(s, "a", { giverId: "b" })
    expect(after.participants.find((p) => p.userId === "a")?.giftConfirmedAt).toBeNull()
  })

  it("sends the ordinary draw email to a readmitted person who was never emailed", async () => {
    const s = setup()
    s.store.removeSecretSantaParticipant(s.activity.id, "a", actor, { reason: "Errore" })
    await runSecretSantaJobs(s.store, s.mailer, "https://live.example")
    expect(s.mailer.sendSecretSanta.mock.calls.map(([m]) => m.userId).sort()).toEqual(["b", "c", "d"])
    vi.clearAllMocks()
    readmit(s, "a", { giverId: "c" })
    await runSecretSantaJobs(s.store, s.mailer, "https://live.example")
    await runSecretSantaJobs(s.store, s.mailer, "https://live.example")
    expect(s.mailer.sendSecretSanta.mock.calls.map(([m]) => [m.userId, m.to])).toEqual([
      ["a", "a@example.test"],
    ])
    expect(s.mailer.sendSecretSantaReassigned.mock.calls.map(([m]) => m.userId)).toEqual(["c"])
  })

  it("readmits a person removed before the archive existed, with a letter written again", async () => {
    const s = setup()
    const { db, store, activity, state, mailer } = s
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      `santa-removed:${activity.id}`,
      JSON.stringify({
        z: {
          closesAt: Date.parse("2026-12-10T23:00:00Z"),
          at: 5,
          name: "Person z",
          email: "z@example.test",
          deadline: "2026-12-10T12:00:00Z",
          sentAt: null,
        },
      }),
    )
    expect(state().formerParticipants).toEqual([
      { userId: "z", name: "Person z", email: "z@example.test", reason: "unconfirmed", at: 5, entry: null },
    ])
    const after = readmit(s, "z", { giverId: "a", entry: { likes: "libri", dislikes: "", gadget: false } })
    expect(after.participants.find((p) => p.userId === "z")).toMatchObject({ email: "z@example.test" })
    expect(after.history[0]?.changes).toContainEqual({
      userId: "z",
      name: "Person z",
      field: "Cose che ama",
      before: null,
      after: "Testo aggiornato",
    })
    expect(after.history[0]?.changes[0]).toMatchObject({ before: "Non confermato", after: "Attivo" })
    expect(after.counters).toMatchObject({ removed: 0, former: 0 })
    expect(store.listSecretSantas("z")[0]?.removed).toBeNull()
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(mailer.sendSecretSantaStatus).not.toHaveBeenCalled()
    cycle(state)
  })

  it("validates readmission requests over HTTP", async () => {
    const s = setup()
    const { call, activity, state, store } = s
    store.withdrawSecretSanta(activity.id, "a")
    const url = (id: string) => `/api/admin/secret-santa/${activity.id}/participants/${id}/readmit`
    const body = () => ({ revision: state().revision, reason: "Torna", entry: letter("x"), giverId: "b" })
    expect((await call(url("a"), "POST", body(), "b")).status).toBe(403)
    expect((await call(url("a"), "POST", body(), null)).status).toBe(401)
    expect((await call(url("a"), "POST", { ...body(), reason: " " })).status).toBe(400)
    expect((await call(url("a"), "POST", { ...body(), entry: { likes: "" } })).status).toBe(400)
    expect((await call(url("a"), "POST", { ...body(), giverId: "a" })).status).toBe(400)
    expect((await call(url("a"), "POST", { ...body(), giverId: undefined })).status).toBe(400)
    expect((await call(url("nobody"), "POST", body())).status).toBe(404)
    // Inherited object keys are not former participants.
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"])
      expect((await call(url(id), "POST", body())).status).toBe(404)
    expect(state().participants.map((p) => p.userId)).not.toContain("constructor")
    expect((await call(url("c"), "POST", body())).status).toBe(409)
    const stale = body()
    store.confirmSecretSantaGift(activity.id, "c")
    const conflict = await call(url("a"), "POST", stale)
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error).toMatch(/situazione è cambiata/)
    expect(state().counters.active).toBe(3)
    const ok = await call(url("a"), "POST", body())
    expect(ok.status).toBe(200)
    expect((await ok.json()).counters).toMatchObject({ active: 4, former: 0 })
    expect((await call(url("a"), "POST", body())).status).toBe(409)
  })

  it("rolls back a readmission if recording it fails", () => {
    const s = setup()
    s.store.withdrawSecretSanta(s.activity.id, "a")
    const before = s.state()
    s.db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON secret_santa_admin_actions BEGIN SELECT RAISE(ABORT, 'Audit failed'); END;",
    )
    expect(() => readmit(s, "a", { giverId: "b" })).toThrow("Audit failed")
    expect(s.state()).toEqual(before)
  })

  it("corrects a letter with an audit row per field and shows the update only to the Santa", async () => {
    const s = setup()
    const { call, activity, state, store, app } = s
    const url = (id: string) => `/api/admin/secret-santa/${activity.id}/participants/${id}/entry`
    const body = (entry: unknown) => ({ revision: state().revision, reason: "Refuso", entry })
    expect((await call(url("b"), "PATCH", body(letter("x")), "a")).status).toBe(403)
    expect((await call(url("zz"), "PATCH", body(letter("x")))).status).toBe(404)
    expect((await call(url("b"), "PATCH", body({ likes: " ", dislikes: "", gadget: true }))).status).toBe(400)
    const stale = body(letter("x"))
    store.confirmSecretSantaGift(activity.id, "a")
    expect((await call(url("b"), "PATCH", stale)).status).toBe(409)
    const response = await call(
      url("b"),
      "PATCH",
      body({ likes: "tè verde", dislikes: "caffè", gadget: true }),
    )
    expect(response.status).toBe(200)
    const after = await response.json()
    expect(after.history[0]).toMatchObject({ kind: "Letterina", reason: "Refuso", actor: "admin" })
    expect(after.history[0].changes).toEqual([
      {
        userId: "b",
        name: "Person b",
        field: "Cose che ama",
        before: "Testo precedente",
        after: "Testo aggiornato",
      },
      { userId: "b", name: "Person b", field: "Meglio di no", before: "Vuoto", after: "Testo aggiornato" },
    ])
    // The audit history outlives a reset: it records that the letter changed, never what it says.
    expect(JSON.stringify(after.history)).not.toMatch(/likes-b|tè verde|caffè/)
    const history = state().history.length
    expect(
      (await call(url("b"), "PATCH", body({ likes: "tè verde", dislikes: "caffè", gadget: true }))).status,
    ).toBe(200)
    expect(state().history).toHaveLength(history)
    const row = s.db.prepare("SELECT user_name, user_email FROM responses WHERE user_id = 'b'").get()
    expect(row).toEqual({ user_name: "Person b", user_email: "b@example.test" })

    const giver = state().participants.find((p) => p.match?.userId === "b")?.userId as string
    expect(store.listSecretSantas(giver)[0]?.match).toMatchObject({ likes: "tè verde", editedAt: Date.now() })
    for (const other of ["a", "b", "c", "d"].filter((id) => id !== giver)) {
      const view = store.listSecretSantas(other)[0]
      expect(view?.match?.editedAt).toBeNull()
      if (other !== "b") expect(JSON.stringify(view)).not.toMatch(/tè verde|caffè/)
    }
    expect(store.listSecretSantas("b")[0]?.entry).toMatchObject({ likes: "tè verde" })

    store.withdrawSecretSanta(activity.id, "d")
    const key = store.getApiKey()
    const presentation = await app.request(`/api/v1/activities/${activity.id}/results`, {
      headers: { authorization: `Bearer ${key}` },
    })
    const leaks = /Person|example\.test|likes-|tè verde|caffè|former|archived|editedAt|revision|history/
    expect(JSON.stringify(await presentation.json())).not.toMatch(leaks)
    expect(JSON.stringify(store.getResults(activity.id))).not.toMatch(leaks)
    expect(JSON.stringify(store.listSecretSantas("a"))).not.toMatch(/likes-d|archived|former/)

    store.undoSecretSantaDraw(activity.id, actor)
    expect(
      s.db.prepare("SELECT 1 FROM settings WHERE key = ?").get(`santa-letter-edited:${activity.id}`),
    ).toBeUndefined()
  })

  it("does not mark a letter as updated before the draw", () => {
    const { store, activity, state, db } = setup({ draw: false })
    store.updateSecretSantaEntry(activity.id, "a", actor, {
      revision: state().revision,
      reason: "Richiesta",
      entry: letter("nuovo", false),
    })
    expect(state().history[0]?.changes).toHaveLength(2)
    expect(
      db.prepare("SELECT 1 FROM settings WHERE key = ?").get(`santa-letter-edited:${activity.id}`),
    ).toBeUndefined()
  })
})
