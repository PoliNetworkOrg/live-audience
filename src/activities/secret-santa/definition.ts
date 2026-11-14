import { z } from "zod"
import type { StoredResponse } from "../types.ts"
import { defineActivity } from "../types.ts"

/**
 * Secret Santa runs off stage, for days: anyone signed in joins from the home page, the admin
 * draws one gift cycle, and each person sees only who they give a gift to. Participants can also
 * enter a separate gadget draw. Pairings and winners never leave the app through the API key.
 */

const text = (max: number) => z.string().trim().max(max)

const configSchema = z.object({
  /** Shown on the home page. While false nobody sees it or can join. */
  visible: z.boolean(),
  /** New people can join until the gift draw, unless the admin closes sign-ups earlier. */
  signupsOpen: z.boolean(),
  intro: text(600),
  /** Free text, e.g. "Sign up by 12 December". */
  deadline: text(120),
  /** Where and when gifts are handed over in person. */
  exchange: text(200),
  budget: text(60),
  gadget: z.object({
    enabled: z.boolean(),
    prize: text(120),
    winners: z.number().int().min(1).max(20),
  }),
})
export type SecretSantaConfig = z.infer<typeof configSchema>

const entrySchema = z.object({
  likes: z.string().trim().min(1, "Tell your Santa something you like").max(600),
  dislikes: text(400),
  gadget: z.boolean(),
})
export type SecretSantaEntry = z.infer<typeof entrySchema>

/** Who gives a gift to whom: giver user id → receiver user id (null once a withdrawal leaves nobody). */
export type SecretSantaDraw = { drawnAt: number; assignments: Record<string, string | null> }
export type SecretSantaGadgetDraw = { drawnAt: number; winners: string[] }

/** Counts only: names and pairings are personal and stay inside the app. */
export type SecretSantaResults = {
  participants: number
  gadgetEntries: number
  drawn: boolean
  gadgetDrawn: boolean
}

/** One Secret Santa as one signed-in person sees it: their own entry and match, nobody else's. */
export interface SecretSantaView {
  id: string
  title: string
  config: SecretSantaConfig
  participants: number
  drawn: boolean
  gadgetDrawn: boolean
  /** New people may still sign up. */
  canJoin: boolean
  entry: SecretSantaEntry | null
  /** Who this person gives a gift to, once drawn. */
  match: { name: string; likes: string; dislikes: string } | null
  /** null while not drawn or not taking part in the gadget draw. */
  gadgetWon: boolean | null
}

/** One random cycle through everybody, so nobody draws themselves and nobody is left out. */
export function buildCycle(ids: string[], randomIndex: (size: number) => number): Record<string, string> {
  const order = [...ids]
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[order[i], order[j]] = [order[j] as string, order[i] as string]
  }
  return Object.fromEntries(order.map((id, i) => [id, order[(i + 1) % order.length] as string]))
}

/**
 * Takes someone out of the cycle without touching anyone else: whoever gave them a gift now gives
 * it to the person they would have given one to. Only when that would be themselves (two people
 * left) does the giver end up with nobody.
 */
export function withdrawFromCycle(
  assignments: Record<string, string | null>,
  userId: string,
): Record<string, string | null> {
  const next = { ...assignments }
  const receiver = next[userId] ?? null
  delete next[userId]
  for (const [giver, target] of Object.entries(next)) {
    if (target === userId) next[giver] = receiver && receiver !== giver ? receiver : null
  }
  return next
}

/** Picks `count` distinct winners at random among `ids`. */
export function pickWinners(ids: string[], count: number, randomIndex: (size: number) => number): string[] {
  const pool = [...ids]
  const winners: string[] = []
  while (winners.length < count && pool.length) {
    winners.push(pool.splice(randomIndex(pool.length), 1)[0] as string)
  }
  return winners
}

export const secretSanta = defineActivity<SecretSantaConfig, SecretSantaEntry, SecretSantaResults>({
  type: "secret-santa",
  label: "Secret Santa",
  description:
    "Runs off stage for days: people sign up from the home page with a few things they like, then one draw gives everyone a person to surprise. Optional gadget draw.",
  configSchema,
  defaultConfig: () => ({
    visible: false,
    signupsOpen: true,
    intro: "Sign up, tell us a few things you love, and you'll get someone to surprise with a small gift.",
    deadline: "",
    exchange: "",
    budget: "",
    gadget: { enabled: true, prize: "A PoliNetwork gadget", winners: 1 },
  }),
  responseSchema: () => entrySchema,
  aggregate: (config, responses: StoredResponse<SecretSantaEntry>[]) => ({
    participants: responses.length,
    gadgetEntries: config.gadget.enabled ? responses.filter(({ response }) => response.gadget).length : 0,
    drawn: false,
    gadgetDrawn: false,
  }),
})
