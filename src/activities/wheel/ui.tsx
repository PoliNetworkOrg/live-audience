import { useState } from "react"
import { Hint, Question, Saved, ShownAs, SubmitButton, Verdict } from "../../client/audience-ui.tsx"
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
    <div className="space-y-7">
      <Question>{config.prompt}</Question>
      <ShownAs name={me.name} />
      {open && !response && (
        <SubmitButton disabled={saving} onClick={() => void join()}>
          {saving ? "Joining…" : "Join the wheel"}
        </SubmitButton>
      )}
      {!open ? (
        response ? (
          <Verdict tone="info" icon="eye" title="You're on the wheel">
            Fingers crossed 🤞 Watch the screen while it spins.
          </Verdict>
        ) : (
          <Verdict tone="info" icon="hourglass" title="Too late!">
            Entries are closed: the wheel spins without you this time.
          </Verdict>
        )
      ) : response ? (
        <Saved id={response}>You're in. Good luck!</Saved>
      ) : (
        <Hint className="text-center">One entry per person.</Hint>
      )}
    </div>
  )
}

function Results({ results }: { config: WheelConfig; results: WheelResults }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        <b className="font-display text-lg font-medium text-pn">{results.totalParticipants}</b> participants
      </p>
      <ol className="max-h-80 list-decimal space-y-1.5 overflow-auto pl-6 text-sm text-slate-700 marker:font-display marker:text-slate-400">
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
