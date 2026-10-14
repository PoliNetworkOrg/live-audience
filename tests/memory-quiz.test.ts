import { describe, expect, it, vi } from "vitest"
import { isCorrect, memoryQuiz } from "../src/activities/memory-quiz/definition.ts"
import { createApp } from "../src/server/app.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"

const config = { question: "What was on the blue sign?", acceptedAnswers: ["CASSA"] }
function setup() {
  const db = openDatabase(":memory:")
  const store = new Store(db)
  const activity = store.createActivity({ type: "memory-quiz", title: "Photo quiz", slug: "photo-detail" })
  store.updateActivity(activity.id, { config })
  store.setStage(activity.id, "open")
  const app = createApp({
    store,
    session: async (c, next) => {
      const id = c.req.header("x-test-user")
      c.set("user", id ? { id, name: "Private account name", canParticipate: true, isAdmin: false } : null)
      await next()
    },
  })
  const answer = (id: string, text: string) =>
    app.request("/api/audience/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": id },
      body: JSON.stringify({ activityId: activity.id, response: { name: id, answer: text } }),
    })
  return { db, store, activity, app, answer }
}

describe("memory quiz", () => {
  it("matches a free-text answer without substring guessing and hides accepted answers", () => {
    for (const answer of ["cassa", "  CASSA  ", "ＣＡＳＳＡ", "Cassa!"])
      expect(isCorrect(config, answer)).toBe(true)
    for (const answer of ["bar", "bar cassa staff uscita", "", "casse"])
      expect(isCorrect(config, answer)).toBe(false)
    expect(memoryQuiz.audienceConfig?.(config)).toEqual({ question: config.question })
    expect(isCorrect({ ...config, acceptedAnswers: [""] }, "!!!")).toBe(false)
    expect(memoryQuiz.configSchema.safeParse({ ...config, acceptedAnswers: ["!!!"] }).success).toBe(false)
    expect(memoryQuiz.configSchema.parse({ ...config, acceptedAnswers: ["", " CASSA ", "  "] })).toEqual({
      ...config,
      acceptedAnswers: ["CASSA"],
    })
    expect(
      memoryQuiz.configSchema.parse({
        question: "Which colour?",
        answerMode: "choice",
        choices: ["Red", "", "Blue ", " "],
        acceptedAnswers: ["Blue"],
      }).choices,
    ).toEqual(["Red", "Blue"])
    expect(memoryQuiz.responseSchema(config).safeParse({ name: " ", answer: "CASSA" }).success).toBe(false)
    expect(
      memoryQuiz.responseSchema(config).safeParse({ name: "Ada", answer: "x".repeat(121) }).success,
    ).toBe(false)
  })

  it("records the first correct submission, closes the quiz and retains that winner", async () => {
    const { db, store, activity, app, answer } = setup()
    try {
      const stage = await (
        await app.request("/api/audience/stage", { headers: { "x-test-user": "Ada" } })
      ).json()
      expect(stage.activity.config).toEqual({ question: config.question })
      expect(JSON.stringify(stage)).not.toContain("CASSA")
      const wrong = await answer("Ada", "Bar")
      expect(await wrong.json()).toEqual({ response: { name: "Ada", answer: "Bar" } })
      expect(store.getStage().status).toBe("open")
      expect(store.getResults(activity.id).results.draw).toBeNull()
      expect((await answer("Sara", " cassa! ")).status).toBe(200)
      expect(store.getStage().status).toBe("closed")
      expect((await answer("Ada", "Cassa")).status).toBe(409)
      const results = store.getResults(activity.id)
      expect(results.results.draw).toMatchObject({
        answer: "CASSA",
        winner: { name: "Sara", answer: "cassa!" },
      })
      expect(JSON.stringify(results)).not.toContain("Private account name")
      expect(JSON.stringify(results)).not.toContain("userId")
      expect(new Store(db).drawActivity(activity.id)).toEqual(results)
      expect(() => store.setStageStatus("open")).toThrow("Reset this quiz")
      expect(() => store.updateActivity(activity.id, { config })).toThrow("Reset this quiz before editing")
      store.resetResponses(activity.id)
      store.setStage(activity.id, "open")
      expect((await answer("Ada", "Cassa")).status).toBe(200)
      expect(store.getResults(activity.id).results.draw.winner.name).toBe("Ada")
      store.deleteActivity(activity.id)
      expect(
        db.prepare("SELECT value FROM settings WHERE key = ?").get(`quiz-draw:${activity.id}`),
      ).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it("does not open a newly created quiz before a valid question and solution are saved", () => {
    const db = openDatabase(":memory:")
    try {
      const store = new Store(db)
      const activity = store.createActivity({ type: "memory-quiz", title: "Draft", slug: "draft" })
      expect(() => store.setStage(activity.id, "open")).toThrow("Save a valid quiz")
      expect(store.getStage().activityId).toBeNull()
      store.updateActivity(activity.id, { config })
      expect(store.setStage(activity.id, "open").status).toBe("open")
    } finally {
      db.close()
    }
  })

  it("accepts only one concurrent correct answer even when timestamps are identical", async () => {
    const { db, store, activity, answer } = setup()
    const clock = vi.spyOn(Date, "now").mockReturnValue(100)
    try {
      const responses = await Promise.all([answer("Ada", "CASSA"), answer("Sara", "CASSA")])
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
      const first = responses[0]?.status === 200 ? "Ada" : "Sara"
      expect(store.getResults(activity.id).results.draw.winner.name).toBe(first)
    } finally {
      clock.mockRestore()
      db.close()
    }
  })

  it("supports a protected manual reveal with no winner and no invented correct entrant", async () => {
    const { db, store, activity, app, answer } = setup()
    try {
      await answer("Ada", "Bar")
      const path = `/api/v1/activities/${activity.slug}/draw`
      expect((await app.request(path, { method: "POST" })).status).toBe(401)
      const headers = { Authorization: `Bearer ${store.getApiKey()}` }
      const revealed = await (await app.request(path, { method: "POST", headers })).json()
      expect(revealed.results.draw).toMatchObject({ answer: "CASSA", winner: null })
      expect(store.getStage().status).toBe("closed")
      expect(await (await app.request(path, { method: "POST", headers })).json()).toEqual(revealed)
      expect((await answer("Sara", "CASSA")).status).toBe(409)
    } finally {
      db.close()
    }
  })

  it("rolls back the winning answer, winner and closure together if persistence fails", () => {
    const { db, store, activity } = setup()
    try {
      const changed = vi.fn()
      store.events.on("results", changed)
      db.exec(
        "CREATE TRIGGER reject_stage BEFORE UPDATE ON settings WHEN NEW.key = 'stage' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
      )
      expect(() =>
        store.respond(activity.id, { id: "Ada", name: "Private" }, { name: "Ada", answer: "CASSA" }),
      ).toThrow("test failure")
      expect(store.getResponse(activity.id, "Ada")).toBeNull()
      expect(store.getResults(activity.id).results.draw).toBeNull()
      expect(store.getStage().status).toBe("open")
      expect(changed).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })
})
