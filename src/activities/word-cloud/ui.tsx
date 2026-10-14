import { useEffect, useState } from "react"
import { Saved, Verdict } from "../../client/audience-ui.tsx"
import { Field, Input, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import {
  normalizeWord,
  type WordCloudConfig,
  type WordCloudResponse,
  type WordCloudResults,
  wordCloud,
} from "./definition.ts"

function Editor({
  config,
  onChange,
}: {
  config: WordCloudConfig
  onChange: (config: WordCloudConfig) => void
}) {
  return (
    <div className="space-y-4">
      <Field label="Prompt">
        <Textarea
          value={config.prompt}
          onChange={(e) => onChange({ ...config, prompt: e.target.value })}
          placeholder="What gadgets should we make?"
        />
      </Field>
      <Field
        label="Words or phrases per person"
        hint="Each line is one entry, up to 60 characters. Repeating it counts once per person."
      >
        <Input
          type="number"
          min={1}
          max={10}
          value={config.maxWords}
          onChange={(e) => onChange({ ...config, maxWords: Number(e.target.value) || 1 })}
          className="w-24"
        />
      </Field>
    </div>
  )
}

function Audience({
  config,
  response,
  open,
  submit,
}: {
  config: WordCloudConfig
  response: WordCloudResponse | null
  open: boolean
  submit: (response: WordCloudResponse) => Promise<void>
}) {
  const [text, setText] = useState(response?.words.join("\n") ?? "")
  const [saving, setSaving] = useState(false)
  useEffect(() => setText(response?.words.join("\n") ?? ""), [response])
  const entries = text.split(/\r?\n/u).filter((line) => line.trim())
  const parsed = wordCloud.responseSchema(config).safeParse({ words: entries })
  const dirty =
    JSON.stringify(parsed.success ? parsed.data.words : entries.map(normalizeWord)) !==
    JSON.stringify(response?.words ?? [])

  const send = async () => {
    if (!open || saving || !parsed.success) return
    setSaving(true)
    try {
      await submit(parsed.data)
    } catch {
      // The audience page displays the error; keep the draft so it can be retried.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold leading-tight text-balance text-white sm:text-3xl">
        {config.prompt}
      </h2>
      <label className="block space-y-2">
        <span className="text-sm text-sky-100">
          Up to {config.maxWords} words or short phrases, one per line (60 characters each).
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!open || saving}
          rows={Math.min(config.maxWords + 1, 6)}
          maxLength={2010}
          className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-lg text-white outline-none focus:border-sky-300 disabled:opacity-60"
        />
      </label>
      {open && (
        <button
          type="button"
          disabled={!parsed.success || !dirty || saving}
          onClick={() => void send()}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-semibold text-brand-950 transition disabled:opacity-40"
        >
          {saving ? "Sending…" : response ? "Update answer" : "Send"}
        </button>
      )}
      {open && entries.length > 0 && !parsed.success && (
        <p className="text-sm text-amber-200">
          Use up to {config.maxWords} lines, with at most 60 characters per entry.
        </p>
      )}
      {!open ? (
        response ? (
          <Verdict tone="info" emoji="☁️" title="Your words are in the cloud!">
            Can you spot them on the screen?
          </Verdict>
        ) : (
          <Verdict tone="info" emoji="🌫️" title="Answers are closed">
            No words from you this time.
          </Verdict>
        )
      ) : response && !dirty ? (
        <Saved id={response}>Answer saved ✓ You can change it until answers close.</Saved>
      ) : (
        <p className="text-center text-sm text-sky-100/70">
          The more people repeat a word, the larger it appears.
        </p>
      )}
    </div>
  )
}

function Results({ results }: { config: WordCloudConfig; results: WordCloudResults }) {
  const max = results.words.reduce((value, word) => Math.max(value, word.count), 1)
  return (
    <div className="space-y-3">
      <section
        className="flex min-h-32 flex-wrap items-center justify-center gap-x-3 gap-y-2"
        aria-label="Word cloud"
      >
        {results.words.length === 0 ? (
          <p className="text-sm text-slate-500">Waiting for answers…</p>
        ) : (
          results.words.map(({ text, count }) => (
            <span
              key={text}
              title={`${count} respondents`}
              className="max-w-full break-words font-semibold text-blue-600 transition-all"
              style={{ fontSize: `${14 + 34 * (count / max)}px`, lineHeight: 1.2 }}
            >
              {text}
              <span className="sr-only">: {count} respondents</span>
            </span>
          ))
        )}
      </section>
      <p className="text-xs text-slate-500">{results.totalRespondents} respondents</p>
    </div>
  )
}

export const wordCloudUI = defineActivityUI({ definition: wordCloud, Editor, Audience, Results })
