import { randomBytes, randomInt, randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import {
  isCorrect,
  type MemoryQuizConfig,
  type MemoryQuizDraw,
  memoryQuiz,
} from "../activities/memory-quiz/definition.ts"
import {
  type NumberEstimateDraw,
  type NumberEstimateResponse,
  numberEstimate,
} from "../activities/number-estimate/definition.ts"
import {
  closestEntries,
  type NumberLotteryDraw,
  type NumberLotteryResponse,
  numberLottery,
} from "../activities/number-lottery/definition.ts"
import { getActivityDefinition } from "../activities/registry.ts"
import {
  buildCycle,
  pickWinners,
  type SecretSantaConfig,
  type SecretSantaDraw,
  type SecretSantaEntry,
  type SecretSantaGadgetDraw,
  type SecretSantaView,
  secretSanta,
  withdrawFromCycle,
} from "../activities/secret-santa/definition.ts"
import type { StoredResponse } from "../activities/types.ts"
import type { Database } from "./db.ts"

export interface Activity {
  id: string
  slug: string
  type: string
  title: string
  config: unknown
  createdAt: number
  updatedAt: number
}

export type StageStatus = "open" | "closed"

/** The single global "what is happening right now". Only one presentation exists at a time. */
export interface Stage {
  activityId: string | null
  status: StageStatus
  changedAt: number
}

/** What audience members receive: the activity on stage, stripped down to what they need. */
export interface AudienceStage {
  status: StageStatus
  changedAt: number
  activity: { id: string; type: string; config: unknown } | null
}

export interface StoreEvents {
  stage: [Stage]
  /** Responses, config or the activity itself changed: results must be recomputed. */
  results: [activityId: string]
}

interface ActivityRow {
  id: string
  slug: string
  type: string
  title: string
  config: string
  created_at: number
  updated_at: number
}

export class StoreError extends Error {
  readonly status: 400 | 404 | 409
  readonly details: unknown
  constructor(status: 400 | 404 | 409, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

const IDLE_STAGE: Stage = { activityId: null, status: "closed", changedAt: 0 }

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class Store {
  readonly events = new EventEmitter<StoreEvents>()
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
    // Every SSE connection adds listeners; the default cap of 10 would only produce warnings.
    this.events.setMaxListeners(0)
  }

  // ---- activities ------------------------------------------------------------------------

  listActivities(): Activity[] {
    const rows = this.db.prepare("SELECT * FROM activities ORDER BY created_at DESC").all()
    return (rows as unknown as ActivityRow[]).map(toActivity)
  }

  /** Looks an activity up by id or slug, so the API can use readable slugs. */
  getActivity(idOrSlug: string): Activity | undefined {
    const row = this.db.prepare("SELECT * FROM activities WHERE id = ? OR slug = ?").get(idOrSlug, idOrSlug)
    return row ? toActivity(row as unknown as ActivityRow) : undefined
  }

  requireActivity(idOrSlug: string): Activity {
    const activity = this.getActivity(idOrSlug)
    if (!activity) throw new StoreError(404, `No activity "${idOrSlug}"`)
    return activity
  }

  createActivity(input: { type: string; title: string; slug: string }): Activity {
    const definition = getActivityDefinition(input.type)
    if (!definition) throw new StoreError(400, `Unknown activity type "${input.type}"`)
    this.assertSlugFree(input.slug)
    const now = Date.now()
    const activity: Activity = {
      id: randomUUID(),
      slug: input.slug,
      type: input.type,
      title: input.title,
      config: definition.defaultConfig(),
      createdAt: now,
      updatedAt: now,
    }
    this.db
      .prepare(
        "INSERT INTO activities (id, slug, type, title, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        activity.id,
        activity.slug,
        activity.type,
        activity.title,
        JSON.stringify(activity.config),
        now,
        now,
      )
    return activity
  }

  updateActivity(id: string, patch: { title?: string; slug?: string; config?: unknown }): Activity {
    const activity = this.requireActivity(id)
    if (
      patch.config !== undefined &&
      activity.type === memoryQuiz.type &&
      this.getSetting(`quiz-draw:${activity.id}`)
    ) {
      throw new StoreError(409, "Reset this quiz before editing its question or answers")
    }
    if (
      patch.config !== undefined &&
      activity.type === numberEstimate.type &&
      (this.listResponses(activity.id).length || this.getSetting(`number-draw:${activity.id}`))
    ) {
      throw new StoreError(409, "Reset this estimate before editing its question or target")
    }
    const definition = getActivityDefinition(activity.type)
    if (!definition) throw new StoreError(400, `Unknown activity type "${activity.type}"`)
    let config = activity.config
    if (patch.config !== undefined) {
      const parsed = definition.configSchema.safeParse(patch.config)
      if (!parsed.success) throw new StoreError(400, "Invalid configuration", parsed.error.issues)
      config = parsed.data
    }
    if (patch.slug !== undefined && patch.slug !== activity.slug) this.assertSlugFree(patch.slug)
    const updated: Activity = {
      ...activity,
      title: patch.title ?? activity.title,
      slug: patch.slug ?? activity.slug,
      config,
      updatedAt: Date.now(),
    }
    this.db
      .prepare("UPDATE activities SET title = ?, slug = ?, config = ?, updated_at = ? WHERE id = ?")
      .run(updated.title, updated.slug, JSON.stringify(updated.config), updated.updatedAt, updated.id)
    if (this.getStage().activityId === updated.id) this.events.emit("stage", this.getStage())
    this.events.emit("results", updated.id)
    return updated
  }

  deleteActivity(id: string): void {
    const activity = this.requireActivity(id)
    if (this.getStage().activityId === activity.id) this.clearStage()
    this.db.prepare("DELETE FROM activities WHERE id = ?").run(activity.id)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`number-draw:${activity.id}`)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`quiz-draw:${activity.id}`)
    this.deleteSecretSantaDraws(activity.id)
  }

  private assertSlugFree(slug: string) {
    if (!SLUG_PATTERN.test(slug)) throw new StoreError(400, "Slugs use lowercase letters, digits and dashes")
    if (this.getActivity(slug)) throw new StoreError(409, `The slug "${slug}" is already taken`)
  }

  // ---- responses -------------------------------------------------------------------------

  listResponses(activityId: string): StoredResponse[] {
    const rows = this.db
      .prepare("SELECT user_id, user_name, response, updated_at FROM responses WHERE activity_id = ?")
      .all(activityId) as { user_id: string; user_name: string; response: string; updated_at: number }[]
    return rows.map((r) => ({
      userId: r.user_id,
      userName: r.user_name,
      response: JSON.parse(r.response),
      updatedAt: r.updated_at,
    }))
  }

  getResponse(activityId: string, userId: string): unknown {
    const row = this.db
      .prepare("SELECT response FROM responses WHERE activity_id = ? AND user_id = ?")
      .get(activityId, userId) as { response: string } | undefined
    return row ? JSON.parse(row.response) : null
  }

  /** Saves (or replaces) a user's answer. Only the activity on stage accepts answers, while open. */
  respond(activityId: string, user: { id: string; name: string }, response: unknown): unknown {
    const stage = this.getStage()
    if (stage.activityId !== activityId || stage.status !== "open") {
      throw new StoreError(409, "This activity is not accepting answers right now")
    }
    const activity = this.requireActivity(activityId)
    this.assertCanOpen(activity)
    const definition = getActivityDefinition(activity.type)
    if (!definition) throw new StoreError(400, `Unknown activity type "${activity.type}"`)
    const parsed = definition.responseSchema(activity.config).safeParse(response)
    if (!parsed.success) throw new StoreError(400, "Invalid answer", parsed.error.issues)
    const quizWinner: MemoryQuizDraw | null =
      activity.type === memoryQuiz.type && isCorrect(activity.config as MemoryQuizConfig, parsed.data.answer)
        ? {
            answer: (activity.config as MemoryQuizConfig).acceptedAnswers[0] as string,
            winner: { name: parsed.data.name, answer: parsed.data.answer },
            drawnAt: Date.now(),
          }
        : null
    if (quizWinner) this.db.exec("BEGIN")
    try {
      this.db
        .prepare(
          `INSERT INTO responses (activity_id, user_id, user_name, response, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (activity_id, user_id) DO UPDATE SET
           user_name = excluded.user_name, response = excluded.response, updated_at = excluded.updated_at`,
        )
        .run(activity.id, user.id, user.name, JSON.stringify(parsed.data), Date.now())
      if (quizWinner) {
        this.setSetting(`quiz-draw:${activity.id}`, quizWinner)
        this.setSetting("stage", { ...stage, status: "closed", changedAt: quizWinner.drawnAt })
        this.db.exec("COMMIT")
      }
    } catch (error) {
      if (quizWinner) this.db.exec("ROLLBACK")
      throw error
    }
    if (quizWinner) this.events.emit("stage", this.getStage())
    this.events.emit("results", activity.id)
    return parsed.data
  }

  resetResponses(idOrSlug: string): void {
    const activity = this.requireActivity(idOrSlug)
    this.db.prepare("DELETE FROM responses WHERE activity_id = ?").run(activity.id)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`number-draw:${activity.id}`)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`quiz-draw:${activity.id}`)
    this.deleteSecretSantaDraws(activity.id)
    this.events.emit("results", activity.id)
    if (
      [numberLottery.type, numberEstimate.type, memoryQuiz.type].includes(activity.type) &&
      this.getStage().activityId === activity.id
    ) {
      this.events.emit("stage", this.getStage())
    }
  }

  getResults(idOrSlug: string) {
    const activity = this.requireActivity(idOrSlug)
    const definition = getActivityDefinition(activity.type)
    if (!definition) throw new StoreError(400, `Unknown activity type "${activity.type}"`)
    return {
      id: activity.id,
      slug: activity.slug,
      type: activity.type,
      title: activity.title,
      results: [numberLottery.type, numberEstimate.type].includes(activity.type)
        ? {
            ...definition.aggregate(activity.config, this.listResponses(activity.id)),
            draw:
              this.getSetting<NumberLotteryDraw | NumberEstimateDraw>(`number-draw:${activity.id}`) ?? null,
          }
        : activity.type === memoryQuiz.type
          ? {
              ...definition.aggregate(activity.config, this.listResponses(activity.id)),
              draw: this.getSetting<MemoryQuizDraw>(`quiz-draw:${activity.id}`) ?? null,
            }
          : activity.type === secretSanta.type
            ? {
                ...definition.aggregate(activity.config, this.listResponses(activity.id)),
                drawn: Boolean(this.getSetting(`santa-draw:${activity.id}`)),
                gadgetDrawn: Boolean(this.getSetting(`santa-gadget:${activity.id}`)),
              }
            : definition.aggregate(activity.config, this.listResponses(activity.id)),
    }
  }

  /** Reveal an unanswered quiz, or return its already recorded first correct winner. */
  drawQuiz(idOrSlug: string) {
    const activity = this.requireActivity(idOrSlug)
    if (activity.type !== memoryQuiz.type) throw new StoreError(400, "This activity is not a memory quiz")
    if (this.getSetting(`quiz-draw:${activity.id}`)) return this.getResults(activity.id)
    const stage = this.getStage()
    if (stage.activityId !== activity.id) throw new StoreError(409, "Put this activity on stage first")
    const parsedConfig = memoryQuiz.configSchema.safeParse(activity.config)
    if (!parsedConfig.success)
      throw new StoreError(400, "Save a valid quiz before revealing the answer", parsedConfig.error.issues)
    const config = parsedConfig.data
    const draw: MemoryQuizDraw = {
      answer: config.acceptedAnswers[0] as string,
      winner: null,
      drawnAt: Date.now(),
    }
    this.db.exec("BEGIN")
    try {
      this.setSetting(`quiz-draw:${activity.id}`, draw)
      this.setSetting("stage", { ...stage, status: "closed", changedAt: draw.drawnAt })
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("stage", this.getStage())
    this.events.emit("results", activity.id)
    return this.getResults(activity.id)
  }

  drawActivity(idOrSlug: string) {
    const type = this.requireActivity(idOrSlug).type
    return type === memoryQuiz.type
      ? this.drawQuiz(idOrSlug)
      : type === numberEstimate.type
        ? this.drawEstimate(idOrSlug)
        : type === secretSanta.type
          ? this.drawSecretSanta(idOrSlug)
          : this.drawNumber(idOrSlug)
  }

  /** Reveal a configured real figure without exposing other participants' guesses. */
  drawEstimate(idOrSlug: string) {
    const activity = this.requireActivity(idOrSlug)
    if (activity.type !== numberEstimate.type)
      throw new StoreError(400, "This activity is not a number estimate")
    if (this.getSetting(`number-draw:${activity.id}`)) return this.getResults(activity.id)
    const stage = this.getStage()
    if (stage.activityId !== activity.id) throw new StoreError(409, "Put this activity on stage first")
    const config = numberEstimate.configSchema.parse(activity.config)
    const entries = (this.listResponses(activity.id) as StoredResponse<NumberEstimateResponse>[]).map(
      ({ response }) => response,
    )
    const { closest, distance } = closestEntries(entries, config.target)
    const draw: NumberEstimateDraw = {
      number: config.target,
      distance: entries.length ? distance : null,
      tied: closest.length,
      winner: closest.length ? (closest[randomInt(closest.length)] ?? null) : null,
      drawnAt: Date.now(),
    }
    this.db.exec("BEGIN")
    try {
      this.setSetting(`number-draw:${activity.id}`, draw)
      this.setSetting("stage", { ...stage, status: "closed", changedAt: draw.drawnAt })
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("stage", this.getStage())
    this.events.emit("results", activity.id)
    return this.getResults(activity.id)
  }

  /** Server-owned, persistent and idempotent draw. No caller can supply the target number. */
  drawNumber(idOrSlug: string) {
    const activity = this.requireActivity(idOrSlug)
    if (activity.type !== numberLottery.type)
      throw new StoreError(400, "This activity is not a number lottery")
    if (this.getSetting<NumberLotteryDraw>(`number-draw:${activity.id}`)) return this.getResults(activity.id)
    const stage = this.getStage()
    if (stage.activityId !== activity.id) throw new StoreError(409, "Put this activity on stage first")
    const config = numberLottery.configSchema.parse(activity.config)
    const results = numberLottery.aggregate(
      config,
      this.listResponses(activity.id) as StoredResponse<NumberLotteryResponse>[],
    )
    if (!results.entries.length) throw new StoreError(409, "At least one participant is required")
    const number = randomInt(0, 101)
    const { closest, distance } = closestEntries(results.entries, number)
    const draw: NumberLotteryDraw = {
      number,
      distance,
      closest,
      winners: [closest[randomInt(closest.length)] as (typeof closest)[number]],
      drawnAt: Date.now(),
    }
    const closed: Stage = { ...stage, status: "closed", changedAt: draw.drawnAt }
    this.db.exec("BEGIN")
    try {
      this.setSetting(`number-draw:${activity.id}`, draw)
      this.setSetting("stage", closed)
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("stage", closed)
    this.events.emit("results", activity.id)
    return this.getResults(activity.id)
  }

  private assertCanOpen(activity: Activity) {
    if (activity.type === secretSanta.type) {
      throw new StoreError(409, "Secret Santa runs off stage: make it visible on the home page instead")
    }
    if (
      [numberLottery.type, numberEstimate.type].includes(activity.type) &&
      this.getSetting(`number-draw:${activity.id}`)
    ) {
      throw new StoreError(
        409,
        activity.type === numberLottery.type
          ? "Reset this lottery before reopening entries"
          : "Reset this estimate before reopening entries",
      )
    }
    if (activity.type === memoryQuiz.type && this.getSetting(`quiz-draw:${activity.id}`)) {
      throw new StoreError(409, "Reset this quiz before reopening answers")
    }
    if (
      activity.type === numberEstimate.type &&
      !numberEstimate.configSchema.safeParse(activity.config).success
    ) {
      throw new StoreError(400, "Save a valid number estimate before opening guesses")
    }
    if (activity.type === memoryQuiz.type) {
      const parsed = memoryQuiz.configSchema.safeParse(activity.config)
      if (!parsed.success)
        throw new StoreError(400, "Save a valid quiz before opening answers", parsed.error.issues)
    }
  }

  // ---- secret santa ----------------------------------------------------------------------

  /** Every visible Secret Santa, as `userId` sees it. */
  listSecretSantas(userId: string): SecretSantaView[] {
    return this.listActivities()
      .filter((activity) => activity.type === secretSanta.type)
      .flatMap((activity) => {
        const config = secretSanta.configSchema.parse(activity.config)
        return config.visible ? [this.secretSantaView(activity, config, userId)] : []
      })
  }

  /** Signs `user` up, or updates what they wrote. New people only until the draw. */
  joinSecretSanta(idOrSlug: string, user: { id: string; name: string }, entry: unknown): SecretSantaView {
    const { activity, config } = this.requireVisibleSecretSanta(idOrSlug)
    const parsed = secretSanta.responseSchema(config).safeParse(entry)
    if (!parsed.success) throw new StoreError(400, "Invalid entry", parsed.error.issues)
    const existing = this.getResponse(activity.id, user.id) as SecretSantaEntry | null
    if (!existing && (!config.signupsOpen || this.getSetting(`santa-draw:${activity.id}`))) {
      throw new StoreError(409, "Sign-ups are closed")
    }
    // Once the gadget is drawn, joining or leaving it would change who could have won.
    const data =
      existing && this.getSetting(`santa-gadget:${activity.id}`)
        ? { ...parsed.data, gadget: existing.gadget }
        : parsed.data
    this.db
      .prepare(
        `INSERT INTO responses (activity_id, user_id, user_name, response, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (activity_id, user_id) DO UPDATE SET
           user_name = excluded.user_name, response = excluded.response, updated_at = excluded.updated_at`,
      )
      .run(activity.id, user.id, user.name, JSON.stringify(data), Date.now())
    this.events.emit("results", activity.id)
    return this.secretSantaView(activity, config, user.id)
  }

  /** The person leaves. After the draw only whoever was giving them a gift gets a new match. */
  withdrawSecretSanta(idOrSlug: string, userId: string): SecretSantaView {
    const { activity, config } = this.requireVisibleSecretSanta(idOrSlug)
    this.removeSecretSantaEntry(activity.id, userId)
    return this.secretSantaView(activity, config, userId)
  }

  /** Admin: takes someone out, exactly as if they had withdrawn. */
  removeSecretSantaParticipant(idOrSlug: string, userId: string) {
    const { activity } = this.requireSecretSanta(idOrSlug)
    this.removeSecretSantaEntry(activity.id, userId)
    return this.getSecretSantaAdmin(activity.id)
  }

  /** One random gift cycle among everyone signed up. Closes sign-ups; idempotent. */
  drawSecretSanta(idOrSlug: string) {
    const { activity } = this.requireSecretSanta(idOrSlug)
    if (!this.getSetting(`santa-draw:${activity.id}`)) {
      const ids = this.listResponses(activity.id).map(({ userId }) => userId)
      if (ids.length < 2) throw new StoreError(409, "At least two people must sign up first")
      const draw: SecretSantaDraw = {
        drawnAt: Date.now(),
        assignments: buildCycle(ids, (size) => randomInt(size)),
      }
      this.setSetting(`santa-draw:${activity.id}`, draw)
      this.events.emit("results", activity.id)
    }
    return this.getResults(activity.id)
  }

  /** Draws the gadget winners among the people who entered it. Idempotent. */
  drawSecretSantaGadget(idOrSlug: string) {
    const { activity, config } = this.requireSecretSanta(idOrSlug)
    if (!config.gadget.enabled) throw new StoreError(409, "The gadget draw is turned off")
    if (!this.getSetting(`santa-gadget:${activity.id}`)) {
      const entrants = (this.listResponses(activity.id) as StoredResponse<SecretSantaEntry>[])
        .filter(({ response }) => response.gadget)
        .map(({ userId }) => userId)
      if (!entrants.length) throw new StoreError(409, "Nobody entered the gadget draw yet")
      const draw: SecretSantaGadgetDraw = {
        drawnAt: Date.now(),
        winners: pickWinners(entrants, config.gadget.winners, (size) => randomInt(size)),
      }
      this.setSetting(`santa-gadget:${activity.id}`, draw)
      this.events.emit("results", activity.id)
    }
    return this.getResults(activity.id)
  }

  /** Admin only: who signed up and who won the gadget. Never who gives a gift to whom. */
  getSecretSantaAdmin(idOrSlug: string) {
    const { activity } = this.requireSecretSanta(idOrSlug)
    const responses = this.listResponses(activity.id) as StoredResponse<SecretSantaEntry>[]
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    const gadget = this.getSetting<SecretSantaGadgetDraw>(`santa-gadget:${activity.id}`)
    const nameOf = (userId: string) => responses.find((r) => r.userId === userId)?.userName ?? "(withdrawn)"
    return {
      drawnAt: draw?.drawnAt ?? null,
      participants: responses
        .map(({ userId, userName, response }) => ({
          userId,
          name: userName,
          gadget: response.gadget,
          /** false: drawn, but a withdrawal left this person nobody to give a gift to. */
          hasMatch: draw ? Boolean(draw.assignments[userId]) : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      gadget: gadget
        ? { drawnAt: gadget.drawnAt, winners: gadget.winners.map((id) => ({ userId: id, name: nameOf(id) })) }
        : null,
    }
  }

  private requireSecretSanta(idOrSlug: string) {
    const activity = this.requireActivity(idOrSlug)
    if (activity.type !== secretSanta.type) throw new StoreError(400, "This activity is not a Secret Santa")
    return { activity, config: secretSanta.configSchema.parse(activity.config) }
  }

  private requireVisibleSecretSanta(idOrSlug: string) {
    const found = this.requireSecretSanta(idOrSlug)
    if (!found.config.visible) throw new StoreError(404, `No activity "${idOrSlug}"`)
    return found
  }

  private removeSecretSantaEntry(activityId: string, userId: string) {
    if (!this.getResponse(activityId, userId)) throw new StoreError(404, "Not signed up")
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activityId}`)
    const gadget = this.getSetting<SecretSantaGadgetDraw>(`santa-gadget:${activityId}`)
    this.db.exec("BEGIN")
    try {
      this.db.prepare("DELETE FROM responses WHERE activity_id = ? AND user_id = ?").run(activityId, userId)
      if (draw) {
        this.setSetting(`santa-draw:${activityId}`, {
          ...draw,
          assignments: withdrawFromCycle(draw.assignments, userId),
        })
      }
      if (gadget) {
        this.setSetting(`santa-gadget:${activityId}`, {
          ...gadget,
          winners: gadget.winners.filter((id) => id !== userId),
        })
      }
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("results", activityId)
  }

  private secretSantaView(activity: Activity, config: SecretSantaConfig, userId: string): SecretSantaView {
    const responses = this.listResponses(activity.id) as StoredResponse<SecretSantaEntry>[]
    const mine = responses.find((r) => r.userId === userId)
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    const gadget = this.getSetting<SecretSantaGadgetDraw>(`santa-gadget:${activity.id}`)
    const receiverId = mine && draw ? (draw.assignments[userId] ?? null) : null
    const receiver = receiverId ? responses.find((r) => r.userId === receiverId) : undefined
    return {
      id: activity.id,
      title: activity.title,
      config,
      participants: responses.length,
      drawn: Boolean(draw),
      gadgetDrawn: Boolean(gadget),
      canJoin: config.signupsOpen && !draw,
      entry: mine?.response ?? null,
      match: receiver
        ? { name: receiver.userName, likes: receiver.response.likes, dislikes: receiver.response.dislikes }
        : null,
      gadgetWon:
        mine && gadget && config.gadget.enabled && mine.response.gadget
          ? gadget.winners.includes(userId)
          : null,
    }
  }

  private deleteSecretSantaDraws(activityId: string) {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-draw:${activityId}`)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-gadget:${activityId}`)
  }

  // ---- stage -----------------------------------------------------------------------------

  getStage(): Stage {
    return this.getSetting<Stage>("stage") ?? IDLE_STAGE
  }

  /** Puts an activity on stage (replacing whatever was there) and opens or closes it. */
  setStage(idOrSlug: string, status: StageStatus): Stage {
    const activity = this.requireActivity(idOrSlug)
    if (status === "open") this.assertCanOpen(activity)
    return this.writeStage({ activityId: activity.id, status, changedAt: Date.now() })
  }

  /** Opens or closes what is on stage, without changing it. */
  setStageStatus(status: StageStatus): Stage {
    const stage = this.getStage()
    if (!stage.activityId) throw new StoreError(409, "Nothing is on stage")
    return this.setStage(stage.activityId, status)
  }

  /** Back to the idle screen. */
  clearStage(): Stage {
    return this.writeStage({ activityId: null, status: "closed", changedAt: Date.now() })
  }

  getAudienceStage(): AudienceStage {
    const stage = this.getStage()
    const activity = stage.activityId ? this.getActivity(stage.activityId) : undefined
    const definition = activity && getActivityDefinition(activity.type)
    return {
      status: stage.status,
      changedAt: stage.changedAt,
      activity:
        activity && definition
          ? {
              id: activity.id,
              type: activity.type,
              config: definition.audienceConfig
                ? definition.audienceConfig(activity.config)
                : activity.config,
            }
          : null,
    }
  }

  private writeStage(stage: Stage): Stage {
    this.setSetting("stage", stage)
    this.events.emit("stage", stage)
    return stage
  }

  // ---- api key ---------------------------------------------------------------------------

  getApiKey(): string {
    return this.getSetting<string>("apiKey") ?? this.regenerateApiKey()
  }

  regenerateApiKey(): string {
    const key = `la_${randomBytes(24).toString("base64url")}`
    this.setSetting("apiKey", key)
    return key
  }

  // ---- settings --------------------------------------------------------------------------

  private getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  private setSetting(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(key, JSON.stringify(value))
  }
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    config: JSON.parse(row.config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
