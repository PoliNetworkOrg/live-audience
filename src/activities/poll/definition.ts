import { z } from "zod"
import { defineActivity, withoutBlankItems } from "../types.ts"

const optionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(120),
})

export const pollConfigSchema = z.object({
  question: z.string().trim().min(1).max(300),
  /** Options left without a label are dropped. */
  options: withoutBlankItems(z.array(optionSchema).min(2).max(12), "label"),
  /** How many options each person may pick. 1 = classic single choice. */
  maxChoices: z.number().int().min(1).max(12),
})

export type PollConfig = z.infer<typeof pollConfigSchema>
export type PollResponse = { choices: string[] }
export type PollResults = {
  question: string
  totalVoters: number
  options: { id: string; label: string; votes: number; percent: number }[]
}

export const poll = defineActivity<PollConfig, PollResponse, PollResults>({
  type: "poll",
  label: "Poll",
  description: "A question with fixed options. People pick one, or up to N.",
  configSchema: pollConfigSchema.refine((c) => c.maxChoices <= c.options.length, {
    message: "maxChoices cannot exceed the number of options",
    path: ["maxChoices"],
  }),
  defaultConfig: () => ({
    question: "",
    options: [
      { id: "a", label: "" },
      { id: "b", label: "" },
    ],
    maxChoices: 1,
  }),
  responseSchema: (config) => {
    const ids = new Set(config.options.map((o) => o.id))
    return z.object({
      choices: z
        .array(z.string().refine((id) => ids.has(id), "Unknown option"))
        .min(1)
        .max(config.maxChoices)
        .refine((choices) => new Set(choices).size === choices.length, "Duplicate choice"),
    })
  },
  aggregate: (config, responses) => {
    const counts = new Map(config.options.map((o) => [o.id, 0]))
    for (const { response } of responses) {
      for (const id of response.choices) {
        // Options can be removed after people voted: ignore what no longer exists.
        const current = counts.get(id)
        if (current !== undefined) counts.set(id, current + 1)
      }
    }
    const totalVoters = responses.length
    return {
      question: config.question,
      totalVoters,
      options: config.options.map((o) => {
        const votes = counts.get(o.id) ?? 0
        return {
          id: o.id,
          label: o.label,
          votes,
          percent: totalVoters ? Math.round((votes / totalVoters) * 1000) / 10 : 0,
        }
      }),
    }
  },
})
