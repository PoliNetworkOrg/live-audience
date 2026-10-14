import type { MiddlewareHandler } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import { wheel } from "../src/activities/wheel/definition.ts"
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

describe("a word cloud, driven by a presentation", () => {
  it("validates free answers, replaces them, publishes counts and supports close/reset", async () => {
    const created = await call("/api/admin/activities", {
      as: "admin",
      body: { type: "word-cloud", title: "Gadgets", slug: "gadget-ideas" },
    })
    expect(created.status).toBe(201)
    const { id } = await created.json()
    expect(
      (
        await call(`/api/admin/activities/${id}`, {
          as: "admin",
          method: "PATCH",
          body: { config: { prompt: "Your ideas?", maxWords: 3 } },
        })
      ).status,
    ).toBe(200)
    const key = store.getApiKey()
    const respond = (as: string, words: string[]) =>
      call("/api/audience/respond", {
        as,
        body: { activityId: id, response: { words } },
      })
    expect((await respond("socio", ["felpa"])).status).toBe(409)
    await call("/api/v1/stage", { key, body: { activity: "gadget-ideas" } })
    expect((await respond("guest", ["felpa"])).status).toBe(403)
    expect((await respond("socio", ["Felpa", " FELPA "])).status).toBe(200)
    expect((await respond("admin", ["FELPA", "sticker"])).status).toBe(200)
    expect((await respond("socio", [" "])).status).toBe(400)
    const readResults = async () =>
      (await (await call("/api/v1/activities/gadget-ideas/results", { key })).json()).results
    expect(await readResults()).toEqual({
      prompt: "Your ideas?",
      totalRespondents: 2,
      words: [
        { text: "felpa", count: 2 },
        { text: "sticker", count: 1 },
      ],
    })
    expect((await respond("socio", ["sticker"])).status).toBe(200)
    expect((await readResults()).words).toEqual([
      { text: "sticker", count: 2 },
      { text: "felpa", count: 1 },
    ])
    expect(await (await call("/api/audience/stage", { as: "socio" })).json()).toMatchObject({
      activity: { type: "word-cloud", config: { prompt: "Your ideas?" } },
      myResponse: { words: ["sticker"] },
    })
    await call("/api/v1/stage/close", { key, method: "POST" })
    expect((await respond("socio", ["felpa"])).status).toBe(409)
    const answers = async () =>
      (await (await call("/api/admin/activities", { as: "admin" })).json())[0].answers
    expect(await answers()).toBe(2)
    await call("/api/v1/activities/gadget-ideas/reset", { key, method: "POST" })
    expect(await readResults()).toEqual({ prompt: "Your ideas?", totalRespondents: 0, words: [] })
    expect(await answers()).toBe(0)
  })
})

describe("wheel entries", () => {
  it("puts each member on the wheel once, under their IdP name, and closes entries", async () => {
    const created = await call("/api/admin/activities", {
      as: "admin",
      body: { type: "wheel", title: "Draw", slug: "fortune-wheel" },
    })
    expect(created.status).toBe(201)
    const { id } = await created.json()
    const key = store.getApiKey()
    const join = (as: string, response: unknown = {}) =>
      call("/api/audience/respond", { as, body: { activityId: id, response } })
    expect((await join("socio")).status).toBe(409)
    await call("/api/v1/stage", { key, body: { activity: "fortune-wheel" } })
    expect((await join("guest")).status).toBe(403)
    expect((await join("socio", { name: "Typed name" })).status).toBe(200) // the typed name is ignored
    expect((await join("socio")).status).toBe(200) // joining twice is still one entry
    expect((await join("admin")).status).toBe(200)
    const results = await (await call("/api/v1/activities/fortune-wheel/results", { key })).json()
    expect(results.results).toEqual({
      prompt: "Join the wheel for a chance to win",
      totalParticipants: 2,
      names: expect.arrayContaining(["Sara", "Ada"]),
    })
    expect(JSON.stringify(results)).not.toContain("Typed name")
    expect(JSON.stringify(results)).not.toContain("userId")
    await call("/api/v1/stage/close", { key, method: "POST" })
    expect((await join("socio")).status).toBe(409)
    expect(await (await call("/api/audience/stage", { as: "socio" })).json()).toMatchObject({
      status: "closed",
      myResponse: {},
    })
    await call("/api/v1/activities/fortune-wheel/reset", { key, method: "POST" })
    expect(store.getResults(id).results).toMatchObject({ totalParticipants: 0, names: [] })
  })

  it("keeps people with the same name as separate entries", () => {
    const entry = (userId: string) => ({ userId, userName: "Same name", response: {}, updatedAt: 0 })
    expect(wheel.aggregate({ prompt: "Join" }, [entry("one"), entry("two")]).names).toEqual([
      "Same name",
      "Same name",
    ])
  })
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

  it("drops poll options left blank", async () => {
    await call("/api/admin/activities", { as: "admin", body: { type: "poll", title: "X", slug: "x" } })
    const res = await call("/api/admin/activities/x", {
      as: "admin",
      method: "PATCH",
      body: {
        config: {
          question: "Q",
          options: [
            { id: "a", label: "Yes" },
            { id: "b", label: "  " },
            { id: "c", label: " No " },
          ],
          maxChoices: 1,
        },
      },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).config.options).toEqual([
      { id: "a", label: "Yes" },
      { id: "c", label: "No" },
    ])
  })

  it("changes the type of an activity without answers, off stage", async () => {
    const { id } = await createPoll()
    const key = store.getApiKey()
    const patch = (body: unknown) =>
      call(`/api/admin/activities/${id}`, { as: "admin", method: "PATCH", body })

    expect((await patch({ type: "nope" })).status).toBe(400)
    expect((await patch({ type: "word-cloud", config: { question: "Q" } })).status).toBe(400)

    await call("/api/v1/stage", { key, body: { activity: "dinner" } })
    expect((await patch({ type: "wheel" })).status).toBe(409) // on stage
    await call("/api/audience/respond", {
      as: "socio",
      body: { activityId: id, response: { choices: ["a"] } },
    })
    await call("/api/v1/stage/clear", { key, method: "POST" })
    expect((await patch({ type: "wheel" })).status).toBe(409) // has answers
    expect(store.getActivity(id)).toMatchObject({ type: "poll" })

    await call("/api/v1/activities/dinner/reset", { key, method: "POST" })
    const changed = await patch({ type: "word-cloud", config: { prompt: "Ideas?", maxWords: 2 } })
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({
      type: "word-cloud",
      config: { prompt: "Ideas?", maxWords: 2 },
    })
    expect(store.getResults("dinner")).toMatchObject({ type: "word-cloud", results: { words: [] } })

    // Without a config the new type starts from its default one.
    expect(await (await patch({ type: "wheel" })).json()).toMatchObject({
      type: "wheel",
      config: wheel.defaultConfig(),
    })
  })

  it("refuses duplicate or malformed slugs", async () => {
    const create = (slug: string) =>
      call("/api/admin/activities", { as: "admin", body: { type: "poll", title: "T", slug } })
    expect((await create("dinner")).status).toBe(201)
    expect((await create("dinner")).status).toBe(409)
    expect((await create("Not A Slug")).status).toBe(400)
  })
})
