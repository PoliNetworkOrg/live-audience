import { z } from "zod"

/**
 * The server-side half of an activity type: plain data and pure functions, no React.
 * It is imported by both the server (validation, aggregation) and the client (defaults, typing).
 *
 * Adding a new activity type means:
 *   1. `src/activities/<type>/definition.ts` exporting a `defineActivity(...)`
 *   2. `src/activities/<type>/ui.tsx` exporting a `defineActivityUI(...)`
 *   3. registering both in `src/activities/registry.ts` and `src/activities/ui-registry.ts`
 */
export interface ActivityDefinition<Config = unknown, Response = unknown, Results = unknown> {
  /** Stable identifier stored in the database. Never change it once activities exist. */
  type: string
  /** Shown in the admin when picking a type. */
  label: string
  description: string
  /** Validates what the admin saves. */
  configSchema: z.ZodType<Config>
  /** Config for a freshly created activity. */
  defaultConfig: () => Config
  /** Validates one audience member's answer against the current config. */
  responseSchema: (config: Config) => z.ZodType<Response>
  /**
   * Turns all answers into the results served to presentations. Keep personal data out unless
   * the type needs it: results leave the app through the API key.
   */
  aggregate: (config: Config, responses: StoredResponse<Response>[]) => Results
  /**
   * What the audience gets to see of the config. Defaults to the whole config; override it to
   * hide things such as the right answer of a quiz.
   */
  audienceConfig?: (config: Config) => unknown
}

export interface StoredResponse<Response = unknown> {
  userId: string
  userName: string
  response: Response
  updatedAt: number
}

export function defineActivity<Config, Response, Results>(
  definition: ActivityDefinition<Config, Response, Results>,
): ActivityDefinition<Config, Response, Results> {
  return definition
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds heterogeneous definitions
export type AnyActivityDefinition = ActivityDefinition<any, any, any>

/**
 * Lets admins leave blank rows in lists typed one item per line (or added one input at a time):
 * items that are only whitespace, or whose `key` is, are dropped before `schema` checks the rest.
 */
export function withoutBlankItems<T extends z.ZodType>(schema: T, key?: string) {
  return z.preprocess((value) => {
    if (!Array.isArray(value)) return value
    return value.filter((item) => {
      const text =
        key && typeof item === "object" && item !== null ? (item as Record<string, unknown>)[key] : item
      return typeof text !== "string" || text.trim() !== ""
    })
  }, schema)
}
