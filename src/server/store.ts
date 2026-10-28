import { randomBytes, randomInt, randomUUID } from "node:crypto"
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
import type { StoredResponse } from "../activities/types.ts"
import type { Database } from "./db.ts"

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
  /** Who plays while it runs. */
  players: Players
  createdAt: number
}

/**
 * Who plays a presentation: people signed in with a PoliNetwork account, guests who only typed a
 * name, or both together.
 */
export const PLAYERS = ["accounts", "guests", "everyone"] as const
export type Players = (typeof PLAYERS)[number]

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
    if (presentationId !== activity.presentationId) {
      if (activity.presentationId) this.events.emit("leaderboard", activity.presentationId)
      if (presentationId) this.events.emit("leaderboard", presentationId)
    } else if (presentationId && updated.countsToLeaderboard !== activity.countsToLeaderboard) {
      this.events.emit("leaderboard", presentationId)
    }
    return updated
  }

  deleteActivity(id: string): void {
    const activity = this.requireActivity(id)
    if (this.getStage().activityId === activity.id) this.clearStage()
    this.db.prepare("DELETE FROM activities WHERE id = ?").run(activity.id)
    this.clearRound(activity.id)
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

  createPresentation(input: { title: string; slug: string; players?: Players }): Presentation {
    this.assertPresentationSlugFree(input.slug)
    const presentation: Presentation = {
      id: randomUUID(),
      title: input.title,
      slug: input.slug,
      players: input.players ?? "accounts",
      createdAt: Date.now(),
    }
    this.db
      .prepare("INSERT INTO presentations (id, slug, title, players, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(
        presentation.id,
        presentation.slug,
        presentation.title,
        presentation.players,
        presentation.createdAt,
      )
    return presentation
  }

  updatePresentation(
    idOrSlug: string,
    patch: { title?: string; slug?: string; players?: Players },
  ): Presentation {
    const presentation = this.requirePresentation(idOrSlug)
    if (patch.slug !== undefined && patch.slug !== presentation.slug)
      this.assertPresentationSlugFree(patch.slug)
    const updated = {
      ...presentation,
      title: patch.title ?? presentation.title,
      slug: patch.slug ?? presentation.slug,
      players: patch.players ?? presentation.players,
    }
    this.db
      .prepare("UPDATE presentations SET title = ?, slug = ?, players = ? WHERE id = ?")
      .run(updated.title, updated.slug, updated.players, updated.id)
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

  /** Deletes every answer, draw and point of the presentation's activities: a fresh start. */
  resetPresentation(idOrSlug: string): void {
    const presentation = this.requirePresentation(idOrSlug)
    for (const activity of this.listActivities()) {
      if (activity.presentationId === presentation.id) this.resetResponses(activity.id)
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

  /** Who plays the running presentation: accounts alone when none is running. */
  runningPlayers(): Players {
    const presentationId = this.getStage().presentationId
    return (presentationId && this.getPresentation(presentationId)?.players) || "accounts"
  }

  /** Whether the running presentation lets people join with just a name. */
  guestAccessOpen(): boolean {
    return this.runningPlayers() !== "accounts"
  }

  /** Everyone who answered or scored in the running presentation, as the leaderboard names them. */
  namesInPlay(): string[] {
    const presentationId = this.getStage().presentationId
    if (!presentationId) return []
    const rows = this.db
      .prepare(
        `SELECT user_name AS name FROM responses JOIN activities a ON a.id = activity_id WHERE a.presentation_id = ?
         UNION SELECT user_name FROM scores JOIN activities a ON a.id = activity_id WHERE a.presentation_id = ?`,
      )
      .all(presentationId, presentationId) as { name: string }[]
    return rows.map((row) => row.name)
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

function publicDraw(draw: AnySavedDraw | undefined): object | null {
  if (!draw) return null
  const { winnerUserId: _, ...rest } = draw
  return rest
}

interface PresentationRow {
  id: string
  slug: string
  title: string
  players: Players
  created_at: number
}

function toPresentation(row: PresentationRow): Presentation {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    players: row.players,
    createdAt: row.created_at,
  }
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
