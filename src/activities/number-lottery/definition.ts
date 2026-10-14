import { z } from "zod"
import { defineActivity } from "../types.ts"

const configSchema = z.object({
  prompt: z.string().trim().min(1).max(300),
})
export type NumberLotteryConfig = z.infer<typeof configSchema>
export type NumberLotteryResponse = { name: string; number: number }
export type NumberLotteryDraw = {
  number: number
  distance: number
  closest: NumberLotteryResponse[]
  winners: NumberLotteryResponse[]
  drawnAt: number
}
export type NumberLotteryResults = {
  prompt: string
  totalParticipants: number
  entries: NumberLotteryResponse[]
  draw: NumberLotteryDraw | null
}

export function closestEntries(entries: NumberLotteryResponse[], target: number) {
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
    responseSchema: () =>
      z.object({
        name: z
          .string()
          .max(200)
          .transform((name) => name.normalize("NFKC").trim().replace(/\s+/gu, " "))
          .pipe(z.string().min(1).max(80)),
        number: z.number().int().min(0).max(100),
      }),
    aggregate: (config, responses) => ({
      prompt: config.prompt,
      totalParticipants: responses.length,
      entries: responses.map(({ response }) => ({ name: response.name, number: response.number })),
      draw: null,
    }),
  },
)
