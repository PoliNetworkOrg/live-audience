import { Link } from "wouter"
import { useApi } from "../../client/api.ts"
import { Field, Input, Toggle } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import { SecretSantaAdmin } from "./admin.tsx"
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
        Secret Santa never goes on stage and never scores points: it shows up on the home page for anyone
        signed in (only Soci with "Soci only" on) until you hide it. Gifts are handed over in person.
      </p>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Toggle
          label="Show on the home page"
          checked={config.visible}
          onChange={(visible) => set({ visible })}
        />
        <Toggle
          label="Sign-ups open"
          hint="Off: close them early. They also close at the date below and with the draw."
          checked={config.signupsOpen}
          onChange={(signupsOpen) => set({ signupsOpen })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sign-ups close" hint="Date and time, your time zone. Empty: only by hand.">
          <Input
            type="datetime-local"
            value={toLocalInput(config.signupsCloseAt)}
            onChange={(e) => set({ signupsCloseAt: fromLocalInput(e.target.value) })}
          />
        </Field>
        <Field label="Automatic gift draw" hint="Date and time, your time zone. Empty: by hand.">
          <Input
            type="datetime-local"
            value={toLocalInput(config.drawAt)}
            onChange={(e) => set({ drawAt: fromLocalInput(e.target.value) })}
          />
        </Field>
      </div>
      <Field
        label="Invio email estrazione"
        hint="Fino a questo momento gli abbinamenti sono una bozza: solo gli admin li vedono e possono modificarli, senza mandare email. Vuoto: le email partono subito dopo l'estrazione."
      >
        <Input
          type="datetime-local"
          value={toLocalInput(config.revealAt)}
          onChange={(e) => set({ revealAt: fromLocalInput(e.target.value) })}
        />
      </Field>
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
      <hr className="border-t-[1.5px] border-white" />
      <Toggle
        label={`Raccogli adesioni per ${GADGET_NAME}`}
        hint="Per ora raccogliamo solo le adesioni al gadget. L'estrazione è sospesa."
        checked={config.gadget.enabled}
        onChange={(enabled) => setGadget({ enabled })}
      />
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

function Results({ config, results }: { config: SecretSantaConfig; results: SecretSantaResults }) {
  return (
    <ul className="space-y-1 text-sm">
      <li>{results.participants} signed up</li>
      <li>{results.drawn ? "Gift draw done" : "Gift draw not done yet"}</li>
      {config.gadget.enabled && <li>{results.gadgetEntries} adesioni al gadget</li>}
    </ul>
  )
}

/** Shown only if an admin puts it on stage anyway: everything happens on the home page. */
function Audience() {
  return (
    <p className="text-center font-headline text-slate-600">
      Il Secret Santa ha una pagina tutta sua:{" "}
      <Link href={SECRET_SANTA_PATH} className="font-medium text-pn underline underline-offset-4">
        aprila qui
      </Link>
    </p>
  )
}

export const secretSantaUI = defineActivityUI({
  definition: secretSanta,
  Editor,
  Audience,
  Results,
  Admin: SecretSantaAdmin,
})

// ---- home page ---------------------------------------------------------------------------

/** Every visible Secret Santa for whoever is signed in; `null` while loading. */
export function useSecretSantas(): SecretSantaView[] | null {
  const list = useApi<SecretSantaView[]>("/api/secret-santa")
  return list.data ?? (list.loading ? null : [])
}

/** Small festive invitations to the Secret Santa page, one per visible Secret Santa. */
/**
 * `compact` while an activity is live: one short line, so the activity still fits one phone screen.
 */
export function SecretSantaTeasers({
  santas,
  compact = false,
}: {
  santas: SecretSantaView[]
  compact?: boolean
}) {
  if (compact) {
    return (
      <div className="space-y-2">
        {santas.map((santa) => (
          <Link
            key={santa.id}
            href={SECRET_SANTA_PATH}
            className="group flex items-center gap-2 rounded-full border-[1.5px] border-white bg-white px-4 py-1.5 text-sm shadow-[0_12px_30px_-24px_rgb(17_86_174/0.45)] transition active:scale-[0.98]"
            style={{ color: XMAS.navy }}
          >
            <span
              className="shrink-0 text-[0.7rem] font-semibold tracking-[0.2em] uppercase"
              style={{ color: XMAS.blue }}
            >
              Secret Santa
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{santa.title}</span>
            <ArrowIcon className="size-4 shrink-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {santas.map((santa) => (
        <Link
          key={santa.id}
          href={SECRET_SANTA_PATH}
          className="animate-pop-in group relative block overflow-hidden rounded-[20px] border-[1.5px] border-white bg-white px-5 pt-12 pb-5 shadow-[0_30px_60px_-36px_rgb(17_86_174/0.45)] transition active:scale-[0.98]"
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
              <ArrowIcon className="size-5" />
            </span>
          </span>
        </Link>
      ))}
    </div>
  )
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
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
