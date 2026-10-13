import type { MiddlewareHandler } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import { createApp } from "../src/server/app.ts"
import type { AuthVariables, SessionUser } from "../src/server/auth.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"

const admin: SessionUser = { id: "admin", name: "Ada", canParticipate: true, isAdmin: true }
const socio: SessionUser = { id: "socio", name: "Sara", canParticipate: true, isAdmin: false }
const guest: SessionUser = { id: "guest", name: "Nico", canParticipate: false, isAdmin: false }
const users: Record<string, SessionUser> = { admin, socio, guest }

/** Tests pick the signed-in user with an `x-test-user` header instead of a session cookie. */
const session: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  c.set("user", users[c.req.header("x-test-user") ?? ""] ?? null)
  await next()
}

let store: Store
let app: ReturnType<typeof createApp>

function call(path: string, init: { as?: string; key?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (init.as) headers["x-test-user"] = init.as
  if (init.key) headers.authorization = `Bearer ${init.key}`
  if (init.body !== undefined) headers["content-type"] = "application/json"
  return app.request(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

async function createPoll() {
  await call("/api/admin/activities", {
    as: "admin",
    body: { type: "poll", title: "Dinner", slug: "dinner" },
  })
  const res = await call("/api/admin/activities/dinner", {
    as: "admin",
    method: "PATCH",
    body: {
      config: {
        question: "What for dinner?",
        options: [
          { id: "a", label: "Pizza" },
          { id: "b", label: "Sushi" },
          { id: "c", label: "Kebab" },
        ],
        maxChoices: 1,
      },
    },
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { id: string }
}

beforeEach(() => {
  store = new Store(openDatabase(":memory:"))
  app = createApp({ store, session })
})

describe("access", () => {
  it("keeps the admin API to admins", async () => {
    expect((await call("/api/admin/activities")).status).toBe(401)
    expect((await call("/api/admin/activities", { as: "socio" })).status).toBe(403)
    expect((await call("/api/admin/activities", { as: "admin" })).status).toBe(200)
  })

  it("keeps the audience to members", async () => {
    expect((await call("/api/audience/stage")).status).toBe(401)
    expect((await call("/api/audience/stage", { as: "guest" })).status).toBe(403)
    expect((await call("/api/audience/stage", { as: "socio" })).status).toBe(200)
  })

  it("requires the current API key", async () => {
    expect((await call("/api/v1/stage")).status).toBe(401)
    expect((await call("/api/v1/stage", { key: "nope" })).status).toBe(401)
    const key = store.getApiKey()
    expect((await call("/api/v1/stage", { key })).status).toBe(200)
    expect((await call(`/api/v1/stage?key=${key}`)).status).toBe(200)
    store.regenerateApiKey()
    expect((await call("/api/v1/stage", { key })).status).toBe(401)
  })
})

describe("a poll, driven by a presentation", () => {
  it("accepts answers only while open, one per person, and aggregates them", async () => {
    const { id } = await createPoll()
    const key = store.getApiKey()
    const vote = (as: string, choices: string[]) =>
      call("/api/audience/respond", { as, body: { activityId: id, response: { choices } } })

    expect((await vote("socio", ["a"])).status).toBe(409) // not on stage yet

    const opened = await call("/api/v1/stage", { key, body: { activity: "dinner" } })
    expect(await opened.json()).toMatchObject({ status: "open", activity: { slug: "dinner" } })

    const stage = await (await call("/api/audience/stage", { as: "socio" })).json()
    expect(stage).toMatchObject({ status: "open", activity: { id, type: "poll" }, myResponse: null })

    expect((await vote("socio", ["a"])).status).toBe(200)
    expect((await vote("socio", ["b"])).status).toBe(200) // changing your mind replaces the vote
    expect((await vote("admin", ["b"])).status).toBe(200)
    expect((await vote("socio", ["zzz"])).status).toBe(400)
    expect((await vote("socio", ["a", "b"])).status).toBe(400) // maxChoices is 1

    await call("/api/v1/stage/close", { key, method: "POST" })
    expect((await vote("socio", ["a"])).status).toBe(409)

    const results = await (await call("/api/v1/activities/dinner/results", { key })).json()
    expect(results.results).toEqual({
      question: "What for dinner?",
      totalVoters: 2,
      options: [
        { id: "a", label: "Pizza", votes: 0, percent: 0 },
        { id: "b", label: "Sushi", votes: 2, percent: 100 },
        { id: "c", label: "Kebab", votes: 0, percent: 0 },
      ],
    })
    // Results never carry who voted.
    expect(JSON.stringify(results)).not.toContain("Sara")

    await call("/api/v1/activities/dinner/reset", { key, method: "POST" })
    expect(store.getResults("dinner").results).toMatchObject({ totalVoters: 0 })

    const cleared = await (await call("/api/v1/stage/clear", { key, method: "POST" })).json()
    expect(cleared.activity).toBeNull()
  })

  it("rejects invalid configs with details", async () => {
    await call("/api/admin/activities", { as: "admin", body: { type: "poll", title: "X", slug: "x" } })
    const res = await call("/api/admin/activities/x", {
      as: "admin",
      method: "PATCH",
      body: { config: { question: "Q", options: [{ id: "a", label: "Only one" }], maxChoices: 1 } },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).details).toBeInstanceOf(Array)
  })

  it("refuses duplicate or malformed slugs", async () => {
    const create = (slug: string) =>
      call("/api/admin/activities", { as: "admin", body: { type: "poll", title: "T", slug } })
    expect((await create("dinner")).status).toBe(201)
    expect((await create("dinner")).status).toBe(409)
    expect((await create("Not A Slug")).status).toBe(400)
  })
})
