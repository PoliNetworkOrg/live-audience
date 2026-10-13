import { z } from "zod"
import { defineActivity } from "../types.ts"

export function normalizeAnswer(answer: string) {
  return answer
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .replace(/[.!?]+$/u, "")
    .trim()
}

const configSchema = z
  .object({
    question: z.string().trim().min(1).max(300),
    answerMode: z.enum(["choice", "order"]).optional(),
    choices: z.array(z.string().trim().min(1).max(32)).min(2).max(6).optional(),
    acceptedAnswers: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
  })
  .refine((config) => config.acceptedAnswers.every((answer) => normalizeAnswer(answer).length > 0), {
    message: "Accepted answers cannot contain only punctuation",
    path: ["acceptedAnswers"],
  })
  .refine(
    (config) => {
      const mode = config.answerMode
      if (!mode) return !config.choices
      if (!config.choices || new Set(config.choices.map(normalizeAnswer)).size !== config.choices.length)
        return false
      if (mode === "choice" && config.choices.length > 4) return false
      if (config.choices.some((choice) => choice.includes("→"))) return false
      return config.acceptedAnswers.every((answer) => validStructuredAnswer(mode, config.choices, answer))
    },
    { message: "Choices must be distinct and accepted answers must match the choices", path: ["choices"] },
  )

function validStructuredAnswer(mode: "choice" | "order", choices: string[] | undefined, answer: string) {
  if (!choices) return false
  const parts = mode === "order" ? answer.split("→").map(normalizeAnswer) : [normalizeAnswer(answer)]
  const allowed = choices.map(normalizeAnswer)
  return mode === "choice"
    ? allowed.includes(parts[0] ?? "")
    : parts.length === allowed.length &&
        new Set(parts).size === allowed.length &&
        parts.every((part) => allowed.includes(part))
}

export type MemoryQuizConfig = z.infer<typeof configSchema>
export type MemoryQuizResponse = { name: string; answer: string }
export type MemoryQuizDraw = {
  answer: string
  winner: MemoryQuizResponse | null
  drawnAt: number
}
export type MemoryQuizResults = {
  question: string
  totalParticipants: number
  draw: MemoryQuizDraw | null
}

export function isCorrect(config: MemoryQuizConfig, answer: string) {
  const normalized = normalizeAnswer(answer)
  return (
    normalized.length > 0 &&
    config.acceptedAnswers.some((accepted) => normalizeAnswer(accepted) === normalized)
  )
}

export const memoryQuiz = defineActivity<MemoryQuizConfig, MemoryQuizResponse, MemoryQuizResults>({
  type: "memory-quiz",
  label: "Memory quiz",
  description:
    "Free text, multiple choice or ordering. The first correct answer received by the server wins.",
  configSchema,
  defaultConfig: () => ({ question: "", acceptedAnswers: [""] }),
  responseSchema: (config) =>
    z
      .object({
        name: z
          .string()
          .max(200)
          .transform((name) => name.normalize("NFKC").trim().replace(/\s+/gu, " "))
          .pipe(z.string().min(1).max(80)),
        answer: z.string().trim().min(1).max(120),
      })
      .refine(
        (response) =>
          !config.answerMode || validStructuredAnswer(config.answerMode, config.choices, response.answer),
        { message: "Choose a valid option or order every item exactly once", path: ["answer"] },
      ),
  // Correct answers must not be sent to participants before the result is revealed.
  audienceConfig: (config) => ({
    question: config.question,
    ...(config.answerMode ? { answerMode: config.answerMode, choices: config.choices } : {}),
  }),
  aggregate: (config, responses) => ({
    question: config.question,
    totalParticipants: responses.length,
    draw: null,
  }),
})
