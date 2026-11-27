import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import {
  isCorrect,
  type MemoryQuizConfig,
  type MemoryQuizDraw,
  type MemoryQuizResponse,
  memoryQuiz,
  quizScoring,
} from "../activities/memory-quiz/definition.ts"
import {
  estimateAccuracy,
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
import { scorePoints } from "../activities/scoring.ts"
import {
  buildCycle,
  confirmationClosesAt,
  drawDueAt,
  revealDueAt,
  type SecretSantaConfig,
  type SecretSantaDraw,
  type SecretSantaEntry,
  type SecretSantaGadgetDraw,
  type SecretSantaView,
  secretSanta,
  signupsOpenAt,
  withdrawFromCycle,
} from "../activities/secret-santa/definition.ts"
import type { StoredResponse } from "../activities/types.ts"
import type { Database } from "./db.ts"

/** An unreleased draft should never start in the final grace period. */
function draftMissedConfirmationWindow(config: SecretSantaConfig, now: number) {
  return Boolean(config.confirmationDueAt) && now >= Date.parse(config.confirmationDueAt)
}

export interface Activity {
  id: string
  slug: string
  type: string
  title: string
  config: unknown
  /** The presentation it belongs to, whose leaderboard its points count towards. */
  presentationId: string | null
  /** Only Soci (and admins) may answer. Otherwise anyone signed in with a PoliNetwork account may. */
  membersOnly: boolean
  /** Whether its points add up to the presentation's leaderboard. */
  countsToLeaderboard: boolean
  createdAt: number
  updatedAt: number
}

/** A group of activities shown together, with one leaderboard. */
export interface Presentation {
  id: string
  slug: string
  title: string
  createdAt: number
}

export interface LeaderboardEntry {
  rank: number
  name: string
  points: number
}

/** The leaderboard as one audience member sees it between activities. */
export interface AudienceLeaderboard {
  title: string
  top: LeaderboardEntry[]
  me: { rank: number; points: number } | null
  players: number
}

export type StageStatus = "open" | "closed"

/** The audience page's look, a global setting. */
export type Theme = "default" | "christmas"

/** The single global "what is happening right now". Only one presentation exists at a time. */
export interface Stage {
  activityId: string | null
  status: StageStatus
  changedAt: number
  /**
   * The presentation running now, whose leaderboard the audience sees. It follows the activities
   * put on stage and stays when the stage is cleared.
   */
  presentationId: string | null
}

/** What audience members receive: the activity on stage, stripped down to what they need. */
export interface AudienceStage {
  status: StageStatus
  changedAt: number
  activity: {
    id: string
    type: string
    config: unknown
    membersOnly: boolean
    countsToLeaderboard: boolean
  } | null
}

/** How many people have the audience page open, and how many answered what is on stage. */
export interface AudienceCounts {
  connected: number
  /** Answers to the activity on stage, 0 when nothing is. */
  answered: number
  /** The slug of the activity on stage, which `answered` counts. */
  activity: string | null
}

/**
 * Draws are saved with the winner's account id so phones can tell people they won. The id never
 * leaves the server: results only carry `publicDraw(...)`.
 */
type SavedDraw<Draw> = Draw & { winnerUserId?: string | null }
type AnySavedDraw = SavedDraw<NumberLotteryDraw> | SavedDraw<NumberEstimateDraw> | SavedDraw<MemoryQuizDraw>

/** What one audience member learns once a game is decided. */
export interface AudienceOutcome {
  draw: unknown
  youWon: boolean
  /** What this person scored in the activity, or null if they did not take part. */
  points: number | null
}

/** One draw email to send: who to, and what the template needs. Never the name of their match. */
export interface SecretSantaMail {
  activityId: string
  userId: string
  to: string
  name: string
  exchange: string
  budget: string
  drawnAt: number
}

/** Someone withdrew after the draw: whoever was giving them a gift must hear about it. */
interface SecretSantaReassignNotice {
  giverId: string
  withdrawnName: string
  at: number
  reason?: "withdrawn" | "unconfirmed" | "admin"
}

/** "Your person withdrew" email: who to, who left, and whether there is a new match to open. */
export interface SecretSantaReassignMail {
  activityId: string
  userId: string
  to: string
  name: string
  withdrawnName: string
  hasNewMatch: boolean
  at: number
  reason?: "withdrawn" | "unconfirmed" | "admin"
}

interface SantaWarning {
  deadline: string
  sentAt: number | null
}
interface SantaRemoval {
  closesAt: number
  at: number
  name: string
  email?: string
  deadline: string
  sentAt: number | null
}
type SantaLeaveReason = "withdrawn" | "unconfirmed" | "admin"
/** Someone who left the cycle, kept so the organizers can readmit them with their letter. */
interface SantaArchived {
  name: string
  email?: string
  entry: SecretSantaEntry
  reason: SantaLeaveReason
  at: number
}
export interface SecretSantaStatusMail {
  activityId: string
  userId: string
  to: string
  name: string
  kind: "confirmation-reminder" | "removed"
  deadline: string
  closesAt: number
}

export interface SantaAdminActor {
  id: string
  name: string
}
interface SantaAdminChange {
  userId: string
  name: string
  field: string
  before: string | null
  after: string | null
}

export interface StoreEvents {
  stage: [Stage]
  /** Responses, config or the activity itself changed: results must be recomputed. */
  results: [activityId: string]
  /** Points in this presentation changed. */
  leaderboard: [presentationId: string]
  /** Someone opened or closed the audience page. */
  presence: []
}

interface ActivityRow {
  id: string
  slug: string
  type: string
  title: string
  config: string
  presentation_id: string | null
  members_only: number
  counts_to_leaderboard: number
  created_at: number
  updated_at: number
}

interface ScoreRow {
  userId: string
  userName: string
  points: number
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

const IDLE_STAGE: Stage = { activityId: null, status: "closed", changedAt: 0, presentationId: null }

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class Store {
  readonly events = new EventEmitter<StoreEvents>()
  private readonly db: Database
  /** Open audience pages per account: several tabs of one person count once. */
  private readonly present = new Map<string, number>()

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

  /** How many people answered each activity; activities nobody answered are missing. */
  answerCounts(): Map<string, number> {
    const rows = this.db
      .prepare("SELECT activity_id, COUNT(*) AS answers FROM responses GROUP BY activity_id")
      .all() as { activity_id: string; answers: number }[]
    return new Map(rows.map((row) => [row.activity_id, row.answers]))
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

  createActivity(input: {
    type: string
    title: string
    slug: string
    presentationId?: string | null
    membersOnly?: boolean
    countsToLeaderboard?: boolean
  }): Activity {
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
      presentationId: input.presentationId ? this.requirePresentation(input.presentationId).id : null,
      membersOnly: input.membersOnly ?? false,
      countsToLeaderboard: input.countsToLeaderboard ?? true,
      ...offStageFields(input.type),
      createdAt: now,
      updatedAt: now,
    }
    this.db
      .prepare(
        "INSERT INTO activities (id, slug, type, title, config, presentation_id, members_only, counts_to_leaderboard, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        activity.id,
        activity.slug,
        activity.type,
        activity.title,
        JSON.stringify(activity.config),
        activity.presentationId,
        activity.membersOnly ? 1 : 0,
        activity.countsToLeaderboard ? 1 : 0,
        now,
        now,
      )
    return activity
  }

  updateActivity(
    id: string,
    patch: {
      type?: string
      title?: string
      slug?: string
      config?: unknown
      presentationId?: string | null
      membersOnly?: boolean
      countsToLeaderboard?: boolean
    },
  ): Activity {
    const activity = this.requireActivity(id)
    const typeChanged = patch.type !== undefined && patch.type !== activity.type
    if (typeChanged && this.getStage().activityId === activity.id) {
      throw new StoreError(409, "Take this activity off stage before changing its type")
    }
    // Answers and draws of the old type would not fit the new one.
    if (
      typeChanged &&
      (this.listResponses(activity.id).length ||
        this.getSetting(`number-draw:${activity.id}`) ||
        this.getSetting(`quiz-draw:${activity.id}`))
    ) {
      throw new StoreError(409, "Reset the answers before changing the activity type")
    }
    // The admin page sends the config along with every save, e.g. of the toggles: only edits count.
    const configChanged =
      patch.config !== undefined && JSON.stringify(patch.config) !== JSON.stringify(activity.config)
    if (configChanged && activity.type === memoryQuiz.type && this.getSetting(`quiz-draw:${activity.id}`)) {
      throw new StoreError(409, "Reset this quiz before editing its question or answers")
    }
    if (
      configChanged &&
      activity.type === numberEstimate.type &&
      (this.listResponses(activity.id).length || this.getSetting(`number-draw:${activity.id}`))
    ) {
      throw new StoreError(409, "Reset this estimate before editing its question or target")
    }
    const type = patch.type ?? activity.type
    const definition = getActivityDefinition(type)
    if (!definition) throw new StoreError(400, `Unknown activity type "${type}"`)
    // Without a config, a new type starts from its default one.
    let config = typeChanged ? definition.defaultConfig() : activity.config
    if (patch.config !== undefined) {
      const parsed = definition.configSchema.safeParse(patch.config)
      if (!parsed.success) throw new StoreError(400, "Invalid configuration", parsed.error.issues)
      config = parsed.data
    }
    if (patch.slug !== undefined && patch.slug !== activity.slug) this.assertSlugFree(patch.slug)
    const presentationId =
      patch.presentationId === undefined
        ? activity.presentationId
        : patch.presentationId && this.requirePresentation(patch.presentationId).id
    const updated: Activity = {
      ...activity,
      type,
      title: patch.title ?? activity.title,
      slug: patch.slug ?? activity.slug,
      config,
      presentationId,
      membersOnly: patch.membersOnly ?? activity.membersOnly,
      countsToLeaderboard: patch.countsToLeaderboard ?? activity.countsToLeaderboard,
      ...offStageFields(type),
      updatedAt: Date.now(),
    }
    this.db
      .prepare(
        "UPDATE activities SET type = ?, title = ?, slug = ?, config = ?, presentation_id = ?, members_only = ?, counts_to_leaderboard = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        updated.type,
        updated.title,
        updated.slug,
        JSON.stringify(updated.config),
        updated.presentationId,
        updated.membersOnly ? 1 : 0,
        updated.countsToLeaderboard ? 1 : 0,
        updated.updatedAt,
        updated.id,
      )
    if (this.getStage().activityId === updated.id) this.events.emit("stage", this.getStage())
    this.events.emit("results", updated.id)
    // Its points move with it, or leave the leaderboard.
    if (updated.presentationId !== activity.presentationId) {
      if (activity.presentationId) this.events.emit("leaderboard", activity.presentationId)
      if (updated.presentationId) this.events.emit("leaderboard", updated.presentationId)
    } else if (updated.presentationId && updated.countsToLeaderboard !== activity.countsToLeaderboard) {
      this.events.emit("leaderboard", updated.presentationId)
    }
    return updated
  }

  deleteActivity(id: string): void {
    const activity = this.requireActivity(id)
    if (this.getStage().activityId === activity.id) this.clearStage()
    this.db.prepare("DELETE FROM activities WHERE id = ?").run(activity.id)
    this.clearRound(activity.id)
    this.deleteSecretSantaDraws(activity.id)
    if (activity.presentationId) this.events.emit("leaderboard", activity.presentationId)
  }

  /** Forgets how a round went: its draw, when it opened. Scores and answers are separate. */
  private clearRound(activityId: string) {
    for (const key of [`number-draw:${activityId}`, `quiz-draw:${activityId}`, `opened-at:${activityId}`])
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(key)
  }

  private assertSlugFree(slug: string) {
    if (!SLUG_PATTERN.test(slug)) throw new StoreError(400, "Slugs use lowercase letters, digits and dashes")
    if (this.getActivity(slug)) throw new StoreError(409, `The slug "${slug}" is already taken`)
  }

  // ---- presentations -------------------------------------------------------------------------

  listPresentations(): Presentation[] {
    const rows = this.db.prepare("SELECT * FROM presentations ORDER BY created_at DESC").all()
    return (rows as unknown as PresentationRow[]).map(toPresentation)
  }

  getPresentation(idOrSlug: string): Presentation | undefined {
    const row = this.db
      .prepare("SELECT * FROM presentations WHERE id = ? OR slug = ?")
      .get(idOrSlug, idOrSlug)
    return row ? toPresentation(row as unknown as PresentationRow) : undefined
  }

  requirePresentation(idOrSlug: string): Presentation {
    const presentation = this.getPresentation(idOrSlug)
    if (!presentation) throw new StoreError(404, `No presentation "${idOrSlug}"`)
    return presentation
  }

  createPresentation(input: { title: string; slug: string }): Presentation {
    this.assertPresentationSlugFree(input.slug)
    const presentation: Presentation = { id: randomUUID(), ...input, createdAt: Date.now() }
    this.db
      .prepare("INSERT INTO presentations (id, slug, title, created_at) VALUES (?, ?, ?, ?)")
      .run(presentation.id, presentation.slug, presentation.title, presentation.createdAt)
    return presentation
  }

  updatePresentation(idOrSlug: string, patch: { title?: string; slug?: string }): Presentation {
    const presentation = this.requirePresentation(idOrSlug)
    if (patch.slug !== undefined && patch.slug !== presentation.slug)
      this.assertPresentationSlugFree(patch.slug)
    const updated = {
      ...presentation,
      title: patch.title ?? presentation.title,
      slug: patch.slug ?? presentation.slug,
    }
    this.db
      .prepare("UPDATE presentations SET title = ?, slug = ? WHERE id = ?")
      .run(updated.title, updated.slug, updated.id)
    if (this.getStage().presentationId === updated.id) this.events.emit("stage", this.getStage())
    this.events.emit("leaderboard", updated.id)
    return updated
  }

  /** Deletes the presentation and its points; its activities stay, ungrouped. */
  deletePresentation(idOrSlug: string): void {
    const presentation = this.requirePresentation(idOrSlug)
    this.db.prepare("DELETE FROM presentations WHERE id = ?").run(presentation.id)
    if (this.getStage().presentationId === presentation.id) this.setStagePresentation(null)
  }

  /**
   * Deletes every answer, draw and point of the presentation's activities: a fresh start. A Secret
   * Santa is never part of one (see `offStageFields`), but one grouped before that rule stays
   * untouched: its letters and draw are not a game round.
   */
  resetPresentation(idOrSlug: string): void {
    const presentation = this.requirePresentation(idOrSlug)
    for (const activity of this.listActivities()) {
      if (activity.presentationId === presentation.id && activity.type !== secretSanta.type) {
        this.resetResponses(activity.id)
      }
    }
  }

  private assertPresentationSlugFree(slug: string) {
    if (!SLUG_PATTERN.test(slug)) throw new StoreError(400, "Slugs use lowercase letters, digits and dashes")
    if (this.getPresentation(slug)) throw new StoreError(409, `The slug "${slug}" is already taken`)
  }

  // ---- points ----------------------------------------------------------------------------

  /** Everyone with points in the presentation, best first, with competition ranks (1, 2, 2, 4). */
  private ranking(presentationId: string): (LeaderboardEntry & { userId: string })[] {
    const rows = this.db
      .prepare(
        `SELECT s.user_id AS userId, MAX(s.user_name) AS name, SUM(s.points) AS points
         FROM scores s JOIN activities a ON a.id = s.activity_id
         WHERE a.presentation_id = ? AND a.counts_to_leaderboard = 1
         GROUP BY s.user_id
         ORDER BY points DESC, name`,
      )
      .all(presentationId) as { userId: string; name: string; points: number }[]
    let rank = 0
    return rows.map((row, index) => {
      if (index === 0 || (rows[index - 1] as (typeof rows)[number]).points !== row.points) rank = index + 1
      return { ...row, rank }
    })
  }

  /** The leaderboard presentations show. Names come from the IdP; account ids stay private. */
  getLeaderboard(idOrSlug: string) {
    const presentation = this.requirePresentation(idOrSlug)
    return {
      id: presentation.id,
      slug: presentation.slug,
      title: presentation.title,
      leaderboard: this.ranking(presentation.id).map(({ rank, name, points }) => ({ rank, name, points })),
    }
  }

  /** The current presentation's top 3 and where `userId` stands, for the audience's idle moments. */
  getAudienceLeaderboard(userId: string): AudienceLeaderboard | null {
    const presentationId = this.getStage().presentationId
    const presentation = presentationId ? this.getPresentation(presentationId) : undefined
    if (!presentation) return null
    const ranking = this.ranking(presentation.id)
    const mine = ranking.find((entry) => entry.userId === userId)
    return {
      title: presentation.title,
      top: ranking.slice(0, 3).map(({ rank, name, points }) => ({ rank, name, points })),
      me: mine ? { rank: mine.rank, points: mine.points } : null,
      players: ranking.length,
    }
  }

  /** When answers opened this round; rounds opened before this was recorded use the first answer. */
  private openedAt(activityId: string, responses: StoredResponse[]) {
    return (
      this.getSetting<number>(`opened-at:${activityId}`) ??
      Math.min(Date.now(), ...responses.map((entry) => entry.updatedAt))
    )
  }

  /** Points for every answer: `accuracy` (0–1) of each, weighed by how soon it came. */
  private scoreResponses<Response>(
    activityId: string,
    accuracy: (entry: StoredResponse<Response>) => number,
  ): ScoreRow[] {
    const responses = this.listResponses(activityId) as StoredResponse<Response>[]
    const openedAt = this.openedAt(activityId, responses)
    return responses.map((entry) => ({
      userId: entry.userId,
      userName: entry.userName,
      points: scorePoints(accuracy(entry), entry.updatedAt - openedAt),
    }))
  }

  /** Replaces the activity's points. Call inside the transaction that decides it. */
  private saveScores(activityId: string, scores: ScoreRow[]) {
    this.db.prepare("DELETE FROM scores WHERE activity_id = ?").run(activityId)
    const insert = this.db.prepare(
      "INSERT INTO scores (activity_id, user_id, user_name, points) VALUES (?, ?, ?, ?)",
    )
    for (const score of scores) insert.run(activityId, score.userId, score.userName, score.points)
  }

  private scoresChanged(activity: Activity) {
    if (activity.presentationId) this.events.emit("leaderboard", activity.presentationId)
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
    const quizWinner: SavedDraw<MemoryQuizDraw> | null =
      activity.type === memoryQuiz.type &&
      quizScoring(activity.config as MemoryQuizConfig) === "first" &&
      isCorrect(activity.config as MemoryQuizConfig, parsed.data.answer)
        ? {
            answer: (activity.config as MemoryQuizConfig).acceptedAnswers[0] as string,
            winner: { name: user.name, answer: parsed.data.answer },
            winnerUserId: user.id,
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
        this.saveScores(
          activity.id,
          this.scoreResponses(activity.id, ({ userId }) => (userId === user.id ? 1 : 0)),
        )
        this.db.exec("COMMIT")
      }
    } catch (error) {
      if (quizWinner) this.db.exec("ROLLBACK")
      throw error
    }
    if (quizWinner) {
      this.events.emit("stage", this.getStage())
      this.scoresChanged(activity)
    }
    this.events.emit("results", activity.id)
    return parsed.data
  }

  resetResponses(idOrSlug: string): void {
    const activity = this.requireActivity(idOrSlug)
    this.db.prepare("DELETE FROM responses WHERE activity_id = ?").run(activity.id)
    this.db.prepare("DELETE FROM scores WHERE activity_id = ?").run(activity.id)
    this.clearRound(activity.id)
    this.deleteSecretSantaDraws(activity.id)
    // A new round starts counting from now if the activity is still open.
    const stage = this.getStage()
    if (stage.activityId === activity.id && stage.status === "open")
      this.setSetting(`opened-at:${activity.id}`, Date.now())
    this.events.emit("results", activity.id)
    this.scoresChanged(activity)
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
      results: [numberLottery.type, numberEstimate.type, memoryQuiz.type].includes(activity.type)
        ? {
            ...definition.aggregate(activity.config, this.listResponses(activity.id)),
            draw: publicDraw(this.getDraw(activity)),
          }
        : activity.type === secretSanta.type
          ? {
              ...definition.aggregate(activity.config, this.listResponses(activity.id)),
              drawn: Boolean(this.getSetting(`santa-draw:${activity.id}`)),
              gadgetDrawn: false,
            }
          : definition.aggregate(activity.config, this.listResponses(activity.id)),
    }
  }

  /** The saved outcome of a lottery, estimate or quiz, if it has been decided. */
  private getDraw(activity: Activity) {
    return this.getSetting<AnySavedDraw>(
      activity.type === memoryQuiz.type ? `quiz-draw:${activity.id}` : `number-draw:${activity.id}`,
    )
  }

  /** The decided outcome as `userId` sees it on their phone, or null while undecided. */
  getAudienceOutcome(activityId: string, userId: string): AudienceOutcome | null {
    const activity = this.getActivity(activityId)
    if (!activity || ![numberLottery.type, numberEstimate.type, memoryQuiz.type].includes(activity.type))
      return null
    const draw = this.getDraw(activity)
    if (!draw) return null
    const score = this.db
      .prepare("SELECT points FROM scores WHERE activity_id = ? AND user_id = ?")
      .get(activity.id, userId) as { points: number } | undefined
    return { draw: publicDraw(draw), youWon: draw.winnerUserId === userId, points: score?.points ?? null }
  }

  /**
   * Reveals the answer and scores the quiz: with points, every correct answer by speed and the
   * fastest wins; first-correct quizzes reach here only when nobody got it. Repeats return the
   * recorded outcome.
   */
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
    const withPoints = quizScoring(config) === "points"
    const right = (answer: string) => withPoints && isCorrect(config, answer)
    const fastest = (this.listResponses(activity.id) as StoredResponse<MemoryQuizResponse>[])
      .filter(({ response }) => right(response.answer))
      .sort((a, b) => a.updatedAt - b.updatedAt)
    const winner = fastest[0]
    const draw: SavedDraw<MemoryQuizDraw> = {
      answer: config.acceptedAnswers[0] as string,
      winner: winner ? { name: winner.userName, answer: winner.response.answer } : null,
      ...(withPoints ? { correct: fastest.length } : {}),
      winnerUserId: winner?.userId ?? null,
      drawnAt: Date.now(),
    }
    this.db.exec("BEGIN")
    try {
      this.setSetting(`quiz-draw:${activity.id}`, draw)
      this.setSetting("stage", { ...stage, status: "closed", changedAt: draw.drawnAt })
      this.saveScores(
        activity.id,
        this.scoreResponses<MemoryQuizResponse>(activity.id, ({ response }) =>
          right(response.answer) ? 1 : 0,
        ),
      )
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("stage", this.getStage())
    this.events.emit("results", activity.id)
    this.scoresChanged(activity)
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
      ({ userId, userName, response }) => ({ userId, name: userName, number: response.number }),
    )
    const { closest, distance } = closestEntries(entries, config.target)
    const winner = closest.length ? closest[randomInt(closest.length)] : undefined
    const draw: SavedDraw<NumberEstimateDraw> = {
      number: config.target,
      distance: entries.length ? distance : null,
      tied: closest.length,
      winner: winner ? { name: winner.name, number: winner.number } : null,
      winnerUserId: winner?.userId ?? null,
      drawnAt: Date.now(),
    }
    this.db.exec("BEGIN")
    try {
      this.setSetting(`number-draw:${activity.id}`, draw)
      this.setSetting("stage", { ...stage, status: "closed", changedAt: draw.drawnAt })
      this.saveScores(
        activity.id,
        this.scoreResponses<NumberEstimateResponse>(activity.id, ({ response }) =>
          estimateAccuracy(response.number, config.target),
        ),
      )
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("stage", this.getStage())
    this.events.emit("results", activity.id)
    this.scoresChanged(activity)
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
    numberLottery.configSchema.parse(activity.config)
    const entries = (this.listResponses(activity.id) as StoredResponse<NumberLotteryResponse>[]).map(
      ({ userId, userName, response }) => ({ userId, name: userName, number: response.number }),
    )
    if (!entries.length) throw new StoreError(409, "At least one participant is required")
    const number = randomInt(0, 101)
    const { closest, distance } = closestEntries(entries, number)
    const winner = closest[randomInt(closest.length)] as (typeof closest)[number]
    const draw: SavedDraw<NumberLotteryDraw> = {
      number,
      distance,
      closest: closest.map(({ name, number }) => ({ name, number })),
      winners: [{ name: winner.name, number: winner.number }],
      winnerUserId: winner.userId,
      drawnAt: Date.now(),
    }
    const closed: Stage = { ...stage, status: "closed", changedAt: draw.drawnAt }
    this.db.exec("BEGIN")
    try {
      this.setSetting(`number-draw:${activity.id}`, draw)
      this.setSetting("stage", closed)
      // Luck decides the winner; points still reward guessing close, and early.
      this.saveScores(
        activity.id,
        this.scoreResponses<NumberLotteryResponse>(
          activity.id,
          ({ response }) => 1 - Math.abs(response.number - number) / 100,
        ),
      )
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("stage", closed)
    this.events.emit("results", activity.id)
    this.scoresChanged(activity)
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
  joinSecretSanta(
    idOrSlug: string,
    user: { id: string; name: string; email?: string },
    entry: unknown,
  ): SecretSantaView {
    const { activity, config } = this.requireVisibleSecretSanta(idOrSlug)
    const parsed = secretSanta.responseSchema(config).safeParse(entry)
    if (!parsed.success) throw new StoreError(400, "Invalid entry", parsed.error.issues)
    const existing = this.getResponse(activity.id, user.id) as SecretSantaEntry | null
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    const drawn = Boolean(draw)
    // Once the draw is out a Santa may already be shopping from the letter: it stays as it was.
    if (existing && draw && !draw.held) {
      throw new StoreError(409, "Dopo l'estrazione la letterina non si può più modificare")
    }
    if (!existing && (!signupsOpenAt(config, Date.now()) || drawn)) {
      throw new StoreError(409, "Le iscrizioni sono chiuse")
    }
    const data = parsed.data
    const archived = this.getSetting<Record<string, SantaArchived>>(`santa-archived:${activity.id}`) ?? {}
    const wasArchived = Object.hasOwn(archived, user.id)
    delete archived[user.id]
    this.db.exec("BEGIN")
    try {
      this.db
        .prepare(
          `INSERT INTO responses (activity_id, user_id, user_name, response, updated_at, user_email)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (activity_id, user_id) DO UPDATE SET
           user_name = excluded.user_name, response = excluded.response, updated_at = excluded.updated_at,
           user_email = coalesce(excluded.user_email, responses.user_email)`,
        )
        .run(activity.id, user.id, user.name, JSON.stringify(data), Date.now(), user.email ?? null)
      // Signing up again themselves: they are no longer a former participant.
      if (wasArchived) this.setSetting(`santa-archived:${activity.id}`, archived)
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("results", activity.id)
    return this.secretSantaView(activity, config, user.id)
  }

  /** The person leaves. After the draw only whoever was giving them a gift gets a new match. */
  withdrawSecretSanta(idOrSlug: string, userId: string): SecretSantaView {
    const { activity, config } = this.requireVisibleSecretSanta(idOrSlug)
    this.removeSecretSantaEntry(activity.id, userId)
    return this.secretSantaView(activity, config, userId)
  }

  confirmSecretSantaGift(idOrSlug: string, userId: string, now = Date.now()): SecretSantaView {
    const { activity, config } = this.requireVisibleSecretSanta(idOrSlug)
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    if (!draw || draw.held || !draw.assignments[userId] || !this.getResponse(activity.id, userId)) {
      throw new StoreError(409, "Non hai un regalo da confermare per questo giro")
    }
    const confirmed = this.getSetting<Record<string, number>>(`santa-confirmed:${activity.id}`) ?? {}
    if (!Object.hasOwn(confirmed, userId)) {
      const closesAt = confirmationClosesAt(config.confirmationDueAt)
      if (closesAt !== null && now >= closesAt)
        throw new StoreError(409, "Il termine per confermare il regalo è scaduto")
      confirmed[userId] = now
      this.setSetting(`santa-confirmed:${activity.id}`, confirmed)
      this.events.emit("results", activity.id)
    }
    return this.secretSantaView(activity, config, userId)
  }

  /** Admin: takes someone out, exactly as if they had withdrawn. */
  removeSecretSantaParticipant(
    idOrSlug: string,
    userId: string,
    actor?: SantaAdminActor,
    input?: { reason: string; revision?: string },
  ) {
    const { activity } = this.requireSecretSanta(idOrSlug)
    if (input?.revision) this.assertSantaAdminRevision(activity.id, input.revision)
    if (!this.getResponse(activity.id, userId)) throw new StoreError(404, "Non risulti iscritto")
    this.removeSecretSantaEntries(
      activity.id,
      [userId],
      actor ? "admin" : "withdrawn",
      Date.now(),
      actor ? { actor, reason: input?.reason ?? "Rimozione dagli organizzatori" } : undefined,
    )
    return this.getSecretSantaAdmin(activity.id)
  }

  /** One random gift cycle among everyone signed up. Closes sign-ups; idempotent. */
  drawSecretSanta(idOrSlug: string, actor?: SantaAdminActor, now = Date.now()) {
    const { activity, config } = this.requireSecretSanta(idOrSlug)
    if (!this.getSetting(`santa-draw:${activity.id}`)) {
      const ids = this.listResponses(activity.id).map(({ userId }) => userId)
      if (ids.length < 2) throw new StoreError(409, "At least two people must sign up first")
      const draw: SecretSantaDraw = {
        drawnAt: now,
        assignments: buildCycle(ids, (size) => randomInt(size)),
        held:
          !revealDueAt(config, now) ||
          (Boolean(config.revealAt) && draftMissedConfirmationWindow(config, now)),
      }
      this.db.exec("BEGIN")
      try {
        this.setSetting(`santa-draw:${activity.id}`, draw)
        if (actor) {
          const people = this.listResponses(activity.id)
          this.recordSantaAdminAction(
            activity.id,
            actor,
            "Estrazione regali",
            "Estrazione manuale dal pannello admin",
            people.map((p) => ({
              userId: p.userId,
              name: p.userName,
              field: "Destinatario",
              before: null,
              after: people.find((r) => r.userId === draw.assignments[p.userId])?.userName ?? null,
            })),
          )
        }
        this.db.exec("COMMIT")
      } catch (error) {
        this.db.exec("ROLLBACK")
        throw error
      }
      this.events.emit("results", activity.id)
    }
    return this.getResults(activity.id)
  }

  /**
   * Admin: throws the gift draw away and reopens sign-ups (per the config dates), keeping everyone's
   * letter. Emails already sent stay sent; after the next draw everyone is emailed again.
   */
  undoSecretSantaDraw(idOrSlug: string, actor?: SantaAdminActor) {
    const { activity } = this.requireSecretSanta(idOrSlug)
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    const people = this.listResponses(activity.id)
    this.db.exec("BEGIN")
    try {
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-draw:${activity.id}`)
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-mail:${activity.id}`)
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-reassign:${activity.id}`)
      // The archive of former participants survives, so they can still be readmitted.
      for (const key of ["confirmed", "warnings", "removed", "letter-edited"]) {
        this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-${key}:${activity.id}`)
      }
      if (actor && draw)
        this.recordSantaAdminAction(
          activity.id,
          actor,
          "Annullamento estrazione",
          "Annullamento richiesto dal pannello admin",
          people.map((p) => ({
            userId: p.userId,
            name: p.userName,
            field: "Destinatario",
            before: people.find((r) => r.userId === draw.assignments[p.userId])?.userName ?? null,
            after: null,
          })),
        )
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("results", activity.id)
    return this.getSecretSantaAdmin(activity.id)
  }

  /**
   * Admin: sends the draw emails now instead of waiting for `revealAt`, and shows everyone who
   * they give a gift to. Idempotent.
   */
  releaseSecretSantaDraw(idOrSlug: string, actor: SantaAdminActor) {
    const { activity, config } = this.requireSecretSanta(idOrSlug)
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    if (!draw) throw new StoreError(409, "Prima esegui l'estrazione dei regali")
    if (draw.held) {
      if (draftMissedConfirmationWindow(config, Date.now()))
        throw new StoreError(409, "Imposta una nuova scadenza di conferma prima di inviare l'estrazione")
      this.db.exec("BEGIN")
      try {
        this.setSetting(`santa-draw:${activity.id}`, { ...draw, held: false })
        this.recordSantaAdminAction(
          activity.id,
          actor,
          "Invio estrazione",
          "Invio anticipato dal pannello admin",
          [],
        )
        this.db.exec("COMMIT")
      } catch (error) {
        this.db.exec("ROLLBACK")
        throw error
      }
      this.events.emit("results", activity.id)
    }
    return this.getSecretSantaAdmin(activity.id)
  }

  /** Gadget entries are retained, but extraction is paused. */
  drawSecretSantaGadget(idOrSlug: string): never {
    this.requireSecretSanta(idOrSlug)
    throw new StoreError(409, "L'estrazione del gadget è sospesa: per ora raccogliamo solo le adesioni")
  }

  /** Complete operational view, returned only through the admin-authenticated routes. */
  getSecretSantaAdmin(idOrSlug: string) {
    const { activity } = this.requireSecretSanta(idOrSlug)
    const responses = this.listResponses(activity.id) as StoredResponse<SecretSantaEntry>[]
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    const gadget = this.getSetting<SecretSantaGadgetDraw>(`santa-gadget:${activity.id}`)
    const nameOf = (userId: string) => responses.find((r) => r.userId === userId)?.userName ?? "(withdrawn)"
    const emails = this.secretSantaEmails(activity.id)
    const sent = new Set(this.getSetting<string[]>(`santa-mail:${activity.id}`) ?? [])
    const confirmations = this.getSetting<Record<string, number>>(`santa-confirmed:${activity.id}`) ?? {}
    const removed = this.getSetting<Record<string, SantaRemoval>>(`santa-removed:${activity.id}`) ?? {}
    const participants = responses
      .map(({ userId, userName, response }) => {
        const receiverId = draw?.assignments[userId]
        const giver = draw && responses.find((p) => draw.assignments[p.userId] === userId)
        return {
          userId,
          name: userName,
          email: emails.get(userId) ?? null,
          entry: response,
          gadget: response.gadget,
          giftConfirmedAt: confirmations[userId] ?? null,
          hasMatch: draw ? Boolean(receiverId) : null,
          match: receiverId ? { userId: receiverId, name: nameOf(receiverId) } : null,
          giver: giver ? { userId: giver.userId, name: giver.userName } : null,
          drawEmailSent: sent.has(userId),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    const archived = this.getSetting<Record<string, SantaArchived>>(`santa-archived:${activity.id}`) ?? {}
    const letterEdited = this.getSetting<Record<string, number>>(`santa-letter-edited:${activity.id}`) ?? {}
    const active = new Set(responses.map((r) => r.userId))
    const formerParticipants = [
      ...Object.entries(archived).map(([userId, p]) => ({
        userId,
        name: p.name,
        email: p.email ?? null,
        reason: p.reason,
        at: p.at,
        entry: p.entry as SecretSantaEntry | null,
      })),
      // Removals recorded before the archive existed: the letter was not kept.
      ...Object.entries(removed)
        .filter(([userId]) => !Object.hasOwn(archived, userId))
        .map(([userId, p]) => ({
          userId,
          name: p.name,
          email: p.email ?? null,
          reason: "unconfirmed" as SantaLeaveReason,
          at: p.at,
          entry: null,
        })),
    ]
      .filter((p) => !active.has(p.userId))
      .sort((a, b) => b.at - a.at || a.name.localeCompare(b.name))
    const revision = createHash("sha256")
      .update(
        JSON.stringify({
          config: activity.config,
          participants: participants.map(({ drawEmailSent: _, ...p }) => p),
          draw,
          removed: Object.fromEntries(
            Object.entries(removed).map(([id, { sentAt: _, ...person }]) => [id, person]),
          ),
          archived,
          letterEdited,
        }),
      )
      .digest("hex")
    const history = this.db
      .prepare(
        "SELECT * FROM secret_santa_admin_actions WHERE activity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50",
      )
      .all(activity.id) as {
      id: string
      actor_name: string
      kind: string
      reason: string
      changes: string
      created_at: number
    }[]
    return {
      revision,
      counters: {
        active: participants.length,
        confirmed: participants.filter((p) => p.giftConfirmedAt !== null).length,
        pending: participants.filter((p) => p.hasMatch && p.giftConfirmedAt === null).length,
        unmatched: participants.filter((p) => p.hasMatch === false).length,
        removed: Object.keys(removed).length,
        former: formerParticipants.length,
        gadget: participants.filter((p) => p.gadget).length,
      },
      history: history.map((row) => ({
        id: row.id,
        actor: row.actor_name,
        kind: row.kind,
        reason: row.reason,
        at: row.created_at,
        changes: JSON.parse(row.changes) as SantaAdminChange[],
      })),
      drawnAt: draw?.drawnAt ?? null,
      /** The pairings are a draft: no email has gone out and participants cannot see them yet. */
      held: Boolean(draw?.held),
      removed: Object.entries(removed).map(([userId, p]) => ({ userId, name: p.name, at: p.at })),
      /** Who withdrew or was removed and is not active now, newest first: they can be readmitted. */
      formerParticipants,
      /** How many signed-up people have no email address, and how many draw emails went out. */
      withoutEmail: responses.filter(({ userId }) => !emails.get(userId)).length,
      emailsSent: responses.filter(({ userId }) => sent.has(userId)).length,
      participants,
      gadget: gadget
        ? { drawnAt: gadget.drawnAt, winners: gadget.winners.map((id) => ({ userId: id, name: nameOf(id) })) }
        : null,
    }
  }

  private assertSantaAdminRevision(activityId: string, revision: string) {
    if (this.getSecretSantaAdmin(activityId).revision !== revision)
      throw new StoreError(409, "La situazione è cambiata. Ricarica i dati prima di salvare la correzione.")
  }

  private recordSantaAdminAction(
    activityId: string,
    actor: SantaAdminActor,
    kind: string,
    reason: string,
    changes: SantaAdminChange[],
  ) {
    this.db
      .prepare(
        "INSERT INTO secret_santa_admin_actions (id, activity_id, actor_id, actor_name, kind, reason, changes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), activityId, actor.id, actor.name, kind, reason, JSON.stringify(changes), Date.now())
  }

  updateSecretSantaAssignments(
    idOrSlug: string,
    actor: SantaAdminActor,
    input: { revision: string; reason: string; assignments: Record<string, string | null> },
  ) {
    const { activity } = this.requireSecretSanta(idOrSlug)
    this.assertSantaAdminRevision(activity.id, input.revision)
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    if (!draw) throw new StoreError(409, "Prima esegui l'estrazione dei regali")
    const people = this.listResponses(activity.id)
    const ids = people.map((p) => p.userId)
    const keys = Object.keys(input.assignments)
    if (keys.length !== ids.length || keys.some((id) => !ids.includes(id)))
      throw new StoreError(400, "Devi includere esattamente tutti i partecipanti attivi")
    if (ids.length <= 1) {
      if (ids.some((id) => input.assignments[id] !== null))
        throw new StoreError(400, "Non puoi assegnare una persona a sé stessa")
    } else {
      const seen = new Set<string>()
      let current = ids[0] as string
      while (!seen.has(current)) {
        if (!ids.includes(current)) throw new StoreError(400, "Il destinatario non partecipa a questo giro")
        seen.add(current)
        const next = input.assignments[current]
        if (!next || next === current)
          throw new StoreError(400, "Ogni persona deve avere un destinatario diverso da sé")
        current = next
      }
      if (seen.size !== ids.length || current !== ids[0])
        throw new StoreError(400, "Gli abbinamenti devono formare un unico giro, senza destinatari duplicati")
    }
    const changes = people
      .filter((p) => draw.assignments[p.userId] !== input.assignments[p.userId])
      .map((p) => ({
        userId: p.userId,
        name: p.userName,
        field: "Destinatario",
        before: people.find((r) => r.userId === draw.assignments[p.userId])?.userName ?? null,
        after: people.find((r) => r.userId === input.assignments[p.userId])?.userName ?? null,
      }))
    if (!changes.length) return this.getSecretSantaAdmin(activity.id)
    const notices = this.getSetting<SecretSantaReassignNotice[]>(`santa-reassign:${activity.id}`) ?? []
    const sent = new Set(this.getSetting<string[]>(`santa-mail:${activity.id}`) ?? [])
    for (const change of changes) {
      const old = notices.find((n) => n.giverId === change.userId)
      const index = notices.findIndex((n) => n.giverId === change.userId)
      if (index >= 0) notices.splice(index, 1)
      if (sent.has(change.userId))
        notices.push({
          giverId: change.userId,
          withdrawnName: old?.withdrawnName ?? change.before ?? "",
          reason: "admin",
          at: Math.max(Date.now(), (old?.at ?? 0) + 1),
        })
    }
    this.db.exec("BEGIN")
    try {
      this.setSetting(`santa-draw:${activity.id}`, { ...draw, assignments: input.assignments })
      this.setSetting(`santa-reassign:${activity.id}`, notices)
      this.recordSantaAdminAction(activity.id, actor, "Abbinamenti", input.reason, changes)
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("results", activity.id)
    return this.getSecretSantaAdmin(activity.id)
  }

  updateSecretSantaConfirmation(
    idOrSlug: string,
    userId: string,
    actor: SantaAdminActor,
    input: { revision: string; reason: string; confirmed: boolean },
  ) {
    const { activity } = this.requireSecretSanta(idOrSlug)
    this.assertSantaAdminRevision(activity.id, input.revision)
    const person = this.listResponses(activity.id).find((p) => p.userId === userId)
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    if (!person) throw new StoreError(404, "La persona non partecipa a questo giro")
    if (!draw?.assignments[userId]) throw new StoreError(409, "Questa persona non ha un regalo da confermare")
    const confirmations = this.getSetting<Record<string, number>>(`santa-confirmed:${activity.id}`) ?? {}
    const wasConfirmed = confirmations[userId] !== undefined
    if (wasConfirmed === input.confirmed) return this.getSecretSantaAdmin(activity.id)
    if (input.confirmed) confirmations[userId] = Date.now()
    else delete confirmations[userId]
    this.db.exec("BEGIN")
    try {
      this.setSetting(`santa-confirmed:${activity.id}`, confirmations)
      this.recordSantaAdminAction(activity.id, actor, "Conferma regalo", input.reason, [
        {
          userId,
          name: person.userName,
          field: "Conferma regalo",
          before: wasConfirmed ? "Confermato" : "Da confermare",
          after: input.confirmed ? "Confermato" : "Da confermare",
        },
      ])
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("results", activity.id)
    return this.getSecretSantaAdmin(activity.id)
  }

  /**
   * Admin: brings back someone who withdrew or was removed. After the draw they join the cycle right
   * after `giverId`, who now gives them a gift; they give one to whoever `giverId` had. Nobody else changes.
   */
  readmitSecretSantaParticipant(
    idOrSlug: string,
    userId: string,
    actor: SantaAdminActor,
    input: { revision: string; reason: string; entry: unknown; giverId?: string | null; confirmed: boolean },
  ) {
    const { activity, config } = this.requireSecretSanta(idOrSlug)
    this.assertSantaAdminRevision(activity.id, input.revision)
    const now = Date.now()
    const people = this.listResponses(activity.id)
    if (people.some((p) => p.userId === userId))
      throw new StoreError(409, "Questa persona partecipa già a questo giro")
    const archived = this.getSetting<Record<string, SantaArchived>>(`santa-archived:${activity.id}`) ?? {}
    const removed = this.getSetting<Record<string, SantaRemoval>>(`santa-removed:${activity.id}`) ?? {}
    // Plain objects from JSON: an id like "constructor" must not resolve to an inherited member.
    const archivedRecord = Object.hasOwn(archived, userId) ? archived[userId] : undefined
    const removal = Object.hasOwn(removed, userId) ? removed[userId] : undefined
    const former = archivedRecord ?? removal
    if (!former) throw new StoreError(404, "Questa persona non risulta tra i rimossi o ritirati")
    const formerReason: SantaLeaveReason = archivedRecord?.reason ?? "unconfirmed"
    const parsed = secretSanta.responseSchema(config).safeParse(input.entry)
    if (!parsed.success) throw new StoreError(400, "Letterina non valida", parsed.error.issues)
    const entry = parsed.data
    const giverId = input.giverId ?? null
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
    const nameOf = (id: string | null | undefined) =>
      id === userId ? former.name : (people.find((p) => p.userId === id)?.userName ?? null)

    let assignments: Record<string, string | null> | null = null
    let previousReceiver: string | null = null
    if (!draw) {
      if (giverId !== null)
        throw new StoreError(400, "Prima dell'estrazione non si sceglie chi farà il regalo a questa persona")
    } else if (!people.length) {
      if (giverId !== null)
        throw new StoreError(400, "Non ci sono partecipanti attivi che possano fare il regalo")
      assignments = { ...draw.assignments, [userId]: null }
    } else {
      if (giverId === null) throw new StoreError(400, "Scegli chi farà il regalo a questa persona")
      if (!people.some((p) => p.userId === giverId))
        throw new StoreError(400, "Chi fa il regalo deve partecipare a questo giro")
      previousReceiver = draw.assignments[giverId] ?? null
      assignments = { ...draw.assignments, [giverId]: userId, [userId]: previousReceiver ?? giverId }
      if (!isSingleCycle([...people.map((p) => p.userId), userId], assignments))
        throw new StoreError(
          409,
          "Gli abbinamenti attuali non formano un unico giro: correggili prima di riammettere questa persona",
        )
    }
    const willMatch = Boolean(assignments?.[userId])
    if (input.confirmed && !willMatch)
      throw new StoreError(409, "Questa persona non ha un regalo da confermare")
    const closesAt = confirmationClosesAt(config.confirmationDueAt)
    const deadlinePassed = closesAt !== null && now >= closesAt
    if (deadlinePassed && willMatch && !input.confirmed)
      throw new StoreError(
        409,
        "La scadenza per confermare il regalo è passata: per riammettere questa persona segna il regalo come già preso",
      )

    const confirmations = this.getSetting<Record<string, number>>(`santa-confirmed:${activity.id}`) ?? {}
    if (input.confirmed) confirmations[userId] = now
    else delete confirmations[userId]
    // A Santa who had nobody gains a match too and could never have confirmed: after the deadline the
    // midnight job would remove them, so the organizer's confirmation covers both of them.
    const confirmGiver =
      deadlinePassed &&
      giverId !== null &&
      previousReceiver === null &&
      !Object.hasOwn(confirmations, giverId)
        ? giverId
        : null
    if (confirmGiver !== null) confirmations[confirmGiver] = now
    const warnings = this.getSetting<Record<string, SantaWarning>>(`santa-warnings:${activity.id}`) ?? {}
    delete warnings[userId]
    delete removed[userId]
    delete archived[userId]
    const letterEdited = this.getSetting<Record<string, number>>(`santa-letter-edited:${activity.id}`) ?? {}
    delete letterEdited[userId]

    const notices = this.getSetting<SecretSantaReassignNotice[]>(`santa-reassign:${activity.id}`) ?? []
    const sent = new Set(this.getSetting<string[]>(`santa-mail:${activity.id}`) ?? [])
    const notify = (id: string, withdrawnName: string) => {
      const index = notices.findIndex((n) => n.giverId === id)
      const old = index >= 0 ? notices[index] : undefined
      if (index >= 0) notices.splice(index, 1)
      if (sent.has(id))
        notices.push({
          giverId: id,
          withdrawnName: old?.withdrawnName ?? withdrawnName,
          reason: "admin",
          at: Math.max(now, (old?.at ?? 0) + 1),
        })
    }
    // Someone never emailed gets the ordinary draw email instead, from pendingSecretSantaMails.
    if (giverId !== null) notify(giverId, nameOf(previousReceiver) ?? "")
    if (willMatch) notify(userId, "")

    const changes: SantaAdminChange[] = [
      {
        userId,
        name: former.name,
        field: "Partecipazione",
        before: LEAVE_LABELS[formerReason],
        after: "Attivo",
      },
    ]
    if (assignments && giverId !== null)
      changes.push({
        userId: giverId,
        name: nameOf(giverId) ?? "",
        field: "Destinatario",
        before: nameOf(previousReceiver),
        after: former.name,
      })
    if (assignments?.[userId])
      changes.push({
        userId,
        name: former.name,
        field: "Destinatario",
        before: null,
        after: nameOf(assignments[userId]),
      })
    changes.push(...entryChanges(userId, former.name, archivedRecord?.entry ?? null, entry))
    if (input.confirmed)
      changes.push({
        userId,
        name: former.name,
        field: "Conferma regalo",
        before: "Da confermare",
        after: "Confermato",
      })
    if (confirmGiver !== null)
      changes.push({
        userId: confirmGiver,
        name: nameOf(confirmGiver) ?? "",
        field: "Conferma regalo",
        before: "Da confermare",
        after: "Confermato",
      })

    this.db.exec("BEGIN")
    try {
      this.db
        .prepare(
          `INSERT INTO responses (activity_id, user_id, user_name, response, updated_at, user_email)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(activity.id, userId, former.name, JSON.stringify(entry), now, former.email ?? null)
      if (draw && assignments) {
        this.setSetting(`santa-draw:${activity.id}`, { ...draw, assignments })
        this.setSetting(`santa-reassign:${activity.id}`, notices)
      }
      this.setSetting(`santa-confirmed:${activity.id}`, confirmations)
      this.setSetting(`santa-warnings:${activity.id}`, warnings)
      this.setSetting(`santa-removed:${activity.id}`, removed)
      this.setSetting(`santa-archived:${activity.id}`, archived)
      this.setSetting(`santa-letter-edited:${activity.id}`, letterEdited)
      this.recordSantaAdminAction(activity.id, actor, "Riammissione", input.reason, changes)
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("results", activity.id)
    return this.getSecretSantaAdmin(activity.id)
  }

  /** Admin: corrects an active participant's letter. Their Santa sees that it was updated, no email. */
  updateSecretSantaEntry(
    idOrSlug: string,
    userId: string,
    actor: SantaAdminActor,
    input: { revision: string; reason: string; entry: unknown },
  ) {
    const { activity, config } = this.requireSecretSanta(idOrSlug)
    this.assertSantaAdminRevision(activity.id, input.revision)
    const person = (this.listResponses(activity.id) as StoredResponse<SecretSantaEntry>[]).find(
      (p) => p.userId === userId,
    )
    if (!person) throw new StoreError(404, "La persona non partecipa a questo giro")
    const parsed = secretSanta.responseSchema(config).safeParse(input.entry)
    if (!parsed.success) throw new StoreError(400, "Letterina non valida", parsed.error.issues)
    const changes = entryChanges(userId, person.userName, person.response, parsed.data)
    if (!changes.length) return this.getSecretSantaAdmin(activity.id)
    const now = Date.now()
    const drawn = Boolean(this.getSetting(`santa-draw:${activity.id}`))
    const letterEdited = this.getSetting<Record<string, number>>(`santa-letter-edited:${activity.id}`) ?? {}
    letterEdited[userId] = now
    this.db.exec("BEGIN")
    try {
      this.db
        .prepare("UPDATE responses SET response = ?, updated_at = ? WHERE activity_id = ? AND user_id = ?")
        .run(JSON.stringify(parsed.data), now, activity.id, userId)
      if (drawn) this.setSetting(`santa-letter-edited:${activity.id}`, letterEdited)
      this.recordSantaAdminAction(activity.id, actor, "Letterina", input.reason, changes)
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    this.events.emit("results", activity.id)
    return this.getSecretSantaAdmin(activity.id)
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
    if (!this.getResponse(activityId, userId)) throw new StoreError(404, "Non risulti iscritto")
    this.removeSecretSantaEntries(activityId, [userId], "withdrawn", Date.now())
  }

  private removeSecretSantaEntries(
    activityId: string,
    userIds: string[],
    reason: "withdrawn" | "unconfirmed" | "admin",
    now: number,
    manual?: { actor: SantaAdminActor; reason: string },
  ) {
    const responses = this.listResponses(activityId)
    const removedIds = new Set(userIds)
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activityId}`)
    const gadget = this.getSetting<SecretSantaGadgetDraw>(`santa-gadget:${activityId}`)
    let assignments = draw?.assignments ?? {}
    for (const id of userIds) assignments = withdrawFromCycle(assignments, id)
    const previousNotices = this.getSetting<SecretSantaReassignNotice[]>(`santa-reassign:${activityId}`) ?? []
    const notices = previousNotices.filter((notice) => !removedIds.has(notice.giverId))
    const sent = new Set(this.getSetting<string[]>(`santa-mail:${activityId}`) ?? [])
    for (const [giverId, target] of Object.entries(assignments)) {
      const oldTarget = draw?.assignments[giverId]
      if (oldTarget === target || !sent.has(giverId)) continue
      const oldNotice = notices.find((n) => n.giverId === giverId)
      const at = Math.max(now, (oldNotice?.at ?? 0) + 1)
      const withdrawnName =
        oldNotice?.withdrawnName ?? responses.find((r) => r.userId === oldTarget)?.userName ?? "Una persona"
      const noticeReason = oldNotice ? (oldNotice.reason ?? "withdrawn") : reason
      const index = notices.findIndex((n) => n.giverId === giverId)
      if (index >= 0) notices.splice(index, 1)
      notices.push({
        giverId,
        withdrawnName,
        at,
        ...(noticeReason !== "withdrawn" ? { reason: noticeReason } : {}),
      })
    }
    const emails = this.secretSantaEmails(activityId)
    const archived = this.getSetting<Record<string, SantaArchived>>(`santa-archived:${activityId}`) ?? {}
    for (const person of responses) {
      if (!removedIds.has(person.userId)) continue
      archived[person.userId] = {
        name: person.userName,
        email: emails.get(person.userId),
        entry: person.response as SecretSantaEntry,
        reason,
        at: now,
      }
    }
    const removed = this.getSetting<Record<string, SantaRemoval>>(`santa-removed:${activityId}`) ?? {}
    if (reason === "unconfirmed") {
      const { config } = this.requireSecretSanta(activityId)
      const closesAt = confirmationClosesAt(config.confirmationDueAt)
      if (closesAt === null) throw new StoreError(409, "Manca la scadenza di conferma")
      for (const userId of userIds) {
        const person = responses.find((r) => r.userId === userId)
        if (person)
          removed[userId] = {
            closesAt,
            at: now,
            name: person.userName,
            email: emails.get(userId),
            deadline: config.confirmationDueAt,
            sentAt: null,
          }
      }
    }
    this.db.exec("BEGIN")
    try {
      for (const id of userIds)
        this.db.prepare("DELETE FROM responses WHERE activity_id = ? AND user_id = ?").run(activityId, id)
      if (draw) {
        this.setSetting(`santa-draw:${activityId}`, { ...draw, assignments })
        this.setSetting(`santa-reassign:${activityId}`, notices)
      }
      if (reason === "unconfirmed") this.setSetting(`santa-removed:${activityId}`, removed)
      this.setSetting(`santa-archived:${activityId}`, archived)
      if (gadget)
        this.setSetting(`santa-gadget:${activityId}`, {
          ...gadget,
          winners: gadget.winners.filter((id) => !removedIds.has(id)),
        })
      if (manual)
        this.recordSantaAdminAction(
          activityId,
          manual.actor,
          "Rimozione",
          manual.reason,
          responses
            .filter((p) => removedIds.has(p.userId))
            .map((p) => ({
              userId: p.userId,
              name: p.userName,
              field: "Partecipazione",
              before: "Attivo",
              after: "Rimosso",
            })),
        )
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
    // A held draw is a draft for the admins: participants keep waiting as if nothing was drawn.
    const out = Boolean(draw && !draw.held)
    const receiverId = mine && draw && out ? (draw.assignments[userId] ?? null) : null
    const receiver = receiverId ? responses.find((r) => r.userId === receiverId) : undefined
    const removed = this.getSetting<Record<string, SantaRemoval>>(`santa-removed:${activity.id}`)?.[userId]
    return {
      id: activity.id,
      title: activity.title,
      config,
      participants: responses.length,
      drawn: out,
      gadgetDrawn: false,
      canJoin: signupsOpenAt(config, Date.now()) && !draw,
      hasEmail: Boolean(this.secretSantaEmails(activity.id).get(userId)),
      entry: mine?.response ?? null,
      match: receiver
        ? {
            name: receiver.userName,
            likes: receiver.response.likes,
            dislikes: receiver.response.dislikes,
            editedAt:
              this.getSetting<Record<string, number>>(`santa-letter-edited:${activity.id}`)?.[
                receiver.userId
              ] ?? null,
          }
        : null,
      gadgetWon: null,
      giftConfirmedAt:
        this.getSetting<Record<string, number>>(`santa-confirmed:${activity.id}`)?.[userId] ?? null,
      confirmationClosesAt: confirmationClosesAt(config.confirmationDueAt),
      removed: removed ? { at: removed.at, reason: "unconfirmed" } : null,
    }
  }

  private secretSantaEmails(activityId: string): Map<string, string> {
    const rows = this.db
      .prepare("SELECT user_id, user_email FROM responses WHERE activity_id = ? AND user_email IS NOT NULL")
      .all(activityId) as { user_id: string; user_email: string }[]
    return new Map(rows.map((row) => [row.user_id, row.user_email]))
  }

  /** Runs the gift draws whose time has come. Returns the ids of the activities it drew. */
  runSecretSantaSchedule(now = Date.now()): string[] {
    const drawn: string[] = []
    for (const activity of this.listActivities()) {
      if (activity.type !== secretSanta.type || this.getSetting(`santa-draw:${activity.id}`)) continue
      const config = secretSanta.configSchema.safeParse(activity.config)
      if (!config.success || !drawDueAt(config.data, now)) continue
      if (this.listResponses(activity.id).length < 2) continue
      this.drawSecretSanta(activity.id, undefined, now)
      drawn.push(activity.id)
    }
    return drawn
  }

  /** Releases due drafts that still have time before the confirmation reminder. */
  releaseDueSecretSantaDraws(now = Date.now()): string[] {
    const released: string[] = []
    for (const activity of this.listActivities()) {
      if (activity.type !== secretSanta.type) continue
      const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
      const config = secretSanta.configSchema.safeParse(activity.config)
      if (!draw?.held || !config.success || !revealDueAt(config.data, now)) continue
      if (draftMissedConfirmationWindow(config.data, now)) continue
      this.setSetting(`santa-draw:${activity.id}`, { ...draw, held: false })
      this.events.emit("results", activity.id)
      released.push(activity.id)
    }
    return released
  }

  /** Queues the final reminder, then atomically removes non-confirmed participants at midnight. */
  runSecretSantaConfirmationSchedule(now = Date.now()) {
    for (const activity of this.listActivities()) {
      if (activity.type !== secretSanta.type) continue
      const config = secretSanta.configSchema.parse(activity.config)
      const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
      const closesAt = confirmationClosesAt(config.confirmationDueAt)
      if (!draw || draw.held || closesAt === null || now < Date.parse(config.confirmationDueAt)) continue
      const confirmed = this.getSetting<Record<string, number>>(`santa-confirmed:${activity.id}`) ?? {}
      const missing = this.listResponses(activity.id).filter(
        (r) => draw.assignments[r.userId] && !Object.hasOwn(confirmed, r.userId),
      )
      if (now >= closesAt) {
        if (missing.length)
          this.removeSecretSantaEntries(
            activity.id,
            missing.map((r) => r.userId),
            "unconfirmed",
            now,
          )
      } else {
        const warnings = this.getSetting<Record<string, SantaWarning>>(`santa-warnings:${activity.id}`) ?? {}
        for (const { userId } of missing) {
          if (warnings[userId]?.deadline !== config.confirmationDueAt)
            warnings[userId] = { deadline: config.confirmationDueAt, sentAt: null }
        }
        this.setSetting(`santa-warnings:${activity.id}`, warnings)
      }
    }
  }

  pendingSecretSantaStatusMails(now = Date.now()): SecretSantaStatusMail[] {
    const mails: SecretSantaStatusMail[] = []
    for (const activity of this.listActivities()) {
      if (activity.type !== secretSanta.type) continue
      const config = secretSanta.configSchema.parse(activity.config)
      const confirmed = this.getSetting<Record<string, number>>(`santa-confirmed:${activity.id}`) ?? {}
      const warnings = this.getSetting<Record<string, SantaWarning>>(`santa-warnings:${activity.id}`) ?? {}
      const closesAt = confirmationClosesAt(config.confirmationDueAt)
      const emails = this.secretSantaEmails(activity.id)
      const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
      if (
        draw &&
        !draw.held &&
        closesAt !== null &&
        now >= Date.parse(config.confirmationDueAt) &&
        now < closesAt
      ) {
        for (const { userId, userName } of this.listResponses(activity.id)) {
          const warning = warnings[userId]
          const to = emails.get(userId)
          if (
            to &&
            draw.assignments[userId] &&
            !Object.hasOwn(confirmed, userId) &&
            warning?.deadline === config.confirmationDueAt &&
            warning.sentAt === null
          ) {
            mails.push({
              activityId: activity.id,
              userId,
              to,
              name: userName.split(" ")[0] || userName,
              kind: "confirmation-reminder",
              deadline: warning.deadline,
              closesAt,
            })
          }
        }
      }
      const removed = this.getSetting<Record<string, SantaRemoval>>(`santa-removed:${activity.id}`) ?? {}
      for (const [userId, person] of Object.entries(removed)) {
        if (person.email && person.sentAt === null)
          mails.push({
            activityId: activity.id,
            userId,
            to: person.email,
            name: person.name.split(" ")[0] || person.name,
            kind: "removed",
            deadline: person.deadline,
            closesAt: person.closesAt,
          })
      }
    }
    return mails
  }

  markSecretSantaStatusMailSent(mail: SecretSantaStatusMail) {
    const key = `santa-${mail.kind === "removed" ? "removed" : "warnings"}:${mail.activityId}`
    const records = this.getSetting<Record<string, SantaWarning | SantaRemoval>>(key) ?? {}
    const record = records[mail.userId]
    if (record?.deadline === mail.deadline) {
      record.sentAt = Date.now()
      this.setSetting(key, records)
    }
  }

  /** Draw emails still to send: one per participant with an address and a match, once each. */
  pendingSecretSantaMails(): SecretSantaMail[] {
    const mails: SecretSantaMail[] = []
    for (const activity of this.listActivities()) {
      if (activity.type !== secretSanta.type) continue
      const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
      if (!draw || draw.held) continue
      const config = secretSanta.configSchema.parse(activity.config)
      const sent = new Set(this.getSetting<string[]>(`santa-mail:${activity.id}`) ?? [])
      const emails = this.secretSantaEmails(activity.id)
      for (const { userId, userName } of this.listResponses(activity.id)) {
        const email = emails.get(userId)
        if (!email || sent.has(userId) || !draw.assignments[userId]) continue
        mails.push({
          activityId: activity.id,
          userId,
          to: email,
          name: userName.split(" ")[0] || userName,
          exchange: config.exchange,
          budget: config.budget,
          drawnAt: draw.drawnAt,
        })
      }
    }
    return mails
  }

  /** "Your person withdrew, you have a new one" emails still to send. */
  pendingSecretSantaReassignMails(): SecretSantaReassignMail[] {
    const mails: SecretSantaReassignMail[] = []
    for (const activity of this.listActivities()) {
      if (activity.type !== secretSanta.type) continue
      const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activity.id}`)
      const notices = this.getSetting<SecretSantaReassignNotice[]>(`santa-reassign:${activity.id}`) ?? []
      if (!draw || !notices.length) continue
      const emails = this.secretSantaEmails(activity.id)
      const responses = this.listResponses(activity.id)
      for (const notice of notices) {
        const giver = responses.find((r) => r.userId === notice.giverId)
        const to = emails.get(notice.giverId)
        if (!giver || !to) continue
        mails.push({
          activityId: activity.id,
          userId: notice.giverId,
          to,
          name: giver.userName.split(" ")[0] || giver.userName,
          withdrawnName: notice.withdrawnName,
          hasNewMatch: Boolean(draw.assignments[notice.giverId]),
          at: notice.at,
          ...(notice.reason ? { reason: notice.reason } : {}),
        })
      }
    }
    return mails
  }

  markSecretSantaReassignSent(activityId: string, giverId: string, at: number) {
    const notices = this.getSetting<SecretSantaReassignNotice[]>(`santa-reassign:${activityId}`) ?? []
    this.setSetting(
      `santa-reassign:${activityId}`,
      notices.filter((notice) => !(notice.giverId === giverId && notice.at === at)),
    )
  }

  markSecretSantaMailSent(activityId: string, userId: string, drawnAt: number) {
    const draw = this.getSetting<SecretSantaDraw>(`santa-draw:${activityId}`)
    if (!draw || draw.drawnAt !== drawnAt) return
    const sent = this.getSetting<string[]>(`santa-mail:${activityId}`) ?? []
    if (!sent.includes(userId)) this.setSetting(`santa-mail:${activityId}`, [...sent, userId])
    this.events.emit("results", activityId)
  }

  private deleteSecretSantaDraws(activityId: string) {
    for (const key of ["confirmed", "warnings", "removed", "archived", "letter-edited"])
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-${key}:${activityId}`)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-reassign:${activityId}`)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-mail:${activityId}`)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-draw:${activityId}`)
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(`santa-gadget:${activityId}`)
  }

  // ---- stage -----------------------------------------------------------------------------

  getStage(): Stage {
    // Stages saved before presentations existed have no presentationId.
    return { ...IDLE_STAGE, ...this.getSetting<Partial<Stage>>("stage") }
  }

  /**
   * Puts an activity on stage (replacing whatever was there) and opens or closes it. Its
   * presentation becomes the current one; activities outside any presentation leave it as is.
   */
  setStage(idOrSlug: string, status: StageStatus): Stage {
    const activity = this.requireActivity(idOrSlug)
    if (status === "open") {
      this.assertCanOpen(activity)
      // Speed points count from the first time answers open in a round.
      if (this.getSetting(`opened-at:${activity.id}`) === undefined)
        this.setSetting(`opened-at:${activity.id}`, Date.now())
    }
    return this.writeStage({
      activityId: activity.id,
      status,
      changedAt: Date.now(),
      presentationId: activity.presentationId ?? this.getStage().presentationId,
    })
  }

  /** Starts (or with null, ends) a presentation: the audience sees its leaderboard between activities. */
  setStagePresentation(idOrSlug: string | null): Stage {
    const presentationId = idOrSlug ? this.requirePresentation(idOrSlug).id : null
    return this.writeStage({ ...this.getStage(), presentationId, changedAt: Date.now() })
  }

  /** Opens or closes what is on stage, without changing it. */
  setStageStatus(status: StageStatus): Stage {
    const stage = this.getStage()
    if (!stage.activityId) throw new StoreError(409, "Nothing is on stage")
    return this.setStage(stage.activityId, status)
  }

  /** Back to the idle screen. */
  clearStage(): Stage {
    return this.writeStage({ ...this.getStage(), activityId: null, status: "closed", changedAt: Date.now() })
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
              membersOnly: activity.membersOnly,
              countsToLeaderboard: activity.countsToLeaderboard,
            }
          : null,
    }
  }

  private writeStage(stage: Stage): Stage {
    this.setSetting("stage", stage)
    this.events.emit("stage", stage)
    return stage
  }

  // ---- presence -------------------------------------------------------------------------

  /** Counts `userId` as having the audience page open until the returned function is called. */
  join(userId: string): () => void {
    this.present.set(userId, (this.present.get(userId) ?? 0) + 1)
    this.events.emit("presence")
    let left = false
    return () => {
      if (left) return
      left = true
      const remaining = (this.present.get(userId) ?? 1) - 1
      if (remaining > 0) this.present.set(userId, remaining)
      else this.present.delete(userId)
      this.events.emit("presence")
    }
  }

  getAudienceCounts(): AudienceCounts {
    const activityId = this.getStage().activityId
    const activity = activityId ? this.getActivity(activityId) : undefined
    const answered = activity
      ? (
          this.db
            .prepare("SELECT COUNT(*) AS answered FROM responses WHERE activity_id = ?")
            .get(activity.id) as { answered: number }
        ).answered
      : 0
    return { connected: this.present.size, answered, activity: activity?.slug ?? null }
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

  // ---- theme -----------------------------------------------------------------------------

  /** The look of the audience page, switched by the admins: "default" or "christmas". */
  getTheme(): Theme {
    return this.getSetting<Theme>("theme") === "christmas" ? "christmas" : "default"
  }

  setTheme(theme: Theme): Theme {
    this.setSetting("theme", theme)
    return theme
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

/**
 * Secret Santa runs off stage for weeks and never scores: it belongs to no presentation, so a
 * presentation's reset or leaderboard never reaches its letters and draw.
 */
function offStageFields(type: string): Partial<Pick<Activity, "presentationId" | "countsToLeaderboard">> {
  return type === secretSanta.type ? { presentationId: null, countsToLeaderboard: false } : {}
}

function publicDraw(draw: AnySavedDraw | undefined): object | null {
  if (!draw) return null
  const { winnerUserId: _, ...rest } = draw
  return rest
}

interface PresentationRow {
  id: string
  slug: string
  title: string
  created_at: number
}

function toPresentation(row: PresentationRow): Presentation {
  return { id: row.id, slug: row.slug, title: row.title, createdAt: row.created_at }
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    config: JSON.parse(row.config),
    presentationId: row.presentation_id,
    membersOnly: row.members_only === 1,
    countsToLeaderboard: row.counts_to_leaderboard === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const LEAVE_LABELS: Record<SantaLeaveReason, string> = {
  withdrawn: "Ritirato",
  unconfirmed: "Non confermato",
  admin: "Rimosso",
}

/**
 * One audit change per letter field that differs; `before` is null when the old letter is unknown.
 * The audit history outlives a reset, so it never keeps the letter text, only that it changed.
 */
function entryChanges(
  userId: string,
  name: string,
  before: SecretSantaEntry | null,
  after: SecretSantaEntry,
): SantaAdminChange[] {
  const yesNo = (value: boolean) => (value ? "Sì" : "No")
  const text = (value: string, label: string) => (value.trim() ? label : "Vuoto")
  const changes: SantaAdminChange[] = []
  for (const [field, key] of [
    ["Cose che ama", "likes"],
    ["Meglio di no", "dislikes"],
  ] as const)
    if (before?.[key] !== after[key])
      changes.push({
        userId,
        name,
        field,
        before: before ? text(before[key], "Testo precedente") : null,
        after: text(after[key], "Testo aggiornato"),
      })
  if (before?.gadget !== after.gadget)
    changes.push({
      userId,
      name,
      field: "Adesione gadget",
      before: before ? yesNo(before.gadget) : null,
      after: yesNo(after.gadget),
    })
  return changes
}

/** Whether `assignments` takes everybody in `ids` around one cycle, nobody to themselves. */
function isSingleCycle(ids: string[], assignments: Record<string, string | null>) {
  if (ids.length < 2) return ids.every((id) => assignments[id] === null)
  const seen = new Set<string>()
  let current = ids[0] as string
  while (!seen.has(current)) {
    seen.add(current)
    const next = assignments[current]
    if (!next || next === current || !ids.includes(next)) return false
    current = next
  }
  return seen.size === ids.length && current === ids[0]
}
