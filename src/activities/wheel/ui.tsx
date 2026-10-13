import { useEffect, useState } from "react"
import { Field, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import { type WheelConfig, type WheelResponse, type WheelResults, wheel } from "./definition.ts"

function Editor({ config, onChange }: { config: WheelConfig; onChange: (config: WheelConfig) => void }) {
  return (
    <Field label="Prompt">
      <Textarea value={config.prompt} onChange={(event) => onChange({ prompt: event.target.value })} />
    </Field>
  )
}

function Audience({
  config,
  response,
  open,
  submit,
}: {
  config: WheelConfig
  response: WheelResponse | null
  open: boolean
  submit: (response: WheelResponse) => Promise<void>
}) {
  const [name, setName] = useState(response?.name ?? "")
  const [saving, setSaving] = useState(false)
  useEffect(() => setName(response?.name ?? ""), [response])
  const parsed = wheel.responseSchema(config).safeParse({ name })
  const send = async () => {
    if (!open || saving || !parsed.success) return
    setSaving(true)
    try {
      await submit(parsed.data)
    } catch {
      /* The audience page displays submission errors; keep the name for retry. */
    } finally {
      setSaving(false)
    }
  }
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
          className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-lg text-white outline-none focus:border-sky-300 disabled:opacity-60"
        />
      </label>
      {open && (
        <button
          type="button"
          disabled={!parsed.success || parsed.data.name === response?.name || saving}
          onClick={() => void send()}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-semibold text-brand-950 disabled:opacity-40"
        >
          {saving ? "Sending…" : response ? "Update name" : "Join the wheel"}
        </button>
      )}
      <p className="text-center text-sm text-sky-100/70">
        {!open
          ? response
            ? "Entries are closed. You're on the wheel!"
            : "Entries are closed."
          : response
            ? "You're on the wheel ✓ You can update your name until entries close."
            : "One entry per person."}
      </p>
    </div>
  )
}

function Results({ results }: { config: WheelConfig; results: WheelResults }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">{results.totalParticipants} participants</p>
      <ol className="max-h-80 list-decimal space-y-1 overflow-auto pl-5 text-sm">
        {results.names.map((name, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: equal display names are separate participants
          <li key={index} className="break-words">
            {name}
          </li>
        ))}
      </ol>
    </div>
  )
}

export const wheelUI = defineActivityUI({ definition: wheel, Editor, Audience, Results })
