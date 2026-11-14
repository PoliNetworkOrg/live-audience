import { type ReactNode, useState } from "react"
import { Link } from "wouter"
import { api, useApi, useEventStream } from "../../client/api.ts"
import { Button, Card, Field, Input, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import { Snowfall, StringLights, TreeIllustration, XMAS } from "./decorations.tsx"
import {
  GADGET_NAME,
  type SecretSantaConfig,
  type SecretSantaResults,
  type SecretSantaView,
  secretSanta,
} from "./definition.ts"
import { SECRET_SANTA_PATH } from "./page.tsx"

// ---- admin -------------------------------------------------------------------------------

function Editor({
  config,
  onChange,
}: {
  config: SecretSantaConfig
  onChange: (c: SecretSantaConfig) => void
}) {
  const set = (patch: Partial<SecretSantaConfig>) => onChange({ ...config, ...patch })
  const setGadget = (patch: Partial<SecretSantaConfig["gadget"]>) =>
    set({ gadget: { ...config.gadget, ...patch } })
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Secret Santa never goes on stage: it shows up on the home page for anyone signed in, Soci or not,
        until you hide it. Gifts are handed over in person.
      </p>
      <div className="space-y-2">
        <Checkbox checked={config.visible} onChange={(visible) => set({ visible })}>
          Show on the home page
        </Checkbox>
        <Checkbox checked={config.signupsOpen} onChange={(signupsOpen) => set({ signupsOpen })}>
          Sign-ups open (untick to close them early; they also close at the date below and with the draw)
        </Checkbox>
      </div>
      <Field label="Intro">
        <Textarea value={config.intro} maxLength={600} onChange={(e) => set({ intro: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sign-ups close" hint="Date and time, your time zone. Empty: only by hand.">
          <Input
            type="datetime-local"
            value={toLocalInput(config.signupsCloseAt)}
            onChange={(e) => set({ signupsCloseAt: fromLocalInput(e.target.value) })}
          />
        </Field>
        <Field label="Automatic gift draw" hint="Then everyone signed up gets an email. Empty: by hand.">
          <Input
            type="datetime-local"
            value={toLocalInput(config.drawAt)}
            onChange={(e) => set({ drawAt: fromLocalInput(e.target.value) })}
          />
        </Field>
      </div>
      <Field
        label="Conferma regalo entro"
        hint="Alla scadenza mandiamo l'ultimo avviso. Rimozione dei non confermati alla mezzanotte italiana dello stesso giorno. Vuoto: nessuna rimozione automatica."
      >
        <Input
          type="datetime-local"
          value={toLocalInput(config.confirmationDueAt)}
          onChange={(e) => set({ confirmationDueAt: fromLocalInput(e.target.value) })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Gift exchange" hint="When and where, in person">
          <Input
            value={config.exchange}
            maxLength={200}
            onChange={(e) => set({ exchange: e.target.value })}
          />
        </Field>
        <Field label="Budget" hint="e.g. around €10">
          <Input value={config.budget} maxLength={60} onChange={(e) => set({ budget: e.target.value })} />
        </Field>
      </div>
      <hr className="border-slate-100" />
      <Checkbox checked={config.gadget.enabled} onChange={(enabled) => setGadget({ enabled })}>
        Raccogli adesioni per {GADGET_NAME}
      </Checkbox>
      <p className="text-xs text-slate-500">
        Per ora raccogliamo solo le adesioni al gadget. L'estrazione è sospesa.
      </p>
    </div>
  )
}

/** `<input type="datetime-local">` speaks local time without a zone; the config stores ISO instants. */
function toLocalInput(iso: string) {
  if (!iso) return ""
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : ""
}

function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-blue-600"
      />
      {children}
    </label>
  )
}

function Results({ config, results }: { config: SecretSantaConfig; results: SecretSantaResults }) {
  return (
    <ul className="space-y-1 text-sm">
      <li>{results.participants} signed up</li>
      <li>{results.drawn ? "Gift draw done" : "Gift draw not done yet"}</li>
      {config.gadget.enabled && <li>{results.gadgetEntries} adesioni al gadget</li>}
    </ul>
  )
}

interface AdminView {
  drawnAt: number | null
  withoutEmail: number
  emailsSent: number
  participants: {
    userId: string
    name: string
    gadget: boolean
    hasMatch: boolean | null
    giftConfirmedAt: number | null
  }[]
  removed: { userId: string; name: string; at: number }[]
  gadget: { drawnAt: number; winners: { userId: string; name: string }[] } | null
}

function Admin({ activityId, config }: { activityId: string; config: SecretSantaConfig }) {
  const view = useApi<AdminView>(`/api/admin/secret-santa/${activityId}`)
  const [error, setError] = useState<string | null>(null)
  useEventStream(`/api/admin/events?activity=${encodeURIComponent(activityId)}`, {
    results: () => view.reload(),
  })

  const run = async (path: string, method: "POST" | "DELETE", question: string) => {
    if (!confirm(question)) return
    try {
      view.setData(await api<AdminView>(`/api/admin/secret-santa/${activityId}${path}`, { method }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!view.data) return null
  const { participants, drawnAt, withoutEmail, emailsSent, removed } = view.data
  const unmatched = participants.filter((p) => p.hasMatch === false)
  return (
    <Card className="space-y-4">
      <h2 className="font-medium">Secret Santa</h2>
      <div className="space-y-2">
        <Button
          variant="primary"
          disabled={drawnAt !== null}
          onClick={() =>
            void run(
              "/draw",
              "POST",
              `Draw gifts for ${participants.length} people? Sign-ups close for good and everyone sees who they give a gift to.`,
            )
          }
        >
          {drawnAt ? "Gifts drawn" : "Draw gifts now"}
        </Button>
        {drawnAt !== null && (
          <Button
            variant="danger"
            className="ml-2"
            onClick={() =>
              void run(
                "/undo-draw",
                "POST",
                "Undo the gift draw? Everyone keeps their letter, sign-ups reopen until the closing date, and a new draw will run at the draw date (emails already sent cannot be taken back; everyone is emailed again after the new draw).",
              )
            }
          >
            Undo draw
          </Button>
        )}
        {drawnAt !== null && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            Gifts were drawn on {new Date(drawnAt).toLocaleString()}. Sign-ups stay closed and the dates in
            the form have no effect until you undo the draw.
          </p>
        )}
        <p className="text-xs text-slate-500">
          Nobody, admins included, can see who gives a gift to whom. If someone withdraws after the draw, only
          the person giving them a gift gets a new match.
        </p>
        <p className="text-xs text-slate-500">
          {drawnAt
            ? `Draw emails sent: ${emailsSent} of ${participants.length}.`
            : config.drawAt
              ? `Automatic draw on ${new Date(config.drawAt).toLocaleString()}.`
              : "No automatic draw: use the button."}
          {withoutEmail > 0 && ` ${withoutEmail} without an email address: they will not get the email.`}
        </p>
      </div>
      {removed.length > 0 && (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          Rimossi per mancata conferma: {removed.map((p) => p.name).join(", ")}.
        </p>
      )}
      {unmatched.length > 0 && (
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          Left without a match after withdrawals: {unmatched.map((p) => p.name).join(", ")}.
        </p>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <ul className="max-h-80 divide-y divide-slate-100 overflow-auto text-sm">
        {participants.map((p) => (
          <li key={p.userId} className="flex items-center gap-2 py-1.5">
            <span className="mr-auto break-words">
              {p.name}
              {drawnAt !== null && (
                <span className="ml-2 text-xs text-slate-500">
                  {p.giftConfirmedAt !== null
                    ? "Regalo confermato"
                    : p.hasMatch
                      ? "Da confermare"
                      : "Senza destinatario"}
                </span>
              )}
              {config.gadget.enabled && p.gadget && (
                <span className="ml-1 text-xs text-slate-400" title="Iscritto al gadget">
                  · gadget
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              onClick={() =>
                void run(
                  `/participants/${encodeURIComponent(p.userId)}`,
                  "DELETE",
                  `Remove ${p.name} from the Secret Santa?`,
                )
              }
            >
              Remove
            </Button>
          </li>
        ))}
        {participants.length === 0 && <li className="py-1.5 text-slate-500">Nobody yet.</li>}
      </ul>
    </Card>
  )
}

/** Shown only if an admin puts it on stage anyway: everything happens on the home page. */
function Audience() {
  return (
    <p className="text-center text-sky-100/80">
      Il Secret Santa ha una pagina tutta sua:{" "}
      <Link href={SECRET_SANTA_PATH} className="underline">
        aprila qui
      </Link>
    </p>
  )
}

export const secretSantaUI = defineActivityUI({ definition: secretSanta, Editor, Audience, Results, Admin })

// ---- home page ---------------------------------------------------------------------------

/** Every visible Secret Santa for whoever is signed in; `null` while loading. */
export function useSecretSantas(): SecretSantaView[] | null {
  const list = useApi<SecretSantaView[]>("/api/secret-santa")
  return list.data ?? (list.loading ? null : [])
}

/** Small festive invitations to the Secret Santa page, one per visible Secret Santa. */
export function SecretSantaTeasers({ santas }: { santas: SecretSantaView[] }) {
  return (
    <div className="space-y-4">
      {santas.map((santa) => (
        <Link
          key={santa.id}
          href={SECRET_SANTA_PATH}
          className="animate-pop-in group relative block overflow-hidden rounded-3xl bg-white px-5 pt-12 pb-5 shadow-xl transition active:scale-[0.98]"
          style={{ color: XMAS.navy }}
        >
          <StringLights className="absolute inset-x-0 top-0" />
          <Snowfall fixed={false} />
          <span className="relative flex items-center gap-4">
            <TreeIllustration className="h-20 w-16 shrink-0" />
            <span className="min-w-0 flex-1">
              <span
                className="block text-xs font-semibold tracking-[0.25em] uppercase"
                style={{ color: XMAS.blue }}
              >
                Secret Santa
              </span>
              <span className="block text-xl font-semibold tracking-tight text-balance">{santa.title}</span>
              <span className="mt-1 block text-sm" style={{ color: XMAS.muted }}>
                {teaserStatus(santa)}
              </span>
            </span>
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-transform duration-200 ease-out group-hover:translate-x-1"
              style={{ background: XMAS.blue }}
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </span>
        </Link>
      ))}
    </div>
  )
}

function teaserStatus(santa: SecretSantaView) {
  if (santa.removed) return "Sei stato rimosso per mancata conferma del regalo"
  if (!santa.entry)
    return santa.canJoin ? "Scrivi la tua letterina per partecipare" : "Le iscrizioni sono chiuse"
  if (!santa.drawn) return "Ci sei! In attesa dell'estrazione"
  if (santa.match) return "Estrazione fatta: apri la tua lettera dorata"
  return "Apri per le novità sul tuo abbinamento"
}
