import { useEffect, useState } from "react"
import { Button, cx, Field, Input, shortId, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import { type PollConfig, type PollResponse, type PollResults, poll } from "./definition.ts"

function Editor({ config, onChange }: { config: PollConfig; onChange: (config: PollConfig) => void }) {
  const setOption = (index: number, label: string) =>
    onChange({ ...config, options: config.options.map((o, i) => (i === index ? { ...o, label } : o)) })
  const move = (index: number, delta: number) => {
    const options = [...config.options]
    const [moved] = options.splice(index, 1)
    if (moved) options.splice(index + delta, 0, moved)
    onChange({ ...config, options })
  }
  const remove = (index: number) => {
    const options = config.options.filter((_, i) => i !== index)
    onChange({ ...config, options, maxChoices: Math.min(config.maxChoices, Math.max(1, options.length)) })
  }

  return (
    <div className="space-y-4">
      <Field label="Question">
        <Textarea
          value={config.question}
          onChange={(e) => onChange({ ...config, question: e.target.value })}
          placeholder="What should we order for dinner?"
        />
      </Field>
      <div className="space-y-2">
        <span className="text-sm font-medium text-slate-700">Options</span>
        {config.options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            <span className="w-6 text-right text-xs text-slate-400">{index + 1}</span>
            <Input
              value={option.label}
              onChange={(e) => setOption(index, e.target.value)}
              placeholder={`Option ${index + 1}`}
            />
            <Button variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} title="Move up">
              ↑
            </Button>
            <Button
              variant="ghost"
              disabled={index === config.options.length - 1}
              onClick={() => move(index, 1)}
              title="Move down"
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              disabled={config.options.length <= 2}
              onClick={() => remove(index)}
              title="Remove"
            >
              ✕
            </Button>
          </div>
        ))}
        <Button
          disabled={config.options.length >= 12}
          onClick={() => onChange({ ...config, options: [...config.options, { id: shortId(), label: "" }] })}
        >
          + Add option
        </Button>
      </div>
      <Field label="Choices per person" hint="1 for a classic poll, more to let people pick several options.">
        <Input
          type="number"
          min={1}
          max={config.options.length}
          value={config.maxChoices}
          onChange={(e) => onChange({ ...config, maxChoices: Number(e.target.value) || 1 })}
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
  config: PollConfig
  response: PollResponse | null
  open: boolean
  submit: (response: PollResponse) => Promise<void>
}) {
  const single = config.maxChoices === 1
  const [selected, setSelected] = useState<string[]>(response?.choices ?? [])
  const [saving, setSaving] = useState(false)
  const saved = response?.choices ?? []
  const dirty = selected.length !== saved.length || selected.some((id) => !saved.includes(id))

  // A new saved answer (e.g. from another tab) wins over local edits.
  useEffect(() => setSelected(response?.choices ?? []), [response])

  const send = async (choices: string[]) => {
    setSaving(true)
    try {
      await submit({ choices })
    } catch {
      setSelected(saved)
    } finally {
      setSaving(false)
    }
  }

  const toggle = (id: string) => {
    if (!open || saving) return
    if (single) {
      setSelected([id])
      void send([id])
      return
    }
    setSelected((current) =>
      current.includes(id)
        ? current.filter((c) => c !== id)
        : current.length < config.maxChoices
          ? [...current, id]
          : current,
    )
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold leading-tight text-balance text-white sm:text-3xl">
        {config.question}
      </h2>
      {!single && open && (
        <p className="text-sm text-sky-200/80">
          Pick up to {config.maxChoices} ({selected.length}/{config.maxChoices})
        </p>
      )}
      <div className="space-y-3">
        {config.options.map((option, index) => {
          const isSelected = selected.includes(option.id)
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              disabled={!open}
              style={{ animationDelay: `${index * 40}ms` }}
              className={cx(
                "animate-pop-in flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left text-lg font-medium transition active:scale-[0.98]",
                isSelected
                  ? "border-sky-300 bg-sky-300 text-brand-950 shadow-lg shadow-sky-500/20"
                  : "border-white/15 bg-white/8 text-white hover:bg-white/12",
                !open && !isSelected && "opacity-50",
                !open && "cursor-default active:scale-100",
              )}
            >
              <span
                className={cx(
                  "flex size-7 shrink-0 items-center justify-center border-2 text-sm",
                  single ? "rounded-full" : "rounded-lg",
                  isSelected ? "border-brand-950 bg-brand-950 text-sky-300" : "border-white/40",
                )}
              >
                {isSelected && "✓"}
              </span>
              <span className="min-w-0 break-words">{option.label}</span>
            </button>
          )
        })}
      </div>
      {open && !single && (
        <button
          type="button"
          disabled={!dirty || selected.length === 0 || saving}
          onClick={() => void send(selected)}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-semibold text-brand-950 transition active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? "Sending…" : saved.length ? "Update vote" : "Vote"}
        </button>
      )}
      <p className="text-center text-sm text-sky-100/70">
        {!open
          ? saved.length
            ? "Voting is closed. Your vote is in!"
            : "Voting is closed."
          : saved.length && !dirty
            ? "Vote saved ✓ You can change it until the poll closes."
            : single
              ? "Tap an option to vote."
              : ""}
      </p>
    </div>
  )
}

function Results({ results }: { config: PollConfig; results: PollResults }) {
  const max = Math.max(1, ...results.options.map((o) => o.votes))
  return (
    <div className="space-y-2">
      {results.options.map((o) => (
        <div key={o.id} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{o.label}</span>
            <span className="tabular-nums text-slate-500">
              {o.votes} · {o.percent}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all"
              style={{ width: `${(o.votes / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">{results.totalVoters} voters</p>
    </div>
  )
}

export const pollUI = defineActivityUI({ definition: poll, Editor, Audience, Results })
