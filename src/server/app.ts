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
})
const themeBody = z.object({ christmas: z.boolean() })
const respondBody = z.object({ activityId: z.string(), response: z.unknown() })
const santaAdminEdit = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(500),
})
const santaAssignments = santaAdminEdit.extend({
  assignments: z.record(z.string().min(1).max(200), z.string().min(1).max(200).nullable()),
})
const santaConfirmation = santaAdminEdit.extend({ confirmed: z.boolean() })
/** The letter itself is validated by the store against the activity's response schema. */
const santaEntryEdit = santaAdminEdit.extend({ entry: z.unknown() })
const santaReadmission = santaEntryEdit.extend({
  giverId: z.string().min(1).max(200).nullable().optional(),
  confirmed: z.boolean().default(false),
})
const santaRemoval = z.object({
  reason: z.string().trim().min(1).max(500).default("Rimozione dagli organizzatori"),
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
})

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
      c.json(store.listPresentations().map(({ id, slug, title }) => ({ id, slug, title }))),
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

  app.get("/api/me", (c) => c.json({ user: c.get("user") }))

  // Public: the sign-in screen is themed too.
  app.get("/api/theme", (c) => c.json({ christmas: store.getTheme() === "christmas" }))

  // Anyone with a PoliNetwork account may play; activities marked members only take Soci alone.
  const audience = new Hono<AppEnv>()
    .use(requireUser(() => true))
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
        const onStage = () => send("stage", audienceView(store, user))
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

  // Secret Santa runs off stage and is open to anyone signed in; one marked members only takes new
  // sign-ups from Soci alone. Whoever already took part keeps it, even if "Soci only" came later:
  // their match and gift confirmation live there.
  const santa = new Hono<AppEnv>()
    .use(requireUser(() => true))
    .get("/", (c) => {
      const user = c.get("user") as SessionUser
      return c.json(
        store
          .listSecretSantas(user.id)
          .filter(
            (view) =>
              isMember(user) ||
              !store.getActivity(view.id)?.membersOnly ||
              view.entry !== null ||
              view.removed !== null,
          ),
      )
    })
    .post("/:id/confirm-gift", (c) => {
      // JSON requests cannot be submitted by cross-site forms.
      if (!/^application\/json(?:\s*;|$)/i.test(c.req.header("content-type") ?? "")) {
        throw new HTTPException(415, { message: "Use application/json" })
      }
      return c.json(store.confirmSecretSantaGift(c.req.param("id"), (c.get("user") as SessionUser).id))
    })
    .put("/:id/entry", async (c) => {
      const user = c.get("user") as SessionUser
      const activity = store.getActivity(c.req.param("id"))
      if (activity?.membersOnly && !isMember(user) && store.getResponse(activity.id, user.id) === null)
        throw new HTTPException(403, { message: "This one is reserved to Soci" })
      const body = await c.req.json().catch(() => null)
      return c.json(store.joinSecretSanta(c.req.param("id"), user, body))
    })
    .delete("/:id/entry", (c) =>
      c.json(store.withdrawSecretSanta(c.req.param("id"), (c.get("user") as SessionUser).id)),
    )
  app.route("/api/secret-santa", santa)

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
    .get("/secret-santa/:id", (c) => c.json(store.getSecretSantaAdmin(c.req.param("id"))))
    .patch("/secret-santa/:id/assignments", async (c) =>
      c.json(
        store.updateSecretSantaAssignments(
          c.req.param("id"),
          c.get("user") as SessionUser,
          await parseBody(c, santaAssignments),
        ),
      ),
    )
    .patch("/secret-santa/:id/participants/:userId/confirmation", async (c) =>
      c.json(
        store.updateSecretSantaConfirmation(
          c.req.param("id"),
          c.req.param("userId"),
          c.get("user") as SessionUser,
          await parseBody(c, santaConfirmation),
        ),
      ),
    )
    .post("/secret-santa/:id/participants/:userId/readmit", async (c) =>
      c.json(
        store.readmitSecretSantaParticipant(
          c.req.param("id"),
          c.req.param("userId"),
          c.get("user") as SessionUser,
          await parseBody(c, santaReadmission),
        ),
      ),
    )
    .patch("/secret-santa/:id/participants/:userId/entry", async (c) =>
      c.json(
        store.updateSecretSantaEntry(
          c.req.param("id"),
          c.req.param("userId"),
          c.get("user") as SessionUser,
          await parseBody(c, santaEntryEdit),
        ),
      ),
    )
    .post("/secret-santa/:id/draw", (c) => {
      store.drawSecretSanta(c.req.param("id"), c.get("user") as SessionUser)
      return c.json(store.getSecretSantaAdmin(c.req.param("id")))
    })
    .post("/secret-santa/:id/release", (c) =>
      c.json(store.releaseSecretSantaDraw(c.req.param("id"), c.get("user") as SessionUser)),
    )
    .post("/secret-santa/:id/undo-draw", (c) =>
      c.json(store.undoSecretSantaDraw(c.req.param("id"), c.get("user") as SessionUser)),
    )
    .post("/secret-santa/:id/gadget-draw", (c) => {
      store.drawSecretSantaGadget(c.req.param("id"))
      return c.json(store.getSecretSantaAdmin(c.req.param("id")))
    })
    .delete("/secret-santa/:id/participants/:userId", async (c) =>
      c.json(
        store.removeSecretSantaParticipant(
          c.req.param("id"),
          c.req.param("userId"),
          c.get("user") as SessionUser,
          await parseBody(c, santaRemoval),
        ),
      ),
    )
    .put("/theme", async (c) => {
      const body = await parseBody(c, themeBody)
      return c.json({ christmas: store.setTheme(body.christmas ? "christmas" : "default") === "christmas" })
    })
    .get("/api-key", (c) => c.json({ apiKey: store.getApiKey() }))
    .post("/api-key", (c) => c.json({ apiKey: store.regenerateApiKey() }))
    .route("/", control)
  app.route("/api/admin", admin)

  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404))

  return app
}

/** Soci, and admins, who can always take part. */
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
