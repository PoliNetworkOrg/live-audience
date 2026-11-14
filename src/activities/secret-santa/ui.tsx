import { type ReactNode, useState } from "react"
import { Link } from "wouter"
import { api, useApi, useEventStream } from "../../client/api.ts"
import { Button, Card, Field, Input, Textarea } from "../../client/ui.tsx"
import { defineActivityUI } from "../ui-types.ts"
import { Snowfall, StringLights, TreeIllustration, XMAS } from "./decorations.tsx"
import {
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
          Sign-ups open (they close for good with the gift draw)
        </Checkbox>
      </div>
      <Field label="Intro">
        <Textarea value={config.intro} maxLength={600} onChange={(e) => set({ intro: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sign up by" hint="e.g. 12 December">
          <Input
            value={config.deadline}
            maxLength={120}
            onChange={(e) => set({ deadline: e.target.value })}
          />
        </Field>
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
        Gadget draw: people can also enter a secret draw for a prize
      </Checkbox>
      {config.gadget.enabled && (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <Field label="Prize">
            <Input
              value={config.gadget.prize}
              maxLength={120}
              onChange={(e) => setGadget({ prize: e.target.value })}
            />
          </Field>
          <Field label="Winners">
            <Input
              type="number"
              min={1}
              max={20}
              value={config.gadget.winners}
              onChange={(e) => setGadget({ winners: Math.trunc(Number(e.target.value)) || 1 })}
            />
          </Field>
        </div>
      )}
    </div>
  )
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
      {config.gadget.enabled && (
        <li>
          {results.gadgetEntries} in the gadget draw{results.gadgetDrawn ? ", winners drawn" : ""}
        </li>
      )}
    </ul>
  )
}

interface AdminView {
  drawnAt: number | null
  participants: { userId: string; name: string; gadget: boolean; hasMatch: boolean | null }[]
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
  const { participants, drawnAt, gadget } = view.data
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
          {drawnAt ? "Gifts drawn ✓" : "🎁 Draw gifts"}
        </Button>
        {config.gadget.enabled && (
          <Button
            variant="secondary"
            className="ml-2"
            disabled={gadget !== null}
            onClick={() =>
              void run("/gadget-draw", "POST", "Draw the gadget winners now? Entries for it close for good.")
            }
          >
            {gadget ? "Gadget drawn ✓" : "Draw gadget"}
          </Button>
        )}
        <p className="text-xs text-slate-500">
          Nobody, admins included, can see who gives a gift to whom. If someone withdraws after the draw, only
          the person giving them a gift gets a new match.
        </p>
      </div>
      {gadget && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Gadget winners</p>
          <p>{gadget.winners.map((w) => w.name).join(", ") || "Nobody left: every winner withdrew"}</p>
        </div>
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
              {config.gadget.enabled && p.gadget && (
                <span className="ml-1 text-xs text-slate-400" title="In the gadget draw">
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
      Secret Santa has its own page:{" "}
      <Link href={SECRET_SANTA_PATH} className="underline">
        open it here 🎄
      </Link>
    </p>
  )
}

export const secretSantaUI = defineActivityUI({ definition: secretSanta, Editor, Audience, Results, Admin })

// ---- home page ---------------------------------------------------------------------------

/** A small festive invitation to the Secret Santa page. Renders `empty` when there is none. */
export function SecretSantaHome({ empty = null }: { empty?: ReactNode }) {
  const list = useApi<SecretSantaView[]>("/api/secret-santa")
  if (list.loading && !list.data) return null
  if (!list.data?.length) return empty
  return (
    <div className="space-y-4">
      {list.data.map((santa) => (
        <Link
          key={santa.id}
          href={SECRET_SANTA_PATH}
          className="animate-pop-in group relative block overflow-hidden rounded-3xl px-5 pt-12 pb-5 shadow-xl ring-1 ring-white/10 transition active:scale-[0.98]"
          style={{ background: `linear-gradient(160deg, ${XMAS.night}, ${XMAS.pine})` }}
        >
          <StringLights />
          <Snowfall fixed={false} />
          <span className="relative flex items-center gap-4">
            <TreeIllustration className="h-20 w-16 shrink-0" />
            <span className="min-w-0 flex-1">
              <span
                className="block text-xs font-semibold tracking-[0.25em] uppercase"
                style={{ color: XMAS.gold }}
              >
                Secret Santa
              </span>
              <span className="block text-xl font-semibold tracking-tight text-balance">{santa.title}</span>
              <span className="mt-1 block text-sm text-sky-100/80">{teaserStatus(santa)}</span>
            </span>
            <span
              aria-hidden
              className="text-2xl transition-transform duration-200 ease-out group-hover:translate-x-1"
              style={{ color: XMAS.gold }}
            >
              →
            </span>
          </span>
        </Link>
      ))}
    </div>
  )
}

function teaserStatus(santa: SecretSantaView) {
  if (!santa.entry) return santa.canJoin ? "Write your letter to join ✉️" : "Sign-ups are closed"
  if (!santa.drawn) return "You're on the list! Waiting for the draw"
  if (santa.match) return "The draw is done: unwrap your present 🎁"
  return "Open for news about your match"
}
