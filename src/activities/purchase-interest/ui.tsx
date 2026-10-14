import { useEffect, useState } from "react"
import { Saved, Verdict } from "../../client/audience-ui.tsx"
import { cx, Field, Textarea } from "../../client/ui.tsx"
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
    <div className="space-y-3">
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
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold text-white">{config.question}</h2>
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={buy === value}
            disabled={!open || saving}
            onClick={() => {
              setBuy(value)
              if (!value) setPrice("")
            }}
            className={cx(
              "rounded-2xl border px-5 py-4 text-xl font-semibold transition disabled:opacity-60",
              buy === value
                ? "border-sky-300 bg-sky-300 text-brand-950"
                : "border-white/20 bg-white/10 text-white",
            )}
          >
            {value ? "Yes" : "No"}
          </button>
        ))}
      </div>
      {buy && (
        <label className="block space-y-2">
          <span className="text-sm text-sky-100">Maximum price you would pay (€), in whole euros</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            disabled={!open || saving}
            className="w-full rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-lg text-white outline-none focus:border-sky-300 disabled:opacity-60"
          />
        </label>
      )}
      {open && (
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void send()}
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg font-semibold text-brand-950 disabled:opacity-40"
        >
          {saving ? "Sending…" : response ? "Update answer" : "Send answer"}
        </button>
      )}
      {!open ? (
        response?.buy ? (
          <Verdict tone="info" emoji="🛒" title="Noted!">
            You'd pay up to €{response.price}. Let's see what everyone else said.
          </Verdict>
        ) : response ? (
          <Verdict tone="info" emoji="👌" title="Noted!">
            Not for you, and that's useful to know too.
          </Verdict>
        ) : (
          <Verdict tone="info" emoji="🔒" title="Answers are closed">
            No answer from you this time.
          </Verdict>
        )
      ) : response && !dirty ? (
        <Saved id={response}>Answer saved ✓ You can change it until answers close.</Saved>
      ) : (
        <p className="text-center text-sm text-sky-100/70">
          {buy ? "Enter the price before sending." : "Choose yes or no."}
        </p>
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
    <div className="space-y-3">
      <div className="max-h-96 space-y-3 overflow-auto">
        {bars.map((bar, index) => (
          <div key={bar.label}>
            <div className="flex justify-between gap-2 text-sm">
              <span>{bar.label}</span>
              <span>
                {bar.count} ({bar.percent}%)
              </span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-slate-100">
              <div
                className={cx("h-3 rounded-full transition-all", index === 0 ? "bg-rose-500" : "bg-blue-600")}
                style={{ width: `${(bar.count / max) * 100}%` }}
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
