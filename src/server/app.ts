import { timingSafeEqual } from "node:crypto"
import { Hono, type MiddlewareHandler } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { activityDefinitions } from "../activities/registry.ts"
import type { AuthVariables, SessionUser } from "./auth.ts"
import { sse, throttleByKey } from "./sse.ts"
import { type Stage, type Store, StoreError } from "./store.ts"

type AppEnv = { Variables: AuthVariables }

const stageBody = z.object({
  activity: z.string().min(1),
  status: z.enum(["open", "closed"]).default("open"),
})
const stagePresentationBody = z.object({ presentation: z.string().min(1).nullable() })
const createActivityBody = z.object({
  type: z.string(),
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80),
  presentationId: z.string().nullable().optional(),
  membersOnly: z.boolean().optional(),
  countsToLeaderboard: z.boolean().optional(),
})
const updateActivityBody = z.object({
  type: z.string().optional(),
  presentationId: z.string().nullable().optional(),
  membersOnly: z.boolean().optional(),
  countsToLeaderboard: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(80).optional(),
  config: z.unknown().optional(),
})
const presentationBody = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(80),
  guestAccess: z.boolean().optional(),
})
const respondBody = z.object({ activityId: z.string(), response: z.unknown() })

async function parseBody<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
  const body = await c.req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new StoreError(400, "Invalid request body", parsed.error.issues)
  return parsed.data
}

export function createApp({ store, session }: { store: Store; session: MiddlewareHandler<AppEnv> }) {
  const app = new Hono<AppEnv>()

  app.onError((error, c) => {
    if (error instanceof StoreError)
      return c.json({ error: error.message, details: error.details }, error.status)
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
    console.error(error)
    return c.json({ error: "Internal error" }, 500)
  })

  app.get("/healthz", (c) => c.text("ok"))

  // ---- guards ----------------------------------------------------------------------------

  const requireUser =
    (check: (user: SessionUser) => boolean): MiddlewareHandler<AppEnv> =>
    async (c, next) => {
      const user = c.get("user")
      if (!user) throw new HTTPException(401, { message: "Sign in first" })
      if (!check(user)) throw new HTTPException(403, { message: "You do not have access" })
      await next()
    }

  const requireApiKey: MiddlewareHandler = async (c, next) => {
    // EventSource cannot send headers, so the key is also accepted as ?key=
    const header = c.req.header("authorization")
    const provided = header?.startsWith("Bearer ") ? header.slice(7) : c.req.query("key")
    const expected = Buffer.from(store.getApiKey())
    if (
      !provided ||
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), expected)
    ) {
      throw new HTTPException(401, { message: "Missing or wrong API key" })
    }
    await next()
  }

  // ---- stage control: the same routes for the admin page and for presentations ------------

  const control = new Hono()
    .get("/stage", (c) => c.json(describeStage(store, store.getStage())))
    /** Put an activity on stage. `status` defaults to "open". */
    .post("/stage", async (c) => {
      const body = await parseBody(c, stageBody)
      return c.json(describeStage(store, store.setStage(body.activity, body.status)))
    })
    .post("/stage/open", (c) => c.json(describeStage(store, store.setStageStatus("open"))))
    .post("/stage/close", (c) => c.json(describeStage(store, store.setStageStatus("closed"))))
    .post("/stage/clear", (c) => c.json(describeStage(store, store.clearStage())))
    /** Starts a presentation (`{ presentation: "<slug>" }`) or ends it (`{ presentation: null }`). */
    .post("/stage/presentation", async (c) => {
      const body = await parseBody(c, stagePresentationBody)
      return c.json(describeStage(store, store.setStagePresentation(body.presentation)))
    })
    .get("/activities", (c) => {
      const answers = store.answerCounts()
      return c.json(
        store
          .listActivities()
          .map(({ id, slug, type, title, config, presentationId, membersOnly, countsToLeaderboard }) => ({
            id,
            slug,
            type,
            title,
            config,
            membersOnly,
            countsToLeaderboard,
            presentation: presentationId ? (store.getPresentation(presentationId)?.slug ?? null) : null,
            answers: answers.get(id) ?? 0,
          })),
      )
    })
    .get("/presentations", (c) =>
      c.json(
        store
          .listPresentations()
          .map(({ id, slug, title, guestAccess }) => ({ id, slug, title, guestAccess })),
      ),
    )
    /** How many people have the audience page open, and how many answered what is on stage. */
    .get("/audience", (c) => c.json(store.getAudienceCounts()))
    .get("/presentations/:id/leaderboard", (c) => c.json(store.getLeaderboard(c.req.param("id"))))
    .get("/activities/:id/results", (c) => c.json(store.getResults(c.req.param("id"))))
    .post("/activities/:id/draw", (c) => c.json(store.drawActivity(c.req.param("id"))))
    .post("/activities/:id/reset", (c) => {
      store.resetResponses(c.req.param("id"))
      return c.json(store.getResults(c.req.param("id")))
    })
    /**
     * Live feed: `stage` whenever the stage changes, `results` whenever an activity's results
     * change (at most a few times per second). Pass ?activity=<slug> to receive results for
     * that activity only; otherwise you get results for whatever is on stage. `leaderboard`
     * follows the current presentation's points. `audience` counts who has the audience page
     * open and who answered what is on stage.
     */
    .get("/events", (c) => {
      const only = c.req.query("activity")
      const onlyId = only ? store.requireActivity(only).id : undefined
      return sse(c, (send) => {
        const results = throttleByKey(250, (id) => {
          if (store.getActivity(id)) send("results", store.getResults(id))
        })
        const leaderboard = throttleByKey(250, (id) => {
          if (store.getPresentation(id)) send("leaderboard", store.getLeaderboard(id))
        })
        const audience = throttleByKey(250, () => send("audience", store.getAudienceCounts()))
        const onPresence = () => audience.call("")
        let presentationId = store.getStage().presentationId
        const onStage = (stage: Stage) => {
          send("stage", describeStage(store, stage))
          audience.call("")
          if (!onlyId && stage.activityId) results.call(stage.activityId)
          if (stage.presentationId && stage.presentationId !== presentationId)
            leaderboard.call(stage.presentationId)
          presentationId = stage.presentationId
        }
        const onLeaderboard = (id: string) => {
          if (id === store.getStage().presentationId) leaderboard.call(id)
        }
        const onResults = (id: string) => {
          if (onlyId ? id === onlyId : id === store.getStage().activityId) results.call(id)
          if (id === store.getStage().activityId) audience.call("")
        }
        const stage = store.getStage()
        send("stage", describeStage(store, stage))
        const initial = onlyId ?? stage.activityId
        if (initial) send("results", store.getResults(initial))
        if (stage.presentationId) send("leaderboard", store.getLeaderboard(stage.presentationId))
        send("audience", store.getAudienceCounts())
        store.events.on("stage", onStage)
        store.events.on("results", onResults)
        store.events.on("leaderboard", onLeaderboard)
        store.events.on("presence", onPresence)
        return () => {
          results.cancel()
          leaderboard.cancel()
          audience.cancel()
          store.events.off("stage", onStage)
          store.events.off("results", onResults)
          store.events.off("leaderboard", onLeaderboard)
          store.events.off("presence", onPresence)
        }
      })
    })

  // ---- public API for presentations (API key) -------------------------------------------

  app.use("/api/v1/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"] }))
  app.use("/api/v1/*", requireApiKey)
  app.route("/api/v1", control)

  // ---- signed-in routes -------------------------------------------------------------------

  app.use("/api/*", session)
  // Guests only count as signed in while the running presentation lets them in.
  app.use("/api/*", async (c, next) => {
    if (c.get("user")?.guest && !store.guestAccessOpen()) c.set("user", null)
    await next()
  })

  /** `guestAccess`: whether people may join the running presentation with just a name. */
  app.get("/api/me", (c) => c.json({ user: c.get("user"), guestAccess: store.guestAccessOpen() }))

  // Anyone with a PoliNetwork account may play, and activities marked members only take Soci
  // alone. While the running presentation lets guests in, only guests play: accounts are for the admin.
  const audience = new Hono<AppEnv>()
    .use(requireUser(() => true))
    .use(async (c, next) => {
      if (!canPlay(store, c.get("user") as SessionUser))
        throw new HTTPException(403, { message: "This presentation is for guests: join with a name" })
      await next()
    })
    .get("/stage", (c) => c.json(audienceView(store, c.get("user") as SessionUser)))
    .post("/respond", async (c) => {
      const user = c.get("user") as SessionUser
      const body = await parseBody(c, respondBody)
      if (store.getActivity(body.activityId)?.membersOnly && !isMember(user))
        throw new HTTPException(403, { message: "This one is reserved to Soci" })
      const response = store.respond(body.activityId, user, body.response)
      // The new stage comes along, so a winning answer shows as won without waiting for the event.
      return c.json({ response, stage: audienceView(store, user) })
    })
    .get("/events", (c) => {
      const user = c.get("user") as SessionUser
      return sse(c, (send) => {
        const onStage = () => {
          // Guest access started or ended: the phone goes back to joining (name or sign-in).
          if (!canPlay(store, user)) send("signed-out", {})
          else send("stage", audienceView(store, user))
        }
        // Points only matter to phones for the presentation running now.
        const onLeaderboard = (id: string) => {
          if (id === store.getStage().presentationId) onStage()
        }
        onStage()
        const leave = store.join(user.id)
        store.events.on("stage", onStage)
        store.events.on("leaderboard", onLeaderboard)
        return () => {
          leave()
          store.events.off("stage", onStage)
          store.events.off("leaderboard", onLeaderboard)
        }
      })
    })
  app.route("/api/audience", audience)

  const admin = new Hono<AppEnv>()
    .use(requireUser((u) => u.isAdmin))
    .get("/types", (c) =>
      c.json(
        Object.values(activityDefinitions).map(({ type, label, description }) => ({
          type,
          label,
          description,
        })),
      ),
    )
    .get("/activities/:id", (c) => c.json(store.requireActivity(c.req.param("id"))))
    .post("/activities", async (c) =>
      c.json(store.createActivity(await parseBody(c, createActivityBody)), 201),
    )
    .patch("/activities/:id", async (c) =>
      c.json(store.updateActivity(c.req.param("id"), await parseBody(c, updateActivityBody))),
    )
    .delete("/activities/:id", (c) => {
      store.deleteActivity(c.req.param("id"))
      return c.body(null, 204)
    })
    .post("/presentations", async (c) =>
      c.json(store.createPresentation(await parseBody(c, presentationBody)), 201),
    )
    .get("/presentations/:id", (c) => c.json(store.requirePresentation(c.req.param("id"))))
    .patch("/presentations/:id", async (c) =>
      c.json(store.updatePresentation(c.req.param("id"), await parseBody(c, presentationBody.partial()))),
    )
    .delete("/presentations/:id", (c) => {
      store.deletePresentation(c.req.param("id"))
      return c.body(null, 204)
    })
    .post("/presentations/:id/reset", (c) => {
      store.resetPresentation(c.req.param("id"))
      return c.json(store.getLeaderboard(c.req.param("id")))
    })
    .get("/api-key", (c) => c.json({ apiKey: store.getApiKey() }))
    .post("/api-key", (c) => c.json({ apiKey: store.regenerateApiKey() }))
    .route("/", control)
  app.route("/api/admin", admin)

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404))

  return app
}

/** Guests play only while the running presentation lets them in, and accounts only while it does not. */
function canPlay(store: Store, user: SessionUser) {
  return Boolean(user.guest) === store.guestAccessOpen()
}

/** Soci, and admins, who can always take part outside guest presentations. */
function isMember(user: SessionUser) {
  return user.canParticipate || user.isAdmin
}

/** The stage as presentations and the admin see it: ids resolved to slugs. */
function describeStage(store: Store, stage: Stage) {
  const activity = stage.activityId ? store.getActivity(stage.activityId) : undefined
  const presentation = stage.presentationId ? store.getPresentation(stage.presentationId) : undefined
  return {
    status: stage.status,
    changedAt: stage.changedAt,
    activity: activity
      ? { id: activity.id, slug: activity.slug, type: activity.type, title: activity.title }
      : null,
    presentation: presentation
      ? { id: presentation.id, slug: presentation.slug, title: presentation.title }
      : null,
  }
}

/** The stage as one audience member sees it, with their own answer if they gave one. */
function audienceView(store: Store, user: SessionUser) {
  const stage = store.getAudienceStage()
  return {
    ...stage,
    myResponse: stage.activity ? store.getResponse(stage.activity.id, user.id) : null,
    outcome: stage.activity ? store.getAudienceOutcome(stage.activity.id, user.id) : null,
    leaderboard: store.getAudienceLeaderboard(user.id),
  }
}
