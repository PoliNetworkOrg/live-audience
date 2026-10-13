import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { wordCloud } from "../src/activities/word-cloud/definition.ts"
import { wordCloudUI } from "../src/activities/word-cloud/ui.tsx"

const config = { prompt: "Ideas?", maxWords: 3 }
const answer = (words: string[], userId = "one") => ({
  userId,
  userName: "Private name",
  response: { words },
  updatedAt: 0,
})

describe("word cloud", () => {
  it("merges case, whitespace and Unicode variants, counting once per person", () => {
    const results = wordCloud.aggregate(config, [
      answer(["  FELPA ", "felpa", "stampa   3D", "caffè"]),
      answer(["ＦＥＬＰＡ", "stampa 3d", "caffe\u0300"], "two"),
    ])
    expect(results).toEqual({
      prompt: "Ideas?",
      totalRespondents: 2,
      words: [
        { text: "caffè", count: 2 },
        { text: "felpa", count: 2 },
        { text: "stampa 3d", count: 2 },
      ],
    })
    expect(JSON.stringify(results)).not.toContain("Private name")
    expect(wordCloud.aggregate(config, [])).toEqual({ prompt: "Ideas?", totalRespondents: 0, words: [] })
  })

  it("validates bounds and saves normalized distinct entries", () => {
    const schema = wordCloud.responseSchema(config)
    expect(schema.parse({ words: [" Felpa ", "FELPA"] })).toEqual({ words: ["felpa"] })
    for (const words of [[], ["  "], ["a", "b", "c", "d"], ["x".repeat(61)]]) {
      expect(schema.safeParse({ words }).success).toBe(false)
    }
    expect(schema.safeParse({ words: ["x".repeat(60)] }).success).toBe(true)
    expect(wordCloud.configSchema.safeParse({ ...config, maxWords: 0 }).success).toBe(false)
    expect(wordCloud.configSchema.safeParse({ ...config, prompt: " " }).success).toBe(false)
  })

  it("renders more frequent entries larger and escapes submitted text", () => {
    const Results = wordCloudUI.Results
    if (!Results) throw new Error("Missing cloud renderer")
    const html = renderToStaticMarkup(
      <Results
        config={config}
        results={{
          prompt: "Ideas?",
          totalRespondents: 3,
          words: [
            { text: "felpa", count: 3 },
            { text: "<script>", count: 1 },
          ],
        }}
      />,
    )
    const sizes = [...html.matchAll(/font-size:([\d.]+)px/g)].map((match) => Number(match[1]))
    expect(sizes).toHaveLength(2)
    expect(sizes[0]).toBeGreaterThan(sizes[1] ?? 0)
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>")
    expect(
      renderToStaticMarkup(<Results config={config} results={wordCloud.aggregate(config, [])} />),
    ).toContain("Waiting for answers")
  })
})
