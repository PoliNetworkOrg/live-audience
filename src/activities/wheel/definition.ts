import { z } from "zod"
import { defineActivity } from "../types.ts"

const configSchema = z.object({ prompt: z.string().trim().min(1).max(300) })
export type WheelConfig = z.infer<typeof configSchema>
/** Joining is the whole answer: the name on the wheel comes from the IdP. */
const responseSchema = z.object({})
export type WheelResponse = z.infer<typeof responseSchema>
export type WheelResults = { prompt: string; totalParticipants: number; names: string[] }

export const wheel = defineActivity<WheelConfig, WheelResponse, WheelResults>({
  type: "wheel",
  label: "Wheel of fortune",
  description: "People join the live prize wheel with the name on their account.",
  configSchema,
  defaultConfig: () => ({ prompt: "Join the wheel for a chance to win" }),
  responseSchema: () => responseSchema,
  // The wheel shows the names from the IdP; account ids stay private.
  // Equal names remain separate entries: each signed-in person gets one chance.
  aggregate: (config, responses) => ({
    prompt: config.prompt,
    totalParticipants: responses.length,
    names: responses.map(({ userName }) => userName),
  }),
})
