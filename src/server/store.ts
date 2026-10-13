import { randomBytes, randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { getActivityDefinition } from "../activities/registry.ts"
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
    const definition = getActivityDefinition(activity.type)
    if (!definition) throw new StoreError(400, `Unknown activity type "${activity.type}"`)
    const parsed = definition.responseSchema(activity.config).safeParse(response)
    if (!parsed.success) throw new StoreError(400, "Invalid answer", parsed.error.issues)
    this.db
      .prepare(
        `INSERT INTO responses (activity_id, user_id, user_name, response, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (activity_id, user_id) DO UPDATE SET
           user_name = excluded.user_name, response = excluded.response, updated_at = excluded.updated_at`,
      )
      .run(activity.id, user.id, user.name, JSON.stringify(parsed.data), Date.now())
    this.events.emit("results", activity.id)
    return parsed.data
  }

  resetResponses(idOrSlug: string): void {
    const activity = this.requireActivity(idOrSlug)
    this.db.prepare("DELETE FROM responses WHERE activity_id = ?").run(activity.id)
    this.events.emit("results", activity.id)
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
      results: definition.aggregate(activity.config, this.listResponses(activity.id)),
    }
  }

  // ---- stage -----------------------------------------------------------------------------

  getStage(): Stage {
    return this.getSetting<Stage>("stage") ?? IDLE_STAGE
  }

  /** Puts an activity on stage (replacing whatever was there) and opens or closes it. */
  setStage(idOrSlug: string, status: StageStatus): Stage {
    const activity = this.requireActivity(idOrSlug)
    return this.writeStage({ activityId: activity.id, status, changedAt: Date.now() })
  }

  /** Opens or closes what is on stage, without changing it. */
  setStageStatus(status: StageStatus): Stage {
    const stage = this.getStage()
    if (!stage.activityId) throw new StoreError(409, "Nothing is on stage")
    return this.writeStage({ ...stage, status, changedAt: Date.now() })
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
