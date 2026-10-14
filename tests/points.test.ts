import { afterEach, describe, expect, it, vi } from "vitest"
import { scorePoints } from "../src/activities/scoring.ts"
import { createApp } from "../src/server/app.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"

const quiz = { question: "Colour of the sign?", scoring: "points", acceptedAnswers: ["Blue"] }

let now = 1_000_000
vi.spyOn(Date, "now").mockImplementation(() => now)
afterEach(() => {
  now = 1_000_000
})
const later = (ms: number) => {
  now += ms
}

function setup() {
  const store = new Store(openDatabase(":memory:"))
  const person = (id: string) => ({ id, name: `Name ${id}` })
  return { store, person }
}

describe("points", () => {
  it("weigh accuracy, and lose up to half over the first 30 seconds", () => {
    expect(scorePoints(1, 0)).toBe(1000)
    expect(scorePoints(1, 15_000)).toBe(750)
    expect(scorePoints(1, 30_000)).toBe(500)
    expect(scorePoints(1, 90_000)).toBe(500)
    expect(scorePoints(0.5, 0)).toBe(500)
    expect(scorePoints(0, 0)).toBe(0)
    expect(scorePoints(2, -5)).toBe(1000)
  })

  it("let every correct quiz answer score by speed, revealed only by the draw", () => {
    const { store, person } = setup()
    const activity = store.createActivity({ type: "memory-quiz", title: "Quiz", slug: "quiz" })
    store.updateActivity(activity.id, { config: quiz })
    store.setStage(activity.id, "open")
    later(3_000)
    store.respond(activity.id, person("wrong"), { answer: "Red" })
    later(3_000)
    store.respond(activity.id, person("fast"), { answer: "blue" })
    later(9_000)
    store.respond(activity.id, person("slow"), { answer: "BLUE!" })
    // A correct answer does not end a points quiz, and nobody learns anything before the reveal.
    expect(store.getStage().status).toBe("open")
    expect(store.getResults(activity.id).results.draw).toBeNull()
    expect(store.getAudienceOutcome(activity.id, "fast")).toBeNull()

    const { results } = store.drawActivity(activity.id)
    expect(results.draw).toMatchObject({ answer: "Blue", correct: 2, winner: { name: "Name fast" } })
    expect(JSON.stringify(results)).not.toContain("winnerUserId")
    expect(store.getStage().status).toBe("closed")
    expect(store.getAudienceOutcome(activity.id, "fast")).toMatchObject({ youWon: true, points: 900 })
    expect(store.getAudienceOutcome(activity.id, "slow")).toMatchObject({ youWon: false, points: 750 })
    expect(store.getAudienceOutcome(activity.id, "wrong")).toMatchObject({ youWon: false, points: 0 })
    expect(store.getAudienceOutcome(activity.id, "absent")).toMatchObject({ youWon: false, points: null })
  })

  it("add up per presentation, with ranks, top 3 and each person's place", () => {
    const { store, person } = setup()
    const talk = store.createPresentation({ title: "Welcome talk", slug: "welcome" })
    const estimate = store.createActivity({
      type: "number-estimate",
      title: "Lanyards",
      slug: "lanyards",
      presentationId: talk.id,
    })
    store.updateActivity(estimate.id, { config: { prompt: "How many?", target: 100 } })
    const outside = store.createActivity({ type: "number-estimate", title: "Other", slug: "other" })
    store.updateActivity(outside.id, { config: { prompt: "How many?", target: 100 } })

    store.setStage(estimate.id, "open")
    expect(store.getStage().presentationId).toBe(talk.id)
    for (const [id, guess] of [
      ["a", 100],
      ["b", 50],
      ["c", 50],
      ["d", 0],
      ["e", 300],
    ] as const)
      store.respond(estimate.id, person(id), { number: guess })
    store.drawActivity(estimate.id)
    store.clearStage()
    // The presentation stays current between activities, so phones keep its leaderboard.
    expect(store.getStage().presentationId).toBe(talk.id)

    // Points outside the presentation do not count towards it.
    store.setStage(outside.id, "open")
    expect(store.getStage().presentationId).toBe(talk.id)
    store.respond(outside.id, person("e"), { number: 100 })
    store.drawActivity(outside.id)

    expect(store.getLeaderboard("welcome").leaderboard).toEqual([
      { rank: 1, name: "Name a", points: 1000 },
      { rank: 2, name: "Name b", points: 500 },
      { rank: 2, name: "Name c", points: 500 },
      { rank: 4, name: "Name d", points: 0 },
      { rank: 4, name: "Name e", points: 0 },
    ])
    expect(store.getAudienceLeaderboard("d")).toEqual({
      title: "Welcome talk",
      top: [
        { rank: 1, name: "Name a", points: 1000 },
        { rank: 2, name: "Name b", points: 500 },
        { rank: 2, name: "Name c", points: 500 },
      ],
      me: { rank: 4, points: 0 },
      players: 5,
    })
    expect(store.getAudienceLeaderboard("nobody")?.me).toBeNull()

    // Moving the activity out takes its points along; resetting answers deletes them.
    store.updateActivity(outside.id, { presentationId: talk.id })
    expect(store.getLeaderboard("welcome").leaderboard.slice(0, 2)).toEqual([
      { rank: 1, name: "Name a", points: 1000 },
      { rank: 1, name: "Name e", points: 1000 },
    ])
    store.resetPresentation(talk.id)
    expect(store.getLeaderboard("welcome").leaderboard).toEqual([])

    store.setStagePresentation(null)
    expect(store.getAudienceLeaderboard("a")).toBeNull()
    store.setStagePresentation("welcome")
    store.deletePresentation(talk.id)
    expect(store.getStage().presentationId).toBeNull()
    expect(store.getActivity(estimate.id)?.presentationId).toBeNull()
  })

  it("are served to presentations and phones without account ids", async () => {
    const { store, person } = setup()
    const talk = store.createPresentation({ title: "Talk", slug: "talk" })
    const lottery = store.createActivity({
      type: "number-lottery",
      title: "Lottery",
      slug: "lottery",
      presentationId: talk.id,
    })
    store.setStage(lottery.id, "open")
    store.respond(lottery.id, person("private-id"), { number: 50 })
    store.drawActivity(lottery.id)
    const app = createApp({
      store,
      session: async (c, next) => {
        c.set("user", { id: "private-id", name: "Name private-id", canParticipate: true, isAdmin: false })
        await next()
      },
    })
    const headers = { Authorization: `Bearer ${store.getApiKey()}` }
    const board = await (await app.request("/api/v1/presentations/talk/leaderboard", { headers })).json()
    expect(board).toMatchObject({ slug: "talk", leaderboard: [{ rank: 1, name: "Name private-id" }] })
    expect(JSON.stringify(board)).not.toContain('"private-id"')
    const stage = await (await app.request("/api/v1/stage", { headers })).json()
    expect(stage.presentation).toEqual({ id: talk.id, slug: "talk", title: "Talk" })
    const phone = await (await app.request("/api/audience/stage")).json()
    expect(phone.leaderboard).toMatchObject({ title: "Talk", me: { rank: 1 }, players: 1 })
    expect(phone.outcome.points).toBe(phone.leaderboard.top[0].points)
  })
})
