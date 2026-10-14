import { z } from "zod"
import type { NumberLotteryResponse } from "../number-lottery/definition.ts"
import { defineActivity } from "../types.ts"

const configSchema = z.object({
  prompt: z.string().trim().min(1).max(300),
  target: z.number().int().min(0).max(1_000_000),
})
export type NumberEstimateConfig = z.infer<typeof configSchema>
export type NumberEstimateResponse = NumberLotteryResponse
export type NumberEstimateDraw = {
  number: number
  distance: number | null
  tied: number
  winner: NumberEstimateResponse | null
  drawnAt: number
}
export type NumberEstimateResults = {
  prompt: string
  totalParticipants: number
  draw: NumberEstimateDraw | null
}
export const numberEstimate = defineActivity<
  NumberEstimateConfig,
  NumberEstimateResponse,
  NumberEstimateResults
>({
  type: "number-estimate",
  label: "Guess the real number",
  description: "Guess a real figure. The closest guess wins; ties select one winner randomly.",
  configSchema,
  defaultConfig: () => ({ prompt: "Guess the real number", target: 0 }),
  responseSchema: () =>
    z.object({
      name: z
        .string()
        .max(200)
        .transform((name) => name.normalize("NFKC").trim().replace(/\s+/gu, " "))
        .pipe(z.string().min(1).max(80)),
      number: z.number().int().min(0).max(1_000_000),
    }),
  audienceConfig: (config) => ({ prompt: config.prompt }),
  aggregate: (config, responses) => ({
    prompt: config.prompt,
    totalParticipants: responses.length,
    draw: null,
  }),
})
