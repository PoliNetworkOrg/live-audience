import { beforeEach, describe, expect, it, vi } from "vitest"
import { closestEntries, numberLottery } from "../src/activities/number-lottery/definition.ts"
import { createApp } from "../src/server/app.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"

const randomInt = vi.hoisted(() => vi.fn(() => 0))
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
  randomInt,
}))

beforeEach(() => randomInt.mockReset().mockReturnValue(0))

function setup() {
  const db = openDatabase(":memory:")
  const store = new Store(db)
  const activity = store.createActivity({ type: "number-lottery", title: "Gadget", slug: "gadget-number" })
  store.setStage(activity.id, "open")
  const join = (id: string, number: number, name = id) =>
    store.respond(activity.id, { id, name: "Private account name" }, { name, number })
  return { db, store, activity, join }
}

describe("number lottery", () => {
  it("accepts only integers from 0 to 100 and normalizes display names", () => {
    const schema = numberLottery.responseSchema(numberLottery.defaultConfig())
    for (const number of [0, 100])
      expect(schema.parse({ name: "  Ada   B ", number })).toEqual({ name: "Ada B", number })
    for (const number of [-1, 101, 1.5, "50", NaN])
      expect(schema.safeParse({ name: "Ada", number }).success).toBe(false)
    expect(schema.safeParse({ name: " ", number: 50 }).success).toBe(false)
    expect(schema.safeParse({ name: "x".repeat(81), number: 50 }).success).toBe(false)
  })

  it("calculates both-sided ties, exact guesses and edge distances", () => {
    const entries = [
      { name: "A", number: 40 },
      { name: "B", number: 44 },
      { name: "C", number: 100 },
    ]
    expect(closestEntries(entries, 42)).toEqual({ distance: 2, closest: entries.slice(0, 2) })
    expect(closestEntries(entries, 44)).toEqual({ distance: 0, closest: [entries[1]] })
    expect(closestEntries(entries, 0)).toEqual({ distance: 40, closest: [entries[0]] })
    expect(closestEntries(entries, 100)).toEqual({ distance: 0, closest: [entries[2]] })
  })

  it("draws one tied winner, closes entries, persists and refuses rerolls/reopening", () => {
    const { db, store, activity, join } = setup()
    try {
      join("a", 1)
      join("a", 40, "Same display name")
      join("b", 44, "Same display name")
      join("c", 90)
      randomInt.mockReturnValueOnce(42).mockReturnValueOnce(1)
      const result = store.drawNumber(activity.id)
      expect(result.results.draw).toMatchObject({
        number: 42,
        distance: 2,
        closest: [
          { name: "Same display name", number: 40 },
          { name: "Same display name", number: 44 },
        ],
        winners: [{ name: "Same display name", number: 44 }],
      })
      expect(result.results.totalParticipants).toBe(3)
      expect(randomInt.mock.calls).toEqual([[0, 101], [2]])
      expect(store.getStage().status).toBe("closed")
      expect(() => join("a", 42)).toThrow("not accepting answers")
      expect(() => store.setStage(activity.id, "open")).toThrow("Reset this lottery")
      expect(() => store.setStageStatus("open")).toThrow("Reset this lottery")
      expect(store.drawNumber(activity.id)).toEqual(result)
      expect(new Store(db).drawNumber(activity.id)).toEqual(result)
      expect(randomInt).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(result)).not.toContain("Private account name")
      expect(JSON.stringify(result)).not.toContain("userId")
      store.resetResponses(activity.id)
      expect(store.getResults(activity.id).results).toMatchObject({ totalParticipants: 0, draw: null })
      store.setStage(activity.id, "open")
      join("a", 100)
      randomInt.mockReturnValueOnce(100).mockReturnValueOnce(0)
      expect(store.drawNumber(activity.id).results.draw.number).toBe(100)
      store.deleteActivity(activity.id)
      expect(
        db.prepare("SELECT value FROM settings WHERE key = ?").get(`number-draw:${activity.id}`),
      ).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it("rejects empty/off-stage/wrong-type draws without changing the stage", () => {
    const { db, store, activity, join } = setup()
    try {
      expect(() => store.drawNumber(activity.id)).toThrow("At least one participant")
      expect(store.getStage().status).toBe("open")
      join("a", 0)
      store.clearStage()
      expect(() => store.drawNumber(activity.id)).toThrow("on stage first")
      const poll = store.createActivity({ type: "poll", title: "Poll", slug: "poll" })
      expect(() => store.drawNumber(poll.id)).toThrow("not a number lottery")
      expect(randomInt).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it("rolls back both the draw and stage if a database write fails", () => {
    const { db, store, activity, join } = setup()
    try {
      join("a", 0)
      db.exec(
        "CREATE TRIGGER reject_stage BEFORE UPDATE ON settings WHEN NEW.key = 'stage' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      )
      expect(() => store.drawNumber(activity.id)).toThrow("test failure")
      expect(store.getResults(activity.id).results.draw).toBeNull()
      expect(store.getStage().status).toBe("open")
    } finally {
      db.close()
    }
  })

  it("protects the draw endpoint and exposes a saved outcome through results", async () => {
    const { db, store, activity, join } = setup()
    try {
      join("a", 0)
      const app = createApp({
        store,
        session: async (c, next) => {
          c.set("user", null)
          await next()
        },
      })
      const path = `/api/v1/activities/${activity.slug}/draw`
      expect((await app.request(path, { method: "POST" })).status).toBe(401)
      expect(
        (await app.request(`/api/admin/activities/${activity.id}/draw`, { method: "POST" })).status,
      ).toBe(401)
      const headers = { Authorization: `Bearer ${store.getApiKey()}` }
      const response = await app.request(path, { method: "POST", headers })
      expect(response.status).toBe(200)
      const drawn = await response.json()
      expect(drawn.results.draw).toMatchObject({
        number: 0,
        distance: 0,
        winners: [{ name: "a", number: 0 }],
      })
      expect(
        await (await app.request(`/api/v1/activities/${activity.slug}/results`, { headers })).json(),
      ).toEqual(drawn)
    } finally {
      db.close()
    }
  })
})
