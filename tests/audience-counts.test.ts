import { describe, expect, it } from "vitest"
import { createApp } from "../src/server/app.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"

describe("audience counts", () => {
  it("count people with the audience page open once, and the answers to what is on stage", async () => {
    const store = new Store(openDatabase(":memory:"))
    const app = createApp({ store, session: async (_, next) => next() })
    const key = store.getApiKey()
    const counts = async () =>
      (await app.request("/api/v1/audience", { headers: { authorization: `Bearer ${key}` } })).json()
    const presence: number[] = []
    store.events.on("presence", () => presence.push(store.getAudienceCounts().connected))

    expect(await counts()).toEqual({ connected: 0, answered: 0, activity: null })
    const leaveSara = store.join("sara")
    const leaveSaraTab = store.join("sara") // a second tab of the same person
    const leaveNico = store.join("nico")
    expect((await counts()).connected).toBe(2)
    leaveSaraTab()
    leaveSaraTab() // leaving twice changes nothing
    expect((await counts()).connected).toBe(2)
    leaveSara()
    expect((await counts()).connected).toBe(1)
    expect(presence).toEqual([1, 1, 2, 2, 1])

    const wheel = store.createActivity({ type: "wheel", title: "Wheel", slug: "wheel" })
    store.setStage(wheel.id, "open")
    store.respond(wheel.id, { id: "nico", name: "Nico" }, {})
    expect(await counts()).toEqual({ connected: 1, answered: 1, activity: "wheel" })
    store.clearStage()
    expect(await counts()).toEqual({ connected: 1, answered: 0, activity: null })
    leaveNico()
    expect((await counts()).connected).toBe(0)
  })
})
