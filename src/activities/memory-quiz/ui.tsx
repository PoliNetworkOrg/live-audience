import { useEffect, useState } from "react"
import { Field, Select, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import {
  type MemoryQuizConfig,
  type MemoryQuizResponse,
  type MemoryQuizResults,
  memoryQuiz,
} from "./definition.ts"

function Editor({
  config,
  onChange,
}: {
  config: MemoryQuizConfig
  onChange: (config: MemoryQuizConfig) => void
}) {
  return (
    <div className="space-y-4">
      <Field label="Question">
        <Textarea
          value={config.question}
          onChange={(event) => onChange({ ...config, question: event.target.value })}
        />
      </Field>
      <Field label="Answer format">
        <Select
          className="w-auto"
          value={config.answerMode ?? "text"}
          onChange={(event) => {
            const mode = event.target.value
            onChange({
              ...config,
              answerMode: mode === "text" ? undefined : (mode as "choice" | "order"),
              choices: mode === "text" ? undefined : (config.choices ?? []),
            })
          }}
        >
          <option value="text">Free text</option>
          <option value="choice">Choose an option</option>
          <option value="order">Put items in order</option>
        </Select>
      </Field>
      {config.answerMode && (
        <Field
          label="Options / items (one per line; 2–4 choices, 2–6 ordered items)"
          hint="Blank lines are ignored."
        >
          <Textarea
            value={(config.choices ?? []).join("\n")}
            onChange={(event) => onChange({ ...config, choices: event.target.value.split("\n") })}
          />
        </Field>
      )}
      <Field
        label="Accepted answers (hidden from participants)"
        hint="One exact answer per line; blank lines are ignored. For ordering, separate the items with →. Case, whitespace and trailing . ! ? are ignored."
      >
        <Textarea
          value={config.acceptedAnswers.join("\n")}
          onChange={(event) => onChange({ ...config, acceptedAnswers: event.target.value.split("\n") })}
        />
      </Field>
      <p className="text-sm text-slate-500">
        The first correct answer received by the server wins and immediately closes the quiz.
      </p>
    </div>
  )
}

function Audience({
  config,
  response,
  open,
  submit,
}: {
  config: MemoryQuizConfig
  response: MemoryQuizResponse | null
  open: boolean
  submit: (response: MemoryQuizResponse) => Promise<void>
}) {
  const [name, setName] = useState(response?.name ?? "")
  const [answer, setAnswer] = useState(
    response?.answer ?? (config.answerMode === "order" ? (config.choices?.join(" → ") ?? "") : ""),
  )
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(response?.name ?? "")
    setAnswer(response?.answer ?? (config.answerMode === "order" ? (config.choices?.join(" → ") ?? "") : ""))
  }, [response, config.answerMode, config.choices])
  const parsed = memoryQuiz.responseSchema(config).safeParse({ name, answer })
  const dirty =
    parsed.success && (parsed.data.name !== response?.name || parsed.data.answer !== response?.answer)
  const send = async () => {
    if (!open || saving || !parsed.success) return
    setSaving(true)
    try {
      await submit(parsed.data)
    } catch {
      /* The audience page displays submission errors. */
    } finally {
      setSaving(false)
    }
  }
  const inputClass =
    "w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-lg text-white outline-none focus:border-sky-300 disabled:opacity-60"
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold text-white">{config.question}</h2>
      <label className="block space-y-2">
        <span className="text-sm text-sky-100">Your name (shown on the presentation)</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          autoComplete="name"
          disabled={!open || saving}
          className={inputClass}
        />
      </label>
      {config.answerMode === "choice" ? (
        <fieldset className="space-y-3" disabled={!open || saving}>
          <legend className="mb-2 text-sm text-sky-100">Choose your answer</legend>
          {config.choices?.map((choice) => (
            <label
              key={choice}
              className="flex items-center gap-3 rounded-2xl border border-white/20 p-4 text-white"
            >
              <input
                type="radio"
                name="quiz-choice"
                value={choice}
                checked={answer === choice}
                onChange={() => setAnswer(choice)}
              />
              {choice}
            </label>
          ))}
        </fieldset>
      ) : config.answerMode === "order" ? (
        <div className="space-y-3 text-white">
          <p className="text-sm text-sky-100">Put these items from earliest to latest</p>
          <ol className="space-y-2">
            {answer.split(" → ").map((item, index, items) => {
              const move = (direction: number) => {
                const destination = index + direction
                if (destination < 0 || destination >= items.length) return
                const reordered = [...items]
                ;[reordered[index], reordered[destination]] = [items[destination] ?? "", item]
                setAnswer(reordered.join(" → "))
              }
              return (
                <li key={item} className="flex items-center gap-2 rounded-2xl border border-white/20 p-3">
                  <span className="flex-1">
                    {index + 1}. {item}
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${item} up`}
                    disabled={!open || saving || index === 0}
                    onClick={() => move(-1)}
                    className="px-3 py-2 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item} down`}
                    disabled={!open || saving || index === items.length - 1}
                    onClick={() => move(1)}
                    className="px-3 py-2 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      ) : (
        <label className="block space-y-2">
          <span className="text-sm text-sky-100">Your answer</span>
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            maxLength={120}
            autoComplete="off"
            disabled={!open || saving}
            className={inputClass}
          />
        </label>
      )}
      {open && (
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void send()}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-semibold text-brand-950 disabled:opacity-40"
        >
          {saving ? "Sending…" : response ? "Update answer" : "Send answer"}
        </button>
      )}
      <p className="text-sm text-sky-100/80">
        The first correct answer received by the server wins. The quiz then closes immediately.
      </p>
      <p className="text-center text-sm text-sky-100/70">
        {!open
          ? "Quiz closed. Look at the presentation for the result."
          : response && !dirty
            ? "Answer sent ✓"
            : config.answerMode === "choice"
              ? "Choose an option."
              : config.answerMode === "order"
                ? "Arrange the items, then send your order."
                : "Type your answer freely."}
      </p>
    </div>
  )
}

function Results({ results }: { config: MemoryQuizConfig; results: MemoryQuizResults }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">{results.totalParticipants} participants</p>
      {results.draw && (
        <>
          <p>
            Answer: <b>{results.draw.answer}</b>
          </p>
          <p className="font-medium">
            {results.draw.winner ? `First correct answer: ${results.draw.winner.name}` : "No correct answer."}
          </p>
        </>
      )}
    </div>
  )
}

export const memoryQuizUI = defineActivityUI({ definition: memoryQuiz, Editor, Audience, Results })
