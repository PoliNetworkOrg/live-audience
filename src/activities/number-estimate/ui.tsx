import { useEffect, useState } from "react"
import {
  audienceField,
  Hint,
  Question,
  Saved,
  ShownAs,
  SubmitButton,
  useOneOf,
  Verdict,
} from "../../client/audience-ui.tsx"
import { Field, Input, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import {
  type NumberEstimateConfig,
  type NumberEstimateDraw,
  type NumberEstimateResponse,
  type NumberEstimateResults,
  numberEstimate,
} from "./definition.ts"

function Editor({
  config,
  onChange,
}: {
  config: NumberEstimateConfig
  onChange: (config: NumberEstimateConfig) => void
}) {
  return (
    <div className="space-y-6">
      <Field label="Prompt">
        <Textarea
          value={config.prompt}
          onChange={(event) => onChange({ ...config, prompt: event.target.value })}
        />
      </Field>
      <Field label="Correct number (hidden from participants)">
        <Input
          type="number"
          min={0}
          max={1_000_000}
          step={1}
          value={config.target}
          onChange={(event) => onChange({ ...config, target: Number(event.target.value) })}
          className="w-40"
        />
      </Field>
      <p className="text-sm text-slate-500">
        Closest guess wins. If several people are equally close, one winner is drawn at random among them.
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
  config: NumberEstimateConfig
  me: { name: string }
  outcome: { draw: NumberEstimateDraw; youWon: boolean; points: number | null } | null
  response: NumberEstimateResponse | null
  open: boolean
  submit: (response: NumberEstimateResponse) => Promise<void>
}) {
  const [number, setNumber] = useState(response ? String(response.number) : "")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setNumber(response ? String(response.number) : "")
  }, [response])
  const parsed = numberEstimate
    .responseSchema(config)
    .safeParse({ number: number.trim() ? Number(number) : NaN })
  const dirty = parsed.success && parsed.data.number !== response?.number
  const send = async () => {
    if (!open || saving || !parsed.success) return
    setSaving(true)
    try {
      await submit(parsed.data)
    } catch {
      /* Submission errors are shown by the audience page. Keep the draft. */
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-7">
      <Question>{config.prompt}</Question>
      <ShownAs name={me.name} />
      <label className="block space-y-2.5">
        <span className="block text-sm text-slate-500">Your guess, from 0 to 1000000</span>
        <input
          type="number"
          min={0}
          max={1_000_000}
          step={1}
          inputMode="numeric"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          disabled={!open || saving}
          className={audienceField}
        />
      </label>
      {open && (
        <SubmitButton disabled={!dirty || saving} onClick={() => void send()}>
          {saving ? "Sending…" : response ? "Update guess" : "Submit guess"}
        </SubmitButton>
      )}
      <Hint>
        Closest guess wins. If several people are equally close, one winner is drawn at random among them.
      </Hint>
      {outcome ? (
        <EstimateVerdict {...outcome} mine={response?.number} />
      ) : !open ? (
        response ? (
          <Verdict tone="info" icon="hourglass" title="Guesses locked">
            You guessed <b>{format(response.number)}</b>. Waiting for the big reveal…
          </Verdict>
        ) : (
          <Verdict tone="info" icon="lock" title="Guesses are closed">
            No guess from you this time.
          </Verdict>
        )
      ) : response && !dirty ? (
        <Saved id={response}>Guess saved. You can change it until the reveal.</Saved>
      ) : (
        <Hint className="text-center">One guess per person.</Hint>
      )}
    </div>
  )
}

const format = (number: number) => number.toLocaleString("en")

function EstimateVerdict({
  draw,
  youWon,
  points,
  mine,
}: {
  draw: NumberEstimateDraw
  youWon: boolean
  points: number | null
  mine: number | undefined
}) {
  const cheer = useOneOf(["You won!", "Best guess in the room!", "Human calculator!"])
  const real = <b>{format(draw.number)}</b>
  const winner = draw.winner
  if (youWon) {
    return draw.distance === 0 ? (
      <Verdict points={points} tone="win" icon="target" title="Spot on!">
        The real number was exactly {real}. You win!
      </Verdict>
    ) : (
      <Verdict points={points} tone="win" icon="trophy" title={cheer}>
        The real number was {real}: your {format(mine ?? 0)} was the closest guess.
      </Verdict>
    )
  }
  const winnerLine = winner
    ? `${winner.name} wins with ${format(winner.number)}.`
    : "Nobody guessed this time."
  if (mine === undefined) {
    return (
      <Verdict points={points} tone="info" icon="target" title={`The real number was ${format(draw.number)}`}>
        {winnerLine}
      </Verdict>
    )
  }
  const off = Math.abs(mine - draw.number)
  if (off === draw.distance) {
    return (
      <Verdict points={points} tone="lose" icon="shuffle" title="So close!">
        You tied for the closest guess with {draw.tied - 1 === 1 ? "someone else" : `${draw.tied - 1} others`}
        , but the random draw picked {winner?.name}.
      </Verdict>
    )
  }
  const ratio = off / Math.max(draw.number, 1)
  const [icon, title] =
    ratio <= 0.1
      ? (["target", "Argh, so close!"] as const)
      : ratio <= 0.5
        ? (["target", "Not bad!"] as const)
        : (["circle-x", "Way off!"] as const)
  return (
    <Verdict points={points} tone="lose" icon={icon} title={title}>
      The real number was {real}, you guessed {format(mine)}. {winnerLine}
    </Verdict>
  )
}

function Results({ results }: { config: NumberEstimateConfig; results: NumberEstimateResults }) {
  return (
    <div className="space-y-4 text-sm text-slate-700">
      <p className="text-slate-500">{results.totalParticipants} participants</p>
      {results.draw && (
        <>
          <p className="font-display text-5xl font-medium tracking-tight text-pn tabular-nums">
            {results.draw.number}
          </p>
          <p>
            {results.draw.winner
              ? `Winner: ${results.draw.winner.name} (${results.draw.winner.number}), distance ${results.draw.distance}`
              : "No participants: no winner."}
          </p>
          {results.draw.tied > 1 && (
            <p>Winner drawn randomly among {results.draw.tied} equally close guesses.</p>
          )}
        </>
      )}
    </div>
  )
}

export const numberEstimateUI = defineActivityUI({ definition: numberEstimate, Editor, Audience, Results })
