import { z } from "zod"
import { defineActivity } from "../types.ts"

const configSchema = z.object({
  prompt: z.string().trim().min(1).max(300),
})
export type NumberLotteryConfig = z.infer<typeof configSchema>
export type NumberLotteryResponse = { number: number }
/** A guess with the name of whoever made it, as the IdP knows them. */
export type NumberLotteryEntry = { name: string; number: number }
export type NumberLotteryDraw = {
  number: number
  distance: number
  closest: NumberLotteryEntry[]
  winners: NumberLotteryEntry[]
  drawnAt: number
}
export type NumberLotteryResults = {
  prompt: string
  totalParticipants: number
  entries: NumberLotteryEntry[]
  draw: NumberLotteryDraw | null
}

export function closestEntries<Entry extends NumberLotteryEntry>(entries: Entry[], target: number) {
  const distance = entries.reduce((best, entry) => Math.min(best, Math.abs(entry.number - target)), Infinity)
  return { distance, closest: entries.filter((entry) => Math.abs(entry.number - target) === distance) }
}

export const numberLottery = defineActivity<NumberLotteryConfig, NumberLotteryResponse, NumberLotteryResults>(
  {
    type: "number-lottery",
    label: "Number lottery",
    description: "Pick a number from 0 to 100. The closest guess to the drawn number wins.",
    configSchema,
    defaultConfig: () => ({ prompt: "Pick a number from 0 to 100 to win a gadget" }),
    drawLabel: "Draw the number",
    responseSchema: () =>
      z.object({
        number: z.number().int().min(0).max(100),
      }),
    aggregate: (config, responses) => ({
      prompt: config.prompt,
      totalParticipants: responses.length,
      // Names come from the IdP: winners are announced on the presentation.
      entries: responses.map(({ userName, response }) => ({ name: userName, number: response.number })),
      draw: null,
    }),
  },
)
