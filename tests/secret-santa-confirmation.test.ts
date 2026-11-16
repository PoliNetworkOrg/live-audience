import type { MiddlewareHandler } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { confirmationClosesAt, secretSanta } from "../src/activities/secret-santa/definition.ts"
import { createApp } from "../src/server/app.ts"
import type { AuthVariables } from "../src/server/auth.ts"
import { openDatabase } from "../src/server/db.ts"
import { type Mailer, runSecretSantaJobs } from "../src/server/jobs.ts"
import { Store } from "../src/server/store.ts"

const due = "2026-12-10T12:00:00.000Z"
const midnight = Date.parse("2026-12-10T23:00:00.000Z")
const session: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const id = c.req.header("x-user")
  c.set("user", id ? { id, name: id, isAdmin: false, canParticipate: false } : null)
  await next()
}
function setup(count = 4) {
  const db = openDatabase(":memory:")
  const store = new Store(db)
  const activity = store.createActivity({ type: "secret-santa", title: "Natale", slug: "santa" })
  store.updateActivity(activity.id, {
    config: { ...secretSanta.defaultConfig(), visible: true, confirmationDueAt: due },
  })
  const ids = Array.from({ length: count }, (_, i) => String(i))
  for (const id of ids)
    store.joinSecretSanta(
      activity.id,
      { id, name: `Person ${id}`, email: `${id}@example.test` },
      { likes: id, dislikes: "", gadget: true },
    )
  store.drawSecretSanta(activity.id)
  const mailer = {
    sendSecretSanta: vi.fn<Mailer["sendSecretSanta"]>(async () => {}),
    sendSecretSantaReassigned: vi.fn<Mailer["sendSecretSantaReassigned"]>(async () => {}),
    sendSecretSantaStatus: vi.fn<Mailer["sendSecretSantaStatus"]>(async () => {}),
  } satisfies Mailer
  const view = (id: string) => {
    const result = store.listSecretSantas(id)[0]
    if (!result) throw new Error("Missing test activity")
    return result
  }
  return { store, db, activity, ids, mailer, view, app: createApp({ store, session }) }
}

describe("Italian confirmation deadline", () => {
  it.each([
    [due, "2026-12-10T23:00:00.000Z"],
    ["2026-07-10T12:00:00Z", "2026-07-10T22:00:00.000Z"],
    ["2026-03-28T12:00:00Z", "2026-03-28T23:00:00.000Z"],
    ["2026-03-29T12:00:00Z", "2026-03-29T22:00:00.000Z"],
    ["2026-10-24T12:00:00Z", "2026-10-24T22:00:00.000Z"],
    ["2026-10-25T12:00:00Z", "2026-10-25T23:00:00.000Z"],
    ["2026-12-31T23:30:00Z", "2027-01-01T23:00:00.000Z"],
  ])("closes %s at %s", (deadline, expected) =>
    expect(new Date(confirmationClosesAt(deadline) as number).toISOString()).toBe(expected),
  )
  it("leaves existing configurations without automatic removal", () => {
    const { confirmationDueAt: _, ...old } = secretSanta.defaultConfig()
    expect(secretSanta.configSchema.parse(old).confirmationDueAt).toBe("")
    expect(confirmationClosesAt("")).toBeNull()
  })
})

describe("gift confirmation and expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it("ignores acknowledgments from a draw reset during mail delivery", async () => {
    const { store, activity, mailer } = setup()
    const oldDraw = store.pendingSecretSantaMails()[0]?.drawnAt
    mailer.sendSecretSanta.mockImplementationOnce(async () => {
      store.undoSecretSantaDraw(activity.id)
      vi.setSystemTime(Date.now() + 1000)
      store.drawSecretSanta(activity.id)
    })
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(store.pendingSecretSantaMails()).toHaveLength(4)
    expect(store.pendingSecretSantaMails()[0]?.drawnAt).not.toBe(oldDraw)
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(store.pendingSecretSantaMails()).toEqual([])
  })

  it.each([true, false])("uses recorded confirmations for prototype-named users: %s", (confirm) => {
    const { store, activity, view } = setup()
    store.undoSecretSantaDraw(activity.id)
    store.joinSecretSanta(
      activity.id,
      { id: "constructor", name: "Test participant", email: "test@example.test" },
      { likes: "Books", dislikes: "", gadget: false },
    )
    store.drawSecretSanta(activity.id)
    if (confirm) {
      store.confirmSecretSantaGift(activity.id, "constructor")
      expect(view("constructor").giftConfirmedAt).toBe(Date.now())
    }
    store.runSecretSantaConfirmationSchedule(Date.parse(due))
    expect(
      store.pendingSecretSantaStatusMails(Date.parse(due)).some((mail) => mail.userId === "constructor"),
    ).toBe(!confirm)
    store.runSecretSantaConfirmationSchedule(midnight)
    expect(view("constructor").entry !== null).toBe(confirm)
  })

  it("confirms only the signed-in participant, persists and is idempotent", async () => {
    const { app, activity, view, store, db } = setup()
    const url = `/api/secret-santa/${activity.id}/confirm-gift`
    expect((await app.request(url, { method: "POST" })).status).toBe(401)
    expect(
      (
        await app.request(url, {
          method: "POST",
          headers: { "x-user": "outsider", "content-type": "application/json" },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await app.request(url, {
          method: "POST",
          headers: { "x-user": "0", "content-type": "application/x-www-form-urlencoded" },
          body: "confirmed=true",
        })
      ).status,
    ).toBe(415)
    expect(view("0").giftConfirmedAt).toBeNull()
    expect((await app.request(url, { headers: { "x-user": "0" } })).status).toBe(404)
    const result = await app.request(url, {
      method: "POST",
      headers: { "x-user": "0", "content-type": "application/json" },
      body: JSON.stringify({ userId: "1" }),
    })
    expect(result.status).toBe(200)
    const first = view("0").giftConfirmedAt
    expect(first).toBe(Date.now())
    expect(view("1").giftConfirmedAt).toBeNull()
    vi.setSystemTime(midnight + 1000)
    expect(store.confirmSecretSantaGift(activity.id, "0").giftConfirmedAt).toBe(first)
    expect(new Store(db).listSecretSantas("0")[0]?.giftConfirmedAt).toBe(first)
    expect(JSON.stringify(store.getResults(activity.id))).not.toMatch(/giftConfirmedAt|example.test|Person/)
  })

  it("warns once, permits confirmation in grace time, and removes only the rest at midnight", async () => {
    const { store, activity, mailer, view } = setup()
    await runSecretSantaJobs(store, mailer, "https://live.example")
    vi.setSystemTime(new Date(due))
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(mailer.sendSecretSantaStatus).toHaveBeenCalledTimes(4)
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(mailer.sendSecretSantaStatus).toHaveBeenCalledTimes(4)
    vi.setSystemTime(midnight - 1)
    const kept = store.confirmSecretSantaGift(activity.id, "0").giftConfirmedAt
    store.confirmSecretSantaGift(activity.id, "1")
    vi.setSystemTime(midnight)
    expect(() => store.confirmSecretSantaGift(activity.id, "2")).toThrow(/scaduto/)
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(view("0").giftConfirmedAt).toBe(kept)
    expect(view("0").match?.name).toBe("Person 1")
    expect(view("1").match?.name).toBe("Person 0")
    for (const id of ["2", "3"]) {
      expect(view(id)).toMatchObject({
        removed: { reason: "unconfirmed" },
        entry: null,
        match: null,
        canJoin: false,
      })
      expect(() => store.confirmSecretSantaGift(activity.id, id)).toThrow()
    }
    expect(mailer.sendSecretSantaStatus.mock.calls.filter(([m]) => m.kind === "removed")).toHaveLength(2)
    const reassignments = mailer.sendSecretSantaReassigned.mock.calls.map(([m]) => m)
    expect(new Set(reassignments.map((m) => m.userId)).size).toBe(reassignments.length)
    expect(reassignments.every((m) => m.reason === "unconfirmed")).toBe(true)
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(mailer.sendSecretSantaStatus).toHaveBeenCalledTimes(6)
  })

  it("retries failed warnings, cancels them after confirmation and retries removal notices after restart", async () => {
    const { store, db, activity, mailer } = setup(3)
    vi.setSystemTime(new Date(due))
    store.runSecretSantaConfirmationSchedule()
    const warnings = store.pendingSecretSantaStatusMails()
    expect(warnings).toHaveLength(3)
    store.confirmSecretSantaGift(activity.id, "0")
    expect(
      store
        .pendingSecretSantaStatusMails()
        .map((m) => m.userId)
        .sort(),
    ).toEqual(["1", "2"])
    mailer.sendSecretSantaStatus.mockRejectedValue(new Error("Offline"))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(store.pendingSecretSantaStatusMails()).toHaveLength(2)
    vi.setSystemTime(midnight)
    store.runSecretSantaConfirmationSchedule()
    const restarted = new Store(db)
    expect(restarted.pendingSecretSantaStatusMails().map((m) => m.kind)).toEqual(["removed", "removed"])
    mailer.sendSecretSantaStatus.mockResolvedValue(undefined)
    await runSecretSantaJobs(restarted, mailer, "https://live.example")
    expect(restarted.pendingSecretSantaStatusMails()).toHaveLength(0)
    expect(restarted.listSecretSantas("0")[0]?.match).toBeNull()
    log.mockRestore()
  })

  it("can remove everybody without self-gifts or intermediate reassignment emails", async () => {
    const { store, mailer, ids, view } = setup(6)
    await runSecretSantaJobs(store, mailer, "https://live.example")
    vi.setSystemTime(midnight)
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(ids.every((id) => view(id).removed !== null && view(id).match === null)).toBe(true)
    expect(mailer.sendSecretSantaReassigned).not.toHaveBeenCalled()
    expect(mailer.sendSecretSantaStatus).toHaveBeenCalledTimes(6)
  })

  it("rewires contiguous removals once and names only the original recipient in the notice", async () => {
    const { store, db, activity, mailer, view } = setup(5)
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(
      JSON.stringify({
        drawnAt: Date.now(),
        assignments: { "0": "1", "1": "2", "2": "3", "3": "4", "4": "0" },
      }),
      `santa-draw:${activity.id}`,
    )
    await runSecretSantaJobs(store, mailer, "https://live.example")
    const originalConfirmation = store.confirmSecretSantaGift(activity.id, "0").giftConfirmedAt
    store.confirmSecretSantaGift(activity.id, "3")
    store.confirmSecretSantaGift(activity.id, "4")
    store.withdrawSecretSanta(activity.id, "1")
    // A second change before the first notification is delivered must not name an unknown interim recipient.
    vi.setSystemTime(midnight)
    await runSecretSantaJobs(store, mailer, "https://live.example")
    expect(view("0").match?.name).toBe("Person 3")
    expect(view("0").giftConfirmedAt).toBe(originalConfirmation)
    expect(mailer.sendSecretSantaReassigned).toHaveBeenCalledTimes(1)
    expect(mailer.sendSecretSantaReassigned.mock.calls[0]?.[0]).toMatchObject({
      userId: "0",
      withdrawnName: "Person 1",
      hasNewMatch: true,
    })
    expect(mailer.sendSecretSantaReassigned.mock.calls[0]?.[0].reason).toBeUndefined()
  })

  it("clears confirmations and removal state when the draw is undone", () => {
    const { store, activity, view } = setup()
    store.confirmSecretSantaGift(activity.id, "0")
    vi.setSystemTime(midnight)
    store.runSecretSantaConfirmationSchedule()
    store.undoSecretSantaDraw(activity.id)
    expect(view("0").giftConfirmedAt).toBeNull()
    expect(view("1").removed).toBeNull()
  })
})
