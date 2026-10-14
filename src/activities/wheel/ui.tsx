import { useState } from "react"
import { Saved, ShownAs, Verdict } from "../../client/audience-ui.tsx"
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
  me,
  response,
  open,
  submit,
}: {
  config: WheelConfig
  me: { name: string }
  response: WheelResponse | null
  open: boolean
  submit: (response: WheelResponse) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const join = async () => {
    if (!open || saving || response) return
    setSaving(true)
    try {
      await submit({})
    } catch {
      /* The audience page displays submission errors. */
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold text-white">{config.prompt}</h2>
      <ShownAs name={me.name} />
      {open && !response && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void join()}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-semibold text-brand-950 disabled:opacity-40"
        >
          {saving ? "Joining…" : "Join the wheel"}
        </button>
      )}
      {!open ? (
        response ? (
          <Verdict tone="info" emoji="🤞" title="You're on the wheel!">
            Fingers crossed: watch the screen while it spins.
          </Verdict>
        ) : (
          <Verdict tone="info" emoji="🐢" title="Too late!">
            Entries are closed: the wheel spins without you this time.
          </Verdict>
        )
      ) : response ? (
        <Saved id={response}>🎡 You're in! Good luck!</Saved>
      ) : (
        <p className="text-center text-sm text-sky-100/70">One entry per person.</p>
      )}
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
