import { z } from "zod"
import { defineActivity, withoutBlankItems } from "../types.ts"

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
    /**
     * "points": every correct answer scores, faster ones more, and the answer is revealed by a
     * draw. "first": the first correct answer wins and closes the quiz. Older quizzes have none
     * and keep working as "first".
     */
    scoring: z.enum(["points", "first"]).optional(),
    answerMode: z.enum(["choice", "order"]).optional(),
    choices: withoutBlankItems(z.array(z.string().trim().min(1).max(32)).min(2).max(6)).optional(),
    acceptedAnswers: withoutBlankItems(z.array(z.string().trim().min(1).max(120)).min(1).max(10)),
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
export type MemoryQuizResponse = { answer: string }
export type MemoryQuizDraw = {
  answer: string
  /** `name` is the winner's name from the IdP: the first, or with points the fastest, correct answer. */
  winner: { name: string; answer: string } | null
  /** How many answers were correct. Only with points scoring. */
  correct?: number
  drawnAt: number
}

export function quizScoring(config: Pick<MemoryQuizConfig, "scoring">) {
  return config.scoring ?? "first"
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
  defaultConfig: () => ({ question: "", scoring: "points", acceptedAnswers: [""] }),
  drawLabel: "Reveal the answer",
  responseSchema: (config) =>
    z
      .object({
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
    scoring: quizScoring(config),
    ...(config.answerMode ? { answerMode: config.answerMode, choices: config.choices } : {}),
  }),
  aggregate: (config, responses) => ({
    question: config.question,
    totalParticipants: responses.length,
    draw: null,
  }),
})
