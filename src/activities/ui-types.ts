import type { ComponentType } from "react"
import type { ActivityDefinition } from "./types.ts"

/**
 * The browser half of an activity type: how the admin edits it and how the audience answers it.
 * Results are rendered by the presentations themselves; `Results` is only a quick preview for the
 * admin page, and a JSON dump is shown when a type does not provide one.
 */
export interface ActivityUI<Config = unknown, Response = unknown, Results = unknown> {
  definition: ActivityDefinition<Config, Response, Results>
  /** Edits the config. Call `onChange` freely: the admin page saves when the user asks to. */
  Editor: ComponentType<{ config: Config; onChange: (config: Config) => void }>
  /**
   * What an audience member sees while the activity is on stage. `response` is their saved answer
   * (or null). When `open` is false answers are locked: show the saved one, read-only.
   * `me` is the signed-in person as the IdP knows them: never ask for their name. `outcome` arrives
   * once a game with a draw is decided (lottery, estimate, quiz): celebrate or commiserate.
   */
  Audience: ComponentType<{
    config: Config
    me: { name: string }
    outcome: AudienceOutcome<Results> | null
    response: Response | null
    open: boolean
    submit: (response: Response) => Promise<void>
  }>
  Results?: ComponentType<{ config: Config; results: Results }>
}

/** The decided draw of types whose results carry one, and whether this person won it. */
export type AudienceOutcome<Results> = Results extends { draw: infer Draw }
  ? { draw: NonNullable<Draw>; youWon: boolean; points: number | null }
  : never

export function defineActivityUI<Config, Response, Results>(
  ui: ActivityUI<Config, Response, Results>,
): ActivityUI<Config, Response, Results> {
  return ui
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds heterogeneous UIs
export type AnyActivityUI = ActivityUI<any, any, any>
