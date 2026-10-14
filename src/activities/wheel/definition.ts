import { z } from "zod"
import { defineActivity } from "../types.ts"

const configSchema = z.object({ prompt: z.string().trim().min(1).max(300) })
export type WheelConfig = z.infer<typeof configSchema>
export type WheelResponse = { name: string }
export type WheelResults = { prompt: string; totalParticipants: number; names: string[] }

export const wheel = defineActivity<WheelConfig, WheelResponse, WheelResults>({
  type: "wheel",
  label: "Wheel of fortune",
  description: "People enter a display name to join the live prize wheel.",
  configSchema,
  defaultConfig: () => ({ prompt: "Enter your name to join the wheel" }),
  responseSchema: () =>
    z.object({
      name: z
        .string()
        .max(200)
        .transform((name) => name.normalize("NFKC").trim().replace(/\s+/gu, " "))
        .pipe(z.string().min(1).max(80)),
    }),
  // Explicitly submitted display names are required for the wheel. Account identities stay private.
  // Equal names remain separate entries: each signed-in person gets one chance.
  aggregate: (config, responses) => ({
    prompt: config.prompt,
    totalParticipants: responses.length,
    names: responses.map(({ response }) => response.name),
  }),
})
