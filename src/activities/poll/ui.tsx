import { useEffect, useState } from "react"
import {
  ChoiceButton,
  Hint,
  Question,
  Saved,
  SubmitButton,
  useOneOf,
  Verdict,
} from "../../client/audience-ui.tsx"
import { Icon } from "../../client/icons.tsx"
import { Bar, Button, Field, Input, shortId, Textarea } from "../../client/ui.tsx"
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
    <div className="space-y-6">
      <Field label="Question">
        <Textarea
          value={config.question}
          onChange={(e) => onChange({ ...config, question: e.target.value })}
          placeholder="What should we order for dinner?"
        />
      </Field>
      <div className="space-y-3">
        <span className="label-caps block">Options</span>
        {config.options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-right font-display text-sm text-slate-400 tabular-nums">
              {index + 1}
            </span>
            <Input
              value={option.label}
              onChange={(e) => setOption(index, e.target.value)}
              placeholder={`Option ${index + 1}`}
            />
            <Button variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} title="Move up">
              <Icon name="arrow-up" />
            </Button>
            <Button
              variant="ghost"
              disabled={index === config.options.length - 1}
              onClick={() => move(index, 1)}
              title="Move down"
            >
              <Icon name="arrow-down" />
            </Button>
            <Button
              variant="ghost"
              disabled={config.options.length <= 2}
              onClick={() => remove(index)}
              title="Remove"
            >
              <Icon name="x" />
            </Button>
          </div>
        ))}
        <Button
          disabled={config.options.length >= 12}
          onClick={() => onChange({ ...config, options: [...config.options, { id: shortId(), label: "" }] })}
        >
          <Icon name="plus" /> Add option
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
  const counted = useOneOf(["Your vote is in!", "Vote counted!", "Democracy thanks you!"])
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
    <div className="space-y-7">
      <Question>{config.question}</Question>
      {!single && open && (
        <Hint>
          Pick up to {config.maxChoices}{" "}
          <span className="font-display font-medium text-sky-700 tabular-nums">
            ({selected.length}/{config.maxChoices})
          </span>
        </Hint>
      )}
      <div className="space-y-3.5">
        {config.options.map((option, index) => (
          <ChoiceButton
            key={option.id}
            selected={selected.includes(option.id)}
            shape={single ? "circle" : "square"}
            onClick={() => toggle(option.id)}
            disabled={!open}
            style={{ animationDelay: `${index * 40}ms` }}
            className="animate-pop-in"
          >
            {option.label}
          </ChoiceButton>
        ))}
      </div>
      {open && !single && (
        <SubmitButton
          disabled={!dirty || selected.length === 0 || saving}
          onClick={() => void send(selected)}
        >
          {saving ? "Sending…" : saved.length ? "Update vote" : "Vote"}
        </SubmitButton>
      )}
      {!open ? (
        saved.length ? (
          <Verdict tone="info" icon="eye" title={counted}>
            Eyes on the screen for the results.
          </Verdict>
        ) : (
          <Verdict tone="info" icon="hourglass" title="You missed this one">
            Voting is closed. Be quicker next time!
          </Verdict>
        )
      ) : saved.length && !dirty ? (
        <Saved id={saved}>Vote saved. You can change it until the poll closes.</Saved>
      ) : (
        single && <Hint className="text-center">Tap an option to vote.</Hint>
      )}
    </div>
  )
}

function Results({ results }: { config: PollConfig; results: PollResults }) {
  const max = Math.max(1, ...results.options.map((o) => o.votes))
  return (
    <div className="space-y-4">
      {results.options.map((o) => (
        <div key={o.id} className="space-y-2">
          <div className="flex justify-between gap-3 text-sm">
            <span className="font-headline text-slate-800">{o.label}</span>
            <span className="text-slate-500 tabular-nums">
              {o.votes} · <b className="font-display font-medium text-pn">{o.percent}%</b>
            </span>
          </div>
          <Bar value={o.votes} max={max} />
        </div>
      ))}
      <p className="text-xs text-slate-500">{results.totalVoters} voters</p>
    </div>
  )
}

export const pollUI = defineActivityUI({ definition: poll, Editor, Audience, Results })
