import { useEffect, useState } from "react"
import { Field, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import {
  type NumberLotteryConfig,
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
    <div className="space-y-3">
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
  response,
  open,
  submit,
}: {
  config: NumberLotteryConfig
  response: NumberLotteryResponse | null
  open: boolean
  submit: (response: NumberLotteryResponse) => Promise<void>
}) {
  const [name, setName] = useState(response?.name ?? "")
  const [number, setNumber] = useState(response ? String(response.number) : "")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(response?.name ?? "")
    setNumber(response ? String(response.number) : "")
  }, [response])
  const parsed = numberLottery
    .responseSchema(config)
    .safeParse({ name, number: number.trim() ? Number(number) : NaN })
  const dirty =
    parsed.success && (parsed.data.name !== response?.name || parsed.data.number !== response?.number)
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
  const inputClass =
    "w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-lg text-white outline-none focus:border-sky-300 disabled:opacity-60"
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold text-white">{config.prompt}</h2>
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
      <label className="block space-y-2">
        <span className="text-sm text-sky-100">Your number, from 0 to 100</span>
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          inputMode="numeric"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          disabled={!open || saving}
          className={inputClass}
        />
      </label>
      {open && (
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void send()}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-semibold text-brand-950 disabled:opacity-40"
        >
          {saving ? "Sending…" : response ? "Update guess" : "Submit guess"}
        </button>
      )}
      <p className="text-sm text-sky-100/80">
        Closest guess wins. If several people are equally close, one winner is drawn at random among them.
      </p>
      <p className="text-center text-sm text-sky-100/70">
        {!open
          ? "Guesses are closed."
          : response && !dirty
            ? "Guess saved ✓ You can change it until the draw."
            : "One guess per person."}
      </p>
    </div>
  )
}

function Results({ results }: { config: NumberLotteryConfig; results: NumberLotteryResults }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">{results.totalParticipants} participants</p>
      {results.draw && (
        <div className="space-y-2">
          <p className="text-3xl font-semibold text-blue-600">{results.draw.number}</p>
          {results.draw.closest.length > 1 && (
            <p className="text-sm">
              {results.draw.closest.length} equally close guesses: winner drawn at random among them.
            </p>
          )}
          <p className="font-medium">
            Winner: {results.draw.winners[0]?.name} ({results.draw.winners[0]?.number}), distance{" "}
            {results.draw.distance}
          </p>
        </div>
      )}
      <ol className="max-h-80 list-decimal overflow-auto pl-5 text-sm">
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
