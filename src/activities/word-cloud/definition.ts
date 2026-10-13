import { z } from "zod"
import { defineActivity } from "../types.ts"

export const wordCloudConfigSchema = z.object({
  prompt: z.string().trim().min(1).max(300),
  maxWords: z.number().int().min(1).max(10),
})

export type WordCloudConfig = z.infer<typeof wordCloudConfigSchema>
export type WordCloudResponse = { words: string[] }
export type WordCloudResults = {
  prompt: string
  totalRespondents: number
  words: { text: string; count: number }[]
}

/** Keep phrases together; merge case, Unicode and whitespace variants. */
export function normalizeWord(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()
}

export const wordCloud = defineActivity<WordCloudConfig, WordCloudResponse, WordCloudResults>({
  type: "word-cloud",
  label: "Word cloud",
  description: "Free words or short phrases. The more people repeat one, the larger it appears.",
  configSchema: wordCloudConfigSchema,
  defaultConfig: () => ({ prompt: "", maxWords: 3 }),
  responseSchema: (config) =>
    z.object({
      words: z
        .array(z.string().max(200).transform(normalizeWord).pipe(z.string().min(1).max(60)))
        .min(1)
        .max(config.maxWords)
        .transform((words) => [...new Set(words)]),
    }),
  aggregate: (config, responses) => {
    const counts = new Map<string, number>()
    for (const { response } of responses) {
      for (const text of new Set(response.words.map(normalizeWord))) {
        counts.set(text, (counts.get(text) ?? 0) + 1)
      }
    }
    return {
      prompt: config.prompt,
      totalRespondents: responses.length,
      words: [...counts]
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "en")),
    }
  },
})
