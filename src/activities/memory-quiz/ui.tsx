import { useEffect, useState } from "react"
import {
  audienceField,
  ChoiceButton,
  Hint,
  Question,
  Saved,
  ShowHide,
  ShownAs,
  SortableList,
  SubmitButton,
  useOneOf,
  Verdict,
} from "../../client/audience-ui.tsx"
import { Field, Select, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import {
  type MemoryQuizConfig,
  type MemoryQuizDraw,
  type MemoryQuizResponse,
  type MemoryQuizResults,
  memoryQuiz,
  normalizeAnswer,
  quizScoring,
} from "./definition.ts"

function Editor({
  config,
  onChange,
}: {
  config: MemoryQuizConfig
  onChange: (config: MemoryQuizConfig) => void
}) {
  return (
    <div className="space-y-6">
      <Field label="Question">
        <Textarea
          value={config.question}
          onChange={(event) => onChange({ ...config, question: event.target.value })}
        />
      </Field>
      <Field label="Scoring">
        <Select
          className="w-auto"
          value={quizScoring(config)}
          onChange={(scoring) => onChange({ ...config, scoring: scoring as "points" | "first" })}
          options={[
            { value: "points", label: "Points: every correct answer scores, faster ones more" },
            { value: "first", label: "First correct answer wins and closes the quiz" },
          ]}
        />
      </Field>
      <Field label="Answer format">
        <Select
          className="w-auto"
          value={config.answerMode ?? "text"}
          onChange={(mode) =>
            onChange({
              ...config,
              answerMode: mode === "text" ? undefined : (mode as "choice" | "order"),
              choices: mode === "text" ? undefined : (config.choices ?? []),
            })
          }
          options={[
            { value: "text", label: "Free text" },
            { value: "choice", label: "Choose an option" },
            { value: "order", label: "Put items in order" },
          ]}
        />
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
        {quizScoring(config) === "points"
          ? "Answers stay hidden until you reveal them. Each correct one scores up to 1000 points, down to 500 over the first 30 seconds; the fastest wins."
          : "The first correct answer received by the server wins and immediately closes the quiz."}
      </p>
    </div>
  )
}

function Audience({
  config,
  me,
  outcome,
  response,
  open,
  submit,
}: {
  config: MemoryQuizConfig
  me: { name: string }
  outcome: { draw: MemoryQuizDraw; youWon: boolean; points: number | null } | null
  response: MemoryQuizResponse | null
  open: boolean
  submit: (response: MemoryQuizResponse) => Promise<void>
}) {
  const [answer, setAnswer] = useState(
    response?.answer ?? (config.answerMode === "order" ? (config.choices?.join(" → ") ?? "") : ""),
  )
  const [saving, setSaving] = useState(false)
  /** The last answer this person tried to send, even if it arrived too late. */
  const [tried, setTried] = useState<string | null>(null)
  const nope = useOneOf([
    "Nope, not it. Try again!",
    "Not quite! Have another go.",
    "Wrong… but don't give up.",
  ])
  const withPoints = quizScoring(config) === "points"
  useEffect(() => {
    setAnswer(response?.answer ?? (config.answerMode === "order" ? (config.choices?.join(" → ") ?? "") : ""))
  }, [response, config.answerMode, config.choices])
  const parsed = memoryQuiz.responseSchema(config).safeParse({ answer })
  const dirty = parsed.success && parsed.data.answer !== response?.answer
  const send = async () => {
    if (!open || saving || !parsed.success) return
    setTried(parsed.data.answer)
    setSaving(true)
    try {
      await submit(parsed.data)
    } catch {
      /* The audience page displays submission errors. */
    } finally {
      setSaving(false)
    }
  }
  const answerArea =
    config.answerMode === "choice" ? (
      <fieldset className="space-y-2.5" disabled={!open || saving}>
        {config.choices?.map((choice) => (
          <ChoiceButton key={choice} selected={answer === choice} onClick={() => setAnswer(choice)}>
            {choice}
          </ChoiceButton>
        ))}
      </fieldset>
    ) : config.answerMode === "order" ? (
      <SortableList
        items={answer.split(" → ")}
        onChange={(items) => setAnswer(items.join(" → "))}
        disabled={!open || saving}
      />
    ) : (
      <label className="block space-y-2.5">
        <span className="block text-sm text-slate-500">Your answer</span>
        <input
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          maxLength={120}
          autoComplete="off"
          disabled={!open || saving}
          className={audienceField}
        />
      </label>
    )
  // Once answers close, the verdict comes first and the answer given waits behind a button.
  if (!open) {
    return (
      <div className="space-y-3 tall:space-y-4">
        <Question>{config.question}</Question>
        {outcome ? (
          withPoints ? (
            <PointsVerdict {...outcome} />
          ) : (
            <QuizVerdict {...outcome} tried={tried ?? response?.answer} />
          )
        ) : (
          <Verdict tone="info" icon="hourglass" title="Answers locked">
            {withPoints ? "Drumroll… the answer is coming up." : "Eyes on the presentation…"}
          </Verdict>
        )}
        {response && <ShowHide label="your answer">{answerArea}</ShowHide>}
      </div>
    )
  }
  return (
    <div className="space-y-3 tall:space-y-4">
      <Question>{config.question}</Question>
      <ShownAs name={me.name} />
      {answerArea}
      <SubmitButton disabled={!dirty || saving} onClick={() => void send()}>
        {saving ? "Sending…" : response ? "Update answer" : "Send answer"}
      </SubmitButton>
      <Hint>
        {withPoints
          ? "Every correct answer scores, faster ones more. The answer is revealed at the end."
          : "The first correct answer wins and closes the quiz."}
      </Hint>
      {response && !dirty && withPoints ? (
        <Saved id={response}>Locked in! You can change it until the reveal.</Saved>
      ) : response && !dirty ? (
        // A right answer closes the quiz on the spot: still open means this one was wrong.
        <p key={JSON.stringify(response)} className="animate-wobble text-center font-medium text-rose-600">
          {nope}
        </p>
      ) : (
        <Hint className="text-center">
          {config.answerMode === "choice"
            ? "Choose an option."
            : config.answerMode === "order"
              ? "Drag the items from first to last, then send."
              : "Type your answer freely."}
        </Hint>
      )}
    </div>
  )
}

/** Points quizzes: everyone right celebrates, the fastest most. */
function PointsVerdict({
  draw,
  youWon,
  points,
}: {
  draw: MemoryQuizDraw
  youWon: boolean
  points: number | null
}) {
  const cheer = useOneOf(["Correct!", "Nailed it!", "Spot on!"])
  const correct = draw.correct ?? 0
  const others = correct - 1
  if (youWon) {
    return (
      <Verdict solution tone="win" icon="zap" title="Fastest correct answer!" points={points}>
        “{draw.answer}” was right, and nobody beat you to it.
      </Verdict>
    )
  }
  if (points) {
    return (
      <Verdict solution tone="win" icon="circle-check" title={cheer} points={points}>
        “{draw.answer}” was right
        {others > 0 ? `, like ${others === 1 ? "one other person" : `${others} others`}.` : "."}{" "}
        {draw.winner && `${draw.winner.name} was the fastest.`}
      </Verdict>
    )
  }
  const rightLine =
    correct === 0 ? "Nobody got it!" : `${correct} ${correct === 1 ? "person" : "people"} got it right.`
  return points === 0 ? (
    <Verdict solution tone="lose" icon="circle-x" title="Not quite" points={points}>
      The answer was “{draw.answer}”. {rightLine}
    </Verdict>
  ) : (
    <Verdict solution tone="info" icon="lightbulb" title="Answer revealed">
      The answer was “{draw.answer}”. {rightLine} Join in on the next one!
    </Verdict>
  )
}

function QuizVerdict({
  draw,
  youWon,
  points,
  tried,
}: {
  draw: MemoryQuizDraw
  youWon: boolean
  points: number | null
  tried: string | undefined
}) {
  const cheer = useOneOf(["You got it first!", "Big brain!", "Fastest fingers!"])
  if (youWon) {
    return (
      <Verdict solution points={points} tone="win" icon="trophy" title={cheer}>
        “{draw.answer}” was right, and you were the quickest. You win!
      </Verdict>
    )
  }
  if (!draw.winner) {
    return (
      <Verdict solution points={points} tone="info" icon="lightbulb" title="Nobody got it!">
        The answer was “{draw.answer}”.
      </Verdict>
    )
  }
  const hadIt = tried !== undefined && normalizeAnswer(tried) === normalizeAnswer(draw.answer)
  return (
    <Verdict solution points={points} tone="lose" icon="hourglass" title="Too slow!">
      {hadIt
        ? `You had it right, but ${draw.winner.name} was faster.`
        : `${draw.winner.name} got there first: the answer was “${draw.answer}”.`}
    </Verdict>
  )
}

function Results({ results }: { config: MemoryQuizConfig; results: MemoryQuizResults }) {
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <p className="text-slate-500">{results.totalParticipants} participants</p>
      {results.draw && (
        <>
          <p className="label-caps">Answer</p>
          <p className="font-display text-2xl font-medium tracking-tight text-pn">{results.draw.answer}</p>
          <p className="font-medium">
            {results.draw.winner
              ? `${results.draw.correct === undefined ? "First" : "Fastest"} correct answer: ${results.draw.winner.name}`
              : "No correct answer."}
          </p>
          {results.draw.correct !== undefined && (
            <p className="text-slate-500">{results.draw.correct} correct answers</p>
          )}
        </>
      )}
    </div>
  )
}

export const memoryQuizUI = defineActivityUI({ definition: memoryQuiz, Editor, Audience, Results })
