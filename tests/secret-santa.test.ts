import type { MiddlewareHandler } from "hono"
import { describe, expect, it } from "vitest"
import { buildCycle, pickWinners, withdrawFromCycle } from "../src/activities/secret-santa/definition.ts"
import { createApp } from "../src/server/app.ts"
import type { AuthVariables, SessionUser } from "../src/server/auth.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"

const people: Record<string, SessionUser> = {
  admin: { id: "admin", name: "Ada", canParticipate: true, isAdmin: true },
  ...Object.fromEntries(
    ["a", "b", "c", "d"].map((id) => [id, { id, name: `Name ${id}`, canParticipate: false, isAdmin: false }]),
  ),
  socio: { id: "socio", name: "Sara", canParticipate: true, isAdmin: false },
}

const session: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  c.set("user", people[c.req.header("x-test-user") ?? ""] ?? null)
  await next()
}

const entry = (likes: string, gadget = true) => ({ likes, dislikes: "", gadget })

function setup(config: Record<string, unknown> = {}) {
  const store = new Store(openDatabase(":memory:"))
  const app = createApp({ store, session })
  const activity = store.createActivity({ type: "secret-santa", title: "Natale 2026", slug: "santa" })
  store.updateActivity(activity.id, {
    config: { ...(activity.config as object), visible: true, ...config },
  })
  const call = async (path: string, as?: string, method = "GET", body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(as ? { "x-test-user": as } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return {
      status: res.status,
      // biome-ignore lint/suspicious/noExplicitAny: response shapes are asserted by each test
      json: (await res.json().catch(() => null)) as any,
    }
  }
  const join = (as: string, likes = `likes of ${as}`, gadget = true) =>
    call(`/api/secret-santa/${activity.id}/entry`, as, "PUT", entry(likes, gadget))
  return { store, activity, call, join }
}

/** Follows the gift cycle from `start`, as seen by each participant through the API. */
async function cycleFrom(call: ReturnType<typeof setup>["call"], ids: string[]) {
  const matches: Record<string, string | null> = {}
  for (const id of ids) {
    const [view] = (await call("/api/secret-santa", id)).json
    matches[id] = view.match ? (ids.find((other) => `Name ${other}` === view.match.name) ?? null) : null
  }
  return matches
}

describe("secret santa helpers", () => {
  it("builds one cycle through everyone with no self-gifts", () => {
    for (let seed = 0; seed < 50; seed++) {
      let x = seed
      const ids = ["a", "b", "c", "d", "e"]
      const cycle = buildCycle(ids, (n) => {
        x = (x * 7 + 3) % 101
        return x % n
      })
      expect(Object.keys(cycle).sort()).toEqual(ids)
      expect(Object.values(cycle).sort()).toEqual(ids)
      let current = "a"
      const seen = new Set<string>()
      for (const _ of ids) {
        expect(cycle[current]).not.toBe(current)
        seen.add(current)
        current = cycle[current] as string
      }
      expect(seen.size).toBe(ids.length)
      expect(current).toBe("a")
    }
  })

  it("withdrawing only rewires the withdrawn person's Santa", () => {
    expect(withdrawFromCycle({ a: "b", b: "c", c: "d", d: "a" }, "b")).toEqual({ a: "c", c: "d", d: "a" })
    expect(withdrawFromCycle({ a: "b", b: "c", c: "a" }, "c")).toEqual({ a: "b", b: "a" })
    expect(withdrawFromCycle({ a: "b", b: "a" }, "b")).toEqual({ a: null })
  })

  it("picks distinct winners, never more than there are entrants", () => {
    expect(pickWinners(["a", "b", "c"], 2, () => 0)).toEqual(["a", "b"])
    expect(pickWinners(["a"], 3, () => 0)).toEqual(["a"])
  })
})

describe("secret santa", () => {
  it("is open to anyone signed in, off stage, but hidden until made visible", async () => {
    const { call, join, activity, store } = setup({ visible: false })
    expect((await call("/api/secret-santa")).status).toBe(401)
    expect((await call("/api/secret-santa", "a")).json).toEqual([])
    expect((await join("a")).status).toBe(404)
    store.updateActivity(activity.id, {
      config: { ...(store.requireActivity(activity.id).config as object), visible: true },
    })
    const joined = await join("a")
    expect(joined.status).toBe(200)
    expect(joined.json).toMatchObject({ entry: entry("likes of a"), participants: 1, canJoin: true })
    expect(store.getStage().activityId).toBeNull()
    expect(() => store.setStage(activity.id, "open")).toThrow("off stage")
    expect((await join("b", " ")).status).toBe(400)
  })

  it("shows each person only their own match and keeps pairings out of the API key", async () => {
    const { call, join, activity, store } = setup()
    for (const id of ["a", "b", "c", "d"]) await join(id)
    const results = (await call(`/api/admin/secret-santa/${activity.id}/draw`, "admin", "POST")).json
    expect(results.drawnAt).toEqual(expect.any(Number))
    expect(JSON.stringify(results)).not.toMatch(/likes of|match|assign/)

    const matches = await cycleFrom(call, ["a", "b", "c", "d"])
    expect(Object.values(matches).sort()).toEqual(["a", "b", "c", "d"])
    for (const [giver, receiver] of Object.entries(matches)) expect(receiver).not.toBe(giver)
    const [view] = (await call("/api/secret-santa", "a")).json
    expect(view.match.likes).toBe(`likes of ${matches.a}`)

    const viaKey = JSON.stringify(store.getResults(activity.id))
    expect(viaKey).not.toMatch(/Name |likes of/)
    expect(store.getResults(activity.id).results).toMatchObject({ participants: 4, drawn: true })

    // Sign-ups close with the draw, and drawing again changes nothing.
    expect((await join("socio")).status).toBe(409)
    await call(`/api/admin/secret-santa/${activity.id}/draw`, "admin", "POST")
    expect(await cycleFrom(call, ["a", "b", "c", "d"])).toEqual(matches)
  })

  it("after a withdrawal only the withdrawn person's Santa gets a new match", async () => {
    const { call, join, activity } = setup()
    for (const id of ["a", "b", "c", "d"]) await join(id)
    await call(`/api/admin/secret-santa/${activity.id}/draw`, "admin", "POST")
    const before = await cycleFrom(call, ["a", "b", "c", "d"])
    const leaving = "b"
    const santaOfLeaving = Object.keys(before).find((g) => before[g] === leaving) as string

    const left = await call(`/api/secret-santa/${activity.id}/entry`, leaving, "DELETE")
    expect(left.json).toMatchObject({ entry: null, match: null, canJoin: false })
    const remaining = ["a", "c", "d"]
    const after = await cycleFrom(call, remaining)
    for (const id of remaining) {
      expect(after[id]).toBe(id === santaOfLeaving ? before[leaving] : before[id])
    }
    expect((await join(leaving)).status).toBe(409)
  })

  it("draws gadget winners secretly among those who opted in", async () => {
    const { call, join, activity, store } = setup({ gadget: { enabled: true, prize: "Felpa", winners: 1 } })
    await join("a", "x", false)
    await join("b", "x", true)
    const admin = (await call(`/api/admin/secret-santa/${activity.id}/gadget-draw`, "admin", "POST")).json
    expect(admin.gadget.winners).toEqual([{ userId: "b", name: "Name b" }])
    expect((await call("/api/secret-santa", "b")).json[0].gadgetWon).toBe(true)
    expect((await call("/api/secret-santa", "a")).json[0].gadgetWon).toBeNull()
    expect(JSON.stringify(store.getResults(activity.id))).not.toContain("Name b")

    // Opting in or out after the gadget draw is ignored.
    await join("a", "x", true)
    expect((await call("/api/secret-santa", "a")).json[0].entry.gadget).toBe(false)
  })

  it("is admin-only to draw, list or remove participants", async () => {
    const { call, join, activity } = setup()
    await join("a")
    await join("b")
    expect((await call(`/api/admin/secret-santa/${activity.id}`, "socio")).status).toBe(403)
    expect((await call(`/api/admin/secret-santa/${activity.id}/draw`, "a", "POST")).status).toBe(403)
    const removed = await call(`/api/admin/secret-santa/${activity.id}/participants/b`, "admin", "DELETE")
    expect(removed.json.participants.map((p: { name: string }) => p.name)).toEqual(["Name a"])
    expect((await call(`/api/admin/secret-santa/${activity.id}/draw`, "admin", "POST")).status).toBe(409)
  })
})
