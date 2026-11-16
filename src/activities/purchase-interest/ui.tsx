import { useEffect, useState } from "react"
import {
  audienceField,
  ChoiceButton,
  Hint,
  Question,
  Saved,
  SubmitButton,
  Verdict,
} from "../../client/audience-ui.tsx"
import { Field, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import {
  type PurchaseConfig,
  type PurchaseResponse,
  type PurchaseResults,
  purchaseInterest,
} from "./definition.ts"

function Editor({
  config,
  onChange,
}: {
  config: PurchaseConfig
  onChange: (config: PurchaseConfig) => void
}) {
  return (
    <div className="space-y-6">
      <Field label="Question">
        <Textarea value={config.question} onChange={(event) => onChange({ question: event.target.value })} />
      </Field>
      <p className="text-sm text-slate-500">
        Yes requires a price in whole euros. Results use €10 bands: 0–10, 11–20, 21–30… No responses form one
        separate bar.
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
  config: PurchaseConfig
  response: PurchaseResponse | null
  open: boolean
  submit: (response: PurchaseResponse) => Promise<void>
}) {
  const [buy, setBuy] = useState<boolean | null>(response?.buy ?? null)
  const [price, setPrice] = useState(response?.buy ? String(response.price) : "")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setBuy(response?.buy ?? null)
    setPrice(response?.buy ? String(response.price) : "")
  }, [response])
  const parsed = purchaseInterest
    .responseSchema(config)
    .safeParse(buy === true ? { buy, price: price.trim() ? Number(price) : NaN } : { buy })
  const dirty = parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(response)
  const send = async () => {
    if (!open || saving || !parsed.success) return
    setSaving(true)
    try {
      await submit(parsed.data)
    } catch {
      /* The audience page displays errors; preserve the draft. */
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-3 tall:space-y-4">
      <Question>{config.question}</Question>
      <div className="grid grid-cols-2 gap-3.5">
        {[true, false].map((value) => (
          <ChoiceButton
            key={String(value)}
            selected={buy === value}
            disabled={!open || saving}
            onClick={() => {
              setBuy(value)
              if (!value) setPrice("")
            }}
            className="justify-center text-xl"
          >
            {value ? "Yes" : "No"}
          </ChoiceButton>
        ))}
      </div>
      {buy && (
        <label className="block space-y-2.5">
          <Hint>Maximum price you would pay (€), in whole euros</Hint>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            disabled={!open || saving}
            className={audienceField}
          />
        </label>
      )}
      {open && (
        <SubmitButton disabled={!dirty || saving} onClick={() => void send()}>
          {saving ? "Sending…" : response ? "Update answer" : "Send answer"}
        </SubmitButton>
      )}
      {!open ? (
        response?.buy ? (
          <Verdict tone="info" icon="cart" title="Noted!">
            You'd pay up to €{response.price}. Let's see what everyone else said.
          </Verdict>
        ) : response ? (
          <Verdict tone="info" icon="circle-check" title="Noted!">
            Not for you, and that's useful to know too.
          </Verdict>
        ) : (
          <Verdict tone="info" icon="lock" title="Answers are closed">
            No answer from you this time.
          </Verdict>
        )
      ) : response && !dirty ? (
        <Saved id={response}>Answer saved. You can change it until answers close.</Saved>
      ) : (
        <Hint className="text-center">{buy ? "Enter the price before sending." : "Choose yes or no."}</Hint>
      )}
    </div>
  )
}

function Results({ results }: { config: PurchaseConfig; results: PurchaseResults }) {
  const bars = [
    { label: "No", count: results.no, percent: results.noPercent },
    ...results.bands.map((band) => ({
      label: `Yes, ${band.label}`,
      count: band.count,
      percent: band.percent,
    })),
  ]
  const max = bars.reduce((best, bar) => Math.max(best, bar.count), 1)
  return (
    <div className="space-y-4">
      <div className="max-h-96 space-y-4 overflow-auto">
        {bars.map((bar, index) => (
          <div key={bar.label} className="space-y-2">
            <div className="flex justify-between gap-2 text-sm">
              <span className="font-headline text-slate-800">{bar.label}</span>
              <span className="text-slate-500 tabular-nums">
                {bar.count} · <b className="font-display font-medium text-pn">{bar.percent}%</b>
              </span>
            </div>
            <div className="bar-track h-2.5">
              <div
                className="bar-fill"
                style={{
                  width: `${(bar.count / max) * 100}%`,
                  // "No" stands apart from the price bands.
                  background: index === 0 ? "var(--color-rose-400)" : undefined,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {results.totalRespondents} respondents: {results.yes} yes, {results.no} no
      </p>
    </div>
  )
}

export const purchaseInterestUI = defineActivityUI({
  definition: purchaseInterest,
  Editor,
  Audience,
  Results,
})
