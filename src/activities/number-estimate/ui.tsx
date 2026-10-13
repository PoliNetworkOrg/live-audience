import { useEffect, useState } from "react"
import { Field, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import {
  type NumberEstimateConfig,
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
    <div className="space-y-3">
      <Field label="Prompt">
        <Textarea
          value={config.prompt}
          onChange={(event) => onChange({ ...config, prompt: event.target.value })}
        />
      </Field>
      <Field label="Correct number (hidden from participants)">
        <input
          type="number"
          min={0}
          max={1_000_000}
          step={1}
          value={config.target}
          onChange={(event) => onChange({ ...config, target: Number(event.target.value) })}
          className="rounded border p-2"
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
  response,
  open,
  submit,
}: {
  config: NumberEstimateConfig
  response: NumberEstimateResponse | null
  open: boolean
  submit: (response: NumberEstimateResponse) => Promise<void>
}) {
  const [name, setName] = useState(response?.name ?? "")
  const [number, setNumber] = useState(response ? String(response.number) : "")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setName(response?.name ?? "")
    setNumber(response ? String(response.number) : "")
  }, [response])
  const parsed = numberEstimate
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
        <span className="text-sm text-sky-100">Your guess, from 0 to 1000000</span>
        <input
          type="number"
          min={0}
          max={1_000_000}
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
            ? "Guess saved ✓ You can change it until the reveal."
            : "One guess per person."}
      </p>
    </div>
  )
}

function Results({ results }: { config: NumberEstimateConfig; results: NumberEstimateResults }) {
  return (
    <div className="space-y-3">
      <p>{results.totalParticipants} participants</p>
      {results.draw && (
        <>
          <p className="text-3xl font-semibold text-blue-600">{results.draw.number}</p>
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
