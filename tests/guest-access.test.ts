import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import { createApp } from "../src/server/app.ts"
import { createAuth } from "../src/server/auth.ts"
import { openDatabase } from "../src/server/db.ts"
import type { Env } from "../src/server/env.ts"
import { Store } from "../src/server/store.ts"

const env: Env = {
  NODE_ENV: "test",
  PORT: 0,
  PUBLIC_URL: "http://localhost:5173",
  DATABASE_PATH: ":memory:",
  AUDIENCE_ROLE: "socio",
  ADMIN_PERMISSION: "live-audience:admin",
  SESSION_DAYS: 1,
  // Signs in "with an account" without an IdP.
  DEV_LOGIN: true,
}

let store: Store
let server: Hono

beforeEach(() => {
  const db = openDatabase(":memory:")
  store = new Store(db)
  const auth = createAuth(env, db, { guestAccessOpen: () => store.guestAccessOpen() })
  server = new Hono()
  server.route("/auth", auth.routes)
  server.route("/", createApp({ store, session: auth.session }))
})

/** A phone: keeps the session cookie between requests. */
function phone() {
  let cookie = ""
  return async (path: string, body?: unknown) => {
    const res = await server.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.get("set-cookie")
    if (set) cookie = set.split(";")[0] as string
    return res
  }
}

describe("joining without signing in", () => {
  it("lets guests in by name only while the running presentation allows it", async () => {
    const talk = store.createPresentation({ title: "Welcome", slug: "welcome" })
    const wheel = store.createActivity({
      type: "wheel",
      title: "Wheel",
      slug: "wheel",
      presentationId: talk.id,
    })
    const soci = store.createActivity({ type: "wheel", title: "Soci", slug: "soci", membersOnly: true })
    const nico = phone()

    // Off by default: the sign-in is the only way in.
    expect(await (await nico("/api/me")).json()).toEqual({ user: null, guestAccess: false, playing: false })
    expect((await nico("/auth/guest", { name: "Nico" })).status).toBe(403)

    // On, but the presentation is not running yet.
    store.updatePresentation(talk.id, { guestAccess: true })
    expect((await nico("/auth/guest", { name: "Nico" })).status).toBe(403)

    store.setStage(wheel.id, "open")
    expect((await nico("/auth/guest", { name: "   " })).status).toBe(400)
    // A form posted from another site cannot create (and swap in) a guest session.
    const form = await server.request("/auth/guest", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: "Mallory" }),
    })
    expect(form.status).toBe(415)
    expect(form.headers.get("set-cookie")).toBeNull()
    const joined = await nico("/auth/guest", { name: "  Nico   Newcomer " })
    expect(joined.status).toBe(200)
    const me = (await (await nico("/api/me")).json()) as {
      user: { id: string; name: string; guest: boolean }
    }
    expect(me).toMatchObject({
      user: { name: "Nico Newcomer", guest: true, isAdmin: false },
      guestAccess: true,
      playing: true,
    })
    expect(me.user.id).toMatch(/^guest-/)

    expect((await nico("/api/audience/respond", { activityId: wheel.id, response: {} })).status).toBe(200)
    // Soci-only activities still need a PoliNetwork account.
    store.setStage(soci.id, "open")
    expect((await nico("/api/audience/respond", { activityId: soci.id, response: {} })).status).toBe(403)
    // Guests never reach the admin.
    expect((await nico("/api/admin/presentations")).status).toBe(403)

    // Switched off: the guest is signed out, and comes back with the same name if it reopens.
    store.updatePresentation(talk.id, { guestAccess: false })
    expect(await (await nico("/api/me")).json()).toEqual({ user: null, guestAccess: false, playing: false })
    expect((await nico("/api/audience/stage")).status).toBe(401)
    store.updatePresentation(talk.id, { guestAccess: true })
    expect(await (await nico("/api/me")).json()).toMatchObject({ user: { name: "Nico Newcomer" } })

    // Ending the presentation ends guest access too.
    store.setStagePresentation(null)
    expect(await (await nico("/api/me")).json()).toEqual({ user: null, guestAccess: false, playing: false })
  })

  it("lets only guests play while it is on, and only accounts while it is off", async () => {
    const talk = store.createPresentation({ title: "Welcome", slug: "welcome", guestAccess: true })
    const wheel = store.createActivity({
      type: "wheel",
      title: "Wheel",
      slug: "wheel",
      presentationId: talk.id,
    })
    store.setStage(wheel.id, "open")
    const sara = phone()
    await sara("/auth/dev-login?as=socio")
    const nico = phone()
    await nico("/auth/guest", { name: "Nico" })

    // Signed in with an account: still signed in (for the admin), but not playing.
    expect(await (await sara("/api/me")).json()).toMatchObject({
      user: { name: "Sara Socia" },
      guestAccess: true,
      playing: false,
    })
    expect((await sara("/api/audience/stage")).status).toBe(403)
    expect((await sara("/api/audience/respond", { activityId: wheel.id, response: {} })).status).toBe(403)
    expect((await nico("/api/audience/respond", { activityId: wheel.id, response: {} })).status).toBe(200)

    store.updatePresentation(talk.id, { guestAccess: false })
    expect((await sara("/api/audience/respond", { activityId: wheel.id, response: {} })).status).toBe(200)
    expect((await nico("/api/audience/respond", { activityId: wheel.id, response: {} })).status).toBe(401)
  })

  it("is saved with the presentation and listed by the API", async () => {
    const talk = store.createPresentation({ title: "Welcome", slug: "welcome" })
    expect(store.getPresentation(talk.id)?.guestAccess).toBe(false)
    store.updatePresentation(talk.id, { guestAccess: true })
    expect(store.getPresentation("welcome")?.guestAccess).toBe(true)
    const res = await server.request("/api/v1/presentations", {
      headers: { authorization: `Bearer ${store.getApiKey()}` },
    })
    expect(await res.json()).toEqual([{ id: talk.id, slug: "welcome", title: "Welcome", guestAccess: true }])
  })
})
