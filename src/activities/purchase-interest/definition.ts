import { z } from "zod"
import { defineActivity } from "../types.ts"

const configSchema = z.object({ question: z.string().trim().min(1).max(300) })
export type PurchaseConfig = z.infer<typeof configSchema>
export type PurchaseResponse = { buy: false } | { buy: true; price: number }
export type PurchaseResults = {
  question: string
  totalRespondents: number
  yes: number
  no: number
  noPercent: number
  bands: { min: number; max: number; label: string; count: number; percent: number }[]
}

export const purchaseInterest = defineActivity<PurchaseConfig, PurchaseResponse, PurchaseResults>({
  type: "purchase-interest",
  label: "Purchase interest",
  description:
    "Yes or no; people choosing yes enter a price in whole euros. Results group prices in €10 bands.",
  configSchema,
  defaultConfig: () => ({ question: "Would you buy it? If yes, at what price?" }),
  responseSchema: () =>
    z.discriminatedUnion("buy", [
      z.object({ buy: z.literal(false) }),
      z.object({
        buy: z.literal(true),
        price: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER - 10),
      }),
    ]),
  aggregate: (config, responses) => {
    const counts = new Map<number, number>()
    let no = 0
    for (const { response } of responses) {
      if (!response.buy) {
        no++
        continue
      }
      // 0–10 inclusive, then 11–20, 21–30, etc. No unbounded array of empty bands.
      const index = response.price === 0 ? 0 : Math.ceil(response.price / 10) - 1
      counts.set(index, (counts.get(index) ?? 0) + 1)
    }
    const totalRespondents = responses.length
    const percent = (count: number) =>
      totalRespondents ? Math.round((count / totalRespondents) * 1000) / 10 : 0
    return {
      question: config.question,
      totalRespondents,
      yes: totalRespondents - no,
      no,
      noPercent: percent(no),
      bands: [...counts]
        .sort(([a], [b]) => a - b)
        .map(([index, count]) => {
          const min = index === 0 ? 0 : index * 10 + 1
          const max = (index + 1) * 10
          return { min, max, label: `${min}–${max} €`, count, percent: percent(count) }
        }),
    }
  },
})
