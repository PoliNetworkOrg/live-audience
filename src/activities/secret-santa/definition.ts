import { z } from "zod"
import type { StoredResponse } from "../types.ts"
import { defineActivity } from "../types.ts"

/**
 * Secret Santa runs off stage, for days: anyone signed in joins from the home page, the admin
 * draws one gift cycle, and each person sees only who they give a gift to. Participants can also
 * enter a separate gadget draw. Pairings and winners never leave the app through the API key.
 */

const text = (max: number) => z.string().trim().max(max)
/** An ISO 8601 instant ("2026-12-12T23:59:00.000Z"), or "" for none. */
const instant = z.union([z.literal(""), z.iso.datetime({ offset: true })])

const configSchema = z
  .object({
    /** Shown on the home page. While false nobody sees it or can join. */
    visible: z.boolean(),
    /** Manual switch: the admin can close sign-ups at any moment. */
    signupsOpen: z.boolean(),
    /** Sign-ups close on their own at this instant. */
    signupsCloseAt: instant,
    /** The gift draw runs on its own at this instant. */
    drawAt: instant,
    /**
     * Draw emails go out, and people see who they give a gift to, at this instant. Until then the
     * pairings are a draft only admins see and can change. "" sends them right after the draw.
     */
    revealAt: instant.default(""),
    /** Last reminder; confirmations close at the following midnight in Europe/Rome. */
    confirmationDueAt: instant.default(""),
    /** Where and when gifts are handed over in person. */
    exchange: text(200),
    budget: text(60),
    /** A secret PoliNetwork gadget: nobody knows what it is until it is handed over. */
    gadget: z.object({
      enabled: z.boolean(),
      winners: z.number().int().min(1).max(20),
    }),
  })
  .refine((c) => !c.signupsCloseAt || !c.drawAt || Date.parse(c.drawAt) >= Date.parse(c.signupsCloseAt), {
    message: "The draw must come after sign-ups close",
    path: ["drawAt"],
  })
  .refine((c) => !c.revealAt || !c.drawAt || Date.parse(c.revealAt) >= Date.parse(c.drawAt), {
    message: "The emails must go out after the draw",
    path: ["revealAt"],
  })
  .refine(
    (c) => !c.confirmationDueAt || !c.drawAt || Date.parse(c.confirmationDueAt) > Date.parse(c.drawAt),
    {
      message: "Gift confirmation must come after the draw",
      path: ["confirmationDueAt"],
    },
  )
  .refine(
    (c) => !c.confirmationDueAt || !c.revealAt || Date.parse(c.confirmationDueAt) > Date.parse(c.revealAt),
    {
      message: "Gift confirmation must come after the emails go out",
      path: ["confirmationDueAt"],
    },
  )
export type SecretSantaConfig = z.infer<typeof configSchema>

const entrySchema = z.object({
  likes: z.string().trim().min(1, "Scrivi almeno una cosa che ti piace").max(600),
  dislikes: text(400),
  gadget: z.boolean(),
})
export type SecretSantaEntry = z.infer<typeof entrySchema>

/**
 * Who gives a gift to whom: giver user id → receiver user id (null once a withdrawal leaves nobody).
 * `held` while the pairings are a draft waiting for `revealAt`: no emails, participants see nothing.
 * Draws saved before it existed have no `held`: they are out.
 */
export type SecretSantaDraw = { drawnAt: number; assignments: Record<string, string | null>; held?: boolean }
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
  /** False when the IdP gave no email for this person: they would miss the draw email. */
  hasEmail: boolean
  entry: SecretSantaEntry | null
  /**
   * Who this person gives a gift to, once drawn. `editedAt` is when the organizers last corrected
   * that person's letter after the draw (null when they never did).
   */
  match: { name: string; likes: string; dislikes: string; editedAt?: number | null } | null
  /** Always null while gadget extraction is paused. */
  gadgetWon: boolean | null
  giftConfirmedAt: number | null
  confirmationClosesAt: number | null
  removed: { at: number; reason: "unconfirmed" } | null
}

/** How the prize is called everywhere: it stays a surprise. */
export const GADGET_NAME = "un gadget segreto PoliNetwork"

/** Whether new people may still sign up at `now` (ms), before any draw. */
export function signupsOpenAt(config: SecretSantaConfig, now: number) {
  return config.signupsOpen && (!config.signupsCloseAt || now < Date.parse(config.signupsCloseAt))
}

/** Whether the automatic draw is due at `now` (ms). */
export function drawDueAt(config: SecretSantaConfig, now: number) {
  return Boolean(config.drawAt) && now >= Date.parse(config.drawAt)
}

/** Whether a draw made at `now` (ms) goes out right away rather than waiting as a draft. */
export function revealDueAt(config: SecretSantaConfig, now: number) {
  return !config.revealAt || now >= Date.parse(config.revealAt)
}

/** Midnight after the deadline's Italian calendar date, including CET/CEST transitions. */
export function confirmationClosesAt(dueAt: string): number | null {
  if (!dueAt) return null
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const partsAt = (at: number) =>
    Object.fromEntries(
      formatter
        .formatToParts(at)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)]),
    )
  const day = partsAt(Date.parse(dueAt))
  const midnight = Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day) + 1)
  let at = midnight
  for (let i = 0; i < 3; i++) {
    const local = partsAt(at)
    at -=
      Date.UTC(
        Number(local.year),
        Number(local.month) - 1,
        Number(local.day),
        Number(local.hour),
        Number(local.minute),
        Number(local.second),
      ) - midnight
  }
  return at
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
    "Runs off stage for days: people sign up, receive a person to surprise and confirm their gift. Optional gadget sign-ups; gadget extraction is paused.",
  configSchema,
  defaultConfig: () => ({
    visible: false,
    signupsOpen: true,
    signupsCloseAt: "",
    drawAt: "",
    revealAt: "",
    confirmationDueAt: "",
    exchange: "",
    budget: "",
    gadget: { enabled: true, winners: 1 },
  }),
  responseSchema: () => entrySchema,
  aggregate: (config, responses: StoredResponse<SecretSantaEntry>[]) => ({
    participants: responses.length,
    gadgetEntries: config.gadget.enabled ? responses.filter(({ response }) => response.gadget).length : 0,
    drawn: false,
    gadgetDrawn: false,
  }),
})
