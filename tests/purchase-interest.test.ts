import { describe, expect, it } from "vitest"
import { type PurchaseResponse, purchaseInterest } from "../src/activities/purchase-interest/definition.ts"
import { createApp } from "../src/server/app.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"

const config = purchaseInterest.defaultConfig()
const stored = (response: PurchaseResponse, index: number) => ({
  userId: String(index),
  userName: "Private name",
  response,
  updatedAt: 0,
})

describe("purchase interest", () => {
  it("requires a whole euro price only for yes, and discards a price for no", () => {
    const schema = purchaseInterest.responseSchema(config)
    expect(schema.parse({ buy: false, price: 50 })).toEqual({ buy: false })
    expect(schema.parse({ buy: true, price: 0 })).toEqual({ buy: true, price: 0 })
    for (const response of [
      { buy: true },
      { buy: true, price: "20" },
      { buy: true, price: -1 },
      { buy: true, price: 10.5 },
      { buy: true, price: Infinity },
      { buy: "yes", price: 20 },
    ]) {
      expect(schema.safeParse(response).success).toBe(false)
    }
  })

  it("groups boundary prices into ordered ten-euro bands and all no answers together", () => {
    const responses: PurchaseResponse[] = [
      { buy: false },
      { buy: false },
      ...[0, 10, 11, 20, 21, 30, 31].map((price): PurchaseResponse => ({ buy: true, price })),
    ]
    const results = purchaseInterest.aggregate(config, responses.map(stored))
    expect(results).toEqual({
      question: config.question,
      totalRespondents: 9,
      yes: 7,
      no: 2,
      noPercent: 22.2,
      bands: [
        { min: 0, max: 10, label: "0–10 €", count: 2, percent: 22.2 },
        { min: 11, max: 20, label: "11–20 €", count: 2, percent: 22.2 },
        { min: 21, max: 30, label: "21–30 €", count: 2, percent: 22.2 },
        { min: 31, max: 40, label: "31–40 €", count: 1, percent: 11.1 },
      ],
    })
    expect(JSON.stringify(results)).not.toContain("Private name")
    expect(purchaseInterest.aggregate(config, [])).toMatchObject({
      totalRespondents: 0,
      yes: 0,
      no: 0,
      noPercent: 0,
      bands: [],
    })
    const highPrice = purchaseInterest.aggregate(config, [stored({ buy: true, price: 1_000_000 }, 0)])
    expect(highPrice.bands).toHaveLength(1)
    expect(highPrice.bands[0]?.label).toBe("999991–1000000 €")
  })

  it("replaces yes/no choices, publishes results through the API and respects closure", async () => {
    const db = openDatabase(":memory:")
    try {
      const store = new Store(db)
      const activity = store.createActivity({
        type: "purchase-interest",
        slug: "merch-price",
        title: "Merch",
      })
      store.setStage(activity.id, "open")
      const user = { id: "one", name: "Private name" }
      const app = createApp({
        store,
        session: async (c, next) => {
          c.set("user", { ...user, isAdmin: false, canParticipate: true })
          await next()
        },
      })
      const respond = (response: unknown) =>
        app.request("/api/audience/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activityId: activity.id, response }),
        })
      expect((await respond({ buy: true })).status).toBe(400)
      expect((await respond({ buy: true, price: 20 })).status).toBe(200)
      expect(store.getResults(activity.id).results).toMatchObject({
        totalRespondents: 1,
        yes: 1,
        bands: [{ label: "11–20 €", count: 1 }],
      })
      expect((await (await respond({ buy: false, price: 20 })).json()).response).toEqual({ buy: false })
      const key = store.getApiKey()
      const results = await (
        await app.request("/api/v1/activities/merch-price/results", {
          headers: { Authorization: `Bearer ${key}` },
        })
      ).json()
      expect(results.results).toMatchObject({ totalRespondents: 1, yes: 0, no: 1, bands: [] })
      expect(JSON.stringify(results)).not.toContain("Private name")
      expect((await respond({ buy: true, price: 30 })).status).toBe(200)
      store.setStageStatus("closed")
      expect((await respond({ buy: false })).status).toBe(409)
      expect(store.getResponse(activity.id, user.id)).toEqual({ buy: true, price: 30 })
      store.resetResponses(activity.id)
      expect(store.getResults(activity.id).results).toMatchObject({ totalRespondents: 0, bands: [] })
    } finally {
      db.close()
    }
  })
})
