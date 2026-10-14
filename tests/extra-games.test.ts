import { describe, expect, it } from "vitest"
import { memoryQuiz } from "../src/activities/memory-quiz/definition.ts"
import { numberEstimate } from "../src/activities/number-estimate/definition.ts"
import { createApp } from "../src/server/app.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"

describe("structured prize quizzes", () => {
  it("validates choices and permutations without revealing their correct answer", () => {
    const choice = memoryQuiz.configSchema.parse({
      question: "Vero?",
      answerMode: "choice",
      choices: ["Vero", "Falso"],
      acceptedAnswers: ["Falso"],
    })
    expect(memoryQuiz.audienceConfig?.(choice)).toEqual({
      question: "Vero?",
      scoring: "first",
      answerMode: "choice",
      choices: ["Vero", "Falso"],
    })
    expect(memoryQuiz.responseSchema(choice).safeParse({ answer: "Vero" }).success).toBe(true)
    expect(memoryQuiz.responseSchema(choice).safeParse({ answer: "Vero Falso" }).success).toBe(false)
    const order = memoryQuiz.configSchema.parse({
      question: "Order?",
      answerMode: "order",
      choices: ["C", "A", "B"],
      acceptedAnswers: ["A → B → C"],
    })
    for (const answer of ["A → B → C", "C → A → B"])
      expect(memoryQuiz.responseSchema(order).safeParse({ answer }).success).toBe(true)
    for (const answer of ["A → A → C", "A → B", "A → B → X"])
      expect(memoryQuiz.responseSchema(order).safeParse({ answer }).success).toBe(false)
    for (const patch of [{ choices: ["A", "a"] }, { acceptedAnswers: ["A → B"] }, { choices: undefined }])
      expect(memoryQuiz.configSchema.safeParse({ ...order, ...patch }).success).toBe(false)
    expect(memoryQuiz.audienceConfig?.({ question: "Text?", acceptedAnswers: ["yes"] })).toEqual({
      question: "Text?",
      scoring: "first",
    })
  })

  it("supports events and hackathons in one five-item chronological quiz", () => {
    const choices = ["FastwebAI Hackathon", "Welcome kit", "GDG AI Hack", "Zurich Hackathon", "ApeMatricole"]
    const answer = "GDG AI Hack → ApeMatricole → Zurich Hackathon → Welcome kit → FastwebAI Hackathon"
    const config = memoryQuiz.configSchema.parse({
      question: "Ordina gli eventi del 2026",
      answerMode: "order",
      choices,
      acceptedAnswers: [answer],
    })
    expect(memoryQuiz.responseSchema(config).safeParse({ answer }).success).toBe(true)
    expect(
      memoryQuiz
        .responseSchema(config)
        .safeParse({ answer: "GDG AI Hack → Zurich Hackathon → FastwebAI Hackathon" }).success,
    ).toBe(false)
    expect(
      memoryQuiz.responseSchema(config).safeParse({ answer: answer.replace("ApeMatricole", "Welcome kit") })
        .success,
    ).toBe(false)
    expect(
      memoryQuiz.configSchema.safeParse({ ...config, answerMode: "choice", acceptedAnswers: ["Welcome kit"] })
        .success,
    ).toBe(false)
    const db = openDatabase(":memory:")
    const store = new Store(db)
    try {
      const activity = store.createActivity({
        type: "memory-quiz",
        title: "Eventi 2026",
        slug: "events-order",
      })
      store.updateActivity(activity.id, { config })
      store.setStage(activity.id, "open")
      store.respond(activity.id, { id: "ada", name: "Ada" }, { answer })
      expect(store.getStage().status).toBe("closed")
      expect(store.getResults(activity.id).results.draw.winner).toEqual({ name: "Ada", answer })
    } finally {
      db.close()
    }
  })

  it("awards the first correctly ordered answer and rejects later winners", () => {
    const db = openDatabase(":memory:")
    const store = new Store(db)
    try {
      const activity = store.createActivity({ type: "memory-quiz", title: "Order", slug: "order" })
      store.updateActivity(activity.id, {
        config: {
          question: "Order",
          answerMode: "order",
          choices: ["C", "B", "A"],
          acceptedAnswers: ["A → B → C"],
        },
      })
      store.setStage(activity.id, "open")
      const user = { id: "private-account", name: "Ada" }
      store.respond(activity.id, user, { answer: "C → B → A" })
      expect(store.getStage().status).toBe("open")
      store.respond(activity.id, user, { answer: "A → B → C" })
      expect(store.getStage().status).toBe("closed")
      expect(store.getResults(activity.id).results.draw.winner.name).toBe("Ada")
      expect(() =>
        store.respond(activity.id, { id: "later", name: "Later" }, { answer: "A → B → C" }),
      ).toThrow()
    } finally {
      db.close()
    }
  })
})

describe("guess a real number", () => {
  it("keeps the target private, validates guesses and persists one nearest winner across API retries", async () => {
    const db = openDatabase(":memory:")
    const store = new Store(db)
    try {
      const activity = store.createActivity({
        type: "number-estimate",
        title: "Lanyard",
        slug: "lanyard-count",
      })
      const config = { prompt: "How many?", target: 50 }
      store.updateActivity(activity.id, { config })
      expect(numberEstimate.audienceConfig?.(config)).toEqual({ prompt: config.prompt })
      for (const number of [-1, 1.5, 1_000_001, Infinity, "50"])
        expect(numberEstimate.responseSchema(config).safeParse({ number }).success).toBe(false)
      store.setStage(activity.id, "open")
      for (const [index, number] of [48, 52, 80].entries())
        store.respond(activity.id, { id: `private-${index}`, name: `Guest ${index}` }, { number })
      expect(() => store.updateActivity(activity.id, { config: { ...config, target: 80 } })).toThrow("Reset")
      expect(JSON.stringify(store.getResults(activity.id))).not.toContain("Guest")
      expect(JSON.stringify(store.getResults(activity.id))).not.toContain('"target"')
      const app = createApp({
        store,
        session: async (c, next) => {
          c.set("user", null)
          await next()
        },
      })
      const headers = { Authorization: `Bearer ${store.getApiKey()}` }
      const draw = await (
        await app.request("/api/v1/activities/lanyard-count/draw", { method: "POST", headers })
      ).json()
      expect(draw.results.draw).toMatchObject({ number: 50, distance: 2, tied: 2 })
      expect([48, 52]).toContain(draw.results.draw.winner.number)
      expect(JSON.stringify(draw)).not.toContain("private-")
      // The winner is announced under the name from their account.
      const winnerIndex = [48, 52].indexOf(draw.results.draw.winner.number)
      expect(draw.results.draw.winner.name).toBe(`Guest ${winnerIndex}`)
      expect(JSON.stringify(draw)).not.toContain("winnerUserId")
      expect(store.getAudienceOutcome(activity.id, `private-${winnerIndex}`)?.youWon).toBe(true)
      expect(store.getAudienceOutcome(activity.id, `private-${1 - winnerIndex}`)?.youWon).toBe(false)
      expect(draw.results.entries).toBeUndefined()
      expect(store.getStage().status).toBe("closed")
      expect(store.drawActivity(activity.id)).toEqual(draw)
      expect(new Store(db).getResults(activity.id)).toEqual(draw)
      expect(() => store.setStage(activity.id, "open")).toThrow("Reset")
      store.resetResponses(activity.id)
      store.updateActivity(activity.id, { config })
      store.setStage(activity.id, "open")
      const empty = store.drawActivity(activity.id).results.draw
      expect(empty).toMatchObject({ number: 50, winner: null, tied: 0, distance: null })
      store.deleteActivity(activity.id)
      expect(store.getSetting(`number-draw:${activity.id}`)).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
