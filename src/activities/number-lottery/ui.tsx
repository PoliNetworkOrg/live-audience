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
import { Field, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import {
  type NumberLotteryConfig,
  type NumberLotteryDraw,
  type NumberLotteryResponse,
  type NumberLotteryResults,
  numberLottery,
} from "./definition.ts"

function Editor({
  config,
  onChange,
}: {
  config: NumberLotteryConfig
  onChange: (config: NumberLotteryConfig) => void
}) {
  return (
    <div className="space-y-6">
      <Field label="Prompt">
        <Textarea value={config.prompt} onChange={(event) => onChange({ prompt: event.target.value })} />
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
  config: NumberLotteryConfig
  me: { name: string }
  outcome: { draw: NumberLotteryDraw; youWon: boolean; points: number | null } | null
  response: NumberLotteryResponse | null
  open: boolean
  submit: (response: NumberLotteryResponse) => Promise<void>
}) {
  const [number, setNumber] = useState(response ? String(response.number) : "")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setNumber(response ? String(response.number) : "")
  }, [response])
  const parsed = numberLottery
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
        <span className="block text-sm text-slate-500">Your number, from 0 to 100</span>
        <input
          type="number"
          min={0}
          max={100}
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
        <LotteryVerdict {...outcome} mine={response?.number} />
      ) : !open ? (
        response ? (
          <Verdict tone="info" icon="hourglass" title="Guesses locked">
            Your number is <b>{response.number}</b>. Drumroll for the draw…
          </Verdict>
        ) : (
          <Verdict tone="info" icon="lock" title="Guesses are closed">
            You didn't pick a number this time.
          </Verdict>
        )
      ) : response && !dirty ? (
        <Saved id={response}>Guess saved. You can change it until the draw.</Saved>
      ) : (
        <Hint className="text-center">One guess per person.</Hint>
      )}
    </div>
  )
}

function LotteryVerdict({
  draw,
  youWon,
  points,
  mine,
}: {
  draw: NumberLotteryDraw
  youWon: boolean
  points: number | null
  mine: number | undefined
}) {
  const cheer = useOneOf(["You won!", "Winner winner!", "Jackpot!"])
  const winner = draw.winners[0]
  if (youWon) {
    return (
      <Verdict points={points} tone="win" icon="trophy" title={cheer}>
        The number was <b>{draw.number}</b>
        {draw.distance === 0 ? ": you nailed it exactly!" : `, and your ${mine} was the closest.`}
      </Verdict>
    )
  }
  if (mine === undefined) {
    return (
      <Verdict points={points} tone="info" icon="target" title={`The number was ${draw.number}`}>
        {winner?.name} wins with {winner?.number}. Join in next time!
      </Verdict>
    )
  }
  const distance = Math.abs(mine - draw.number)
  if (distance === draw.distance) {
    return (
      <Verdict points={points} tone="lose" icon="shuffle" title="So close!">
        You tied for the closest guess, but the random draw picked {winner?.name}.
      </Verdict>
    )
  }
  return (
    <Verdict
      tone="lose"
      icon={distance <= 5 ? "target" : "circle-x"}
      title={distance <= 5 ? "Argh, so close!" : "Not this time"}
    >
      The number was <b>{draw.number}</b> and you were {distance} away. {winner?.name} won with{" "}
      {winner?.number}.
    </Verdict>
  )
}

function Results({ results }: { config: NumberLotteryConfig; results: NumberLotteryResults }) {
  return (
    <div className="space-y-4 text-sm text-slate-700">
      <p className="text-slate-500">{results.totalParticipants} participants</p>
      {results.draw && (
        <div className="space-y-3">
          <p className="font-display text-5xl font-medium tracking-tight text-pn tabular-nums">
            {results.draw.number}
          </p>
          {results.draw.closest.length > 1 && (
            <p>{results.draw.closest.length} equally close guesses: winner drawn at random among them.</p>
          )}
          <p className="font-medium">
            Winner: {results.draw.winners[0]?.name} ({results.draw.winners[0]?.number}), distance{" "}
            {results.draw.distance}
          </p>
        </div>
      )}
      <ol className="max-h-80 list-decimal space-y-1.5 overflow-auto pl-6 marker:font-display marker:text-slate-400">
        {results.entries.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: equal names are separate participants
          <li key={index} className="break-words">
            {entry.name}: {entry.number}
          </li>
        ))}
      </ol>
    </div>
  )
}

export const numberLotteryUI = defineActivityUI({ definition: numberLottery, Editor, Audience, Results })
