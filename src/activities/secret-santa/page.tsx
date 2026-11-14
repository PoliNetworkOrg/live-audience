import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"
import { Link } from "wouter"
import { api, loginUrl, logout, type Me, useApi, useMe } from "../../client/api.ts"
import {
  Burst,
  GiftBox,
  Moon,
  Snowfall,
  SnowyHills,
  Stamp,
  StarrySky,
  StringLights,
  TreeIllustration,
  XMAS,
} from "./decorations.tsx"
import {
  type SecretSantaConfig,
  type SecretSantaEntry,
  type SecretSantaView,
  secretSanta,
} from "./definition.ts"

/** The Secret Santa page (`/secret-santa`): what participants see, dressed up for Christmas. */

export const SECRET_SANTA_PATH = "/secret-santa"
const PAPER = "oklch(97.5% 0.02 90)"
const INK = "oklch(28% 0.03 250)"

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function SecretSantaPage() {
  const me = useMe()
  const user = me.data?.user
  useEffect(() => {
    const previous = document.title
    document.title = "Secret Santa · PoliNetwork"
    return () => {
      document.title = previous
    }
  }, [])

  let content: ReactNode
  if (me.loading && !me.data) content = <Spinner />
  else if (!user) content = <SignedOut />
  else content = <SecretSantas />

  return (
    <div
      className="relative min-h-dvh overflow-x-hidden text-white"
      style={{
        background: `linear-gradient(to bottom, ${XMAS.night} 0%, oklch(22% 0.06 250) 45%, oklch(28% 0.06 225) 100%)`,
      }}
    >
      <StarrySky />
      <Snowfall />
      <SnowyHills />
      <header className="relative z-10 pt-[env(safe-area-inset-top)]">
        <StringLights />
        <Moon className="pointer-events-none absolute top-24 right-[6%] size-12 sm:size-20" />
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 pt-14">
          <Link href="/" className="flex items-center gap-2 text-sm text-sky-100/80 hover:text-white">
            <img src="/logo.png" alt="" className="size-7 rounded-full" />
            <span>
              PoliNetwork <span className="text-sky-300">Live</span>
            </span>
          </Link>
          {user && <UserChip user={user} />}
        </div>
      </header>
      <main className="relative z-10 mx-auto w-full max-w-lg px-5 pt-8 pb-[max(14rem,28vh)]">{content}</main>
    </div>
  )
}

function UserChip({ user }: { user: Me }) {
  return (
    <button
      type="button"
      onClick={() => void logout()}
      title="Sign out"
      className="flex items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 text-sm backdrop-blur-sm hover:bg-white/15"
    >
      {user.picture ? (
        <img src={user.picture} alt="" className="size-6 rounded-full" />
      ) : (
        <span
          className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
          style={{ background: XMAS.gold, color: XMAS.night }}
        >
          {user.name.slice(0, 1)}
        </span>
      )}
      <span className="max-w-32 truncate">{user.name.split(" ")[0]}</span>
    </button>
  )
}

function SignedOut() {
  return (
    <div className="xmas-rise space-y-6 text-center">
      <TreeIllustration className="mx-auto h-36 w-28" />
      <Eyebrow>Secret Santa</Eyebrow>
      <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Someone at PoliNetwork has a present for you
      </h1>
      <p className="text-pretty text-sky-100/80">
        Sign in with your PoliNetwork account to write your letter and find out who you're surprising.
      </p>
      <a
        href={loginUrl(SECRET_SANTA_PATH)}
        className="inline-flex w-full items-center justify-center rounded-full px-6 py-4 text-lg font-semibold shadow-lg transition active:scale-[0.97]"
        style={{ background: XMAS.red }}
      >
        Sign in with PoliNetwork
      </a>
    </div>
  )
}

function SecretSantas() {
  const list = useApi<SecretSantaView[]>("/api/secret-santa")
  if (list.loading && !list.data) return <Spinner />
  if (list.error) return <p className="text-center text-rose-200">{list.error.message}</p>
  if (!list.data?.length) {
    return (
      <div className="xmas-rise space-y-5 text-center">
        <TreeIllustration className="mx-auto h-32 w-24" />
        <h1 className="text-3xl font-semibold tracking-tight">No Secret Santa right now</h1>
        <p className="text-sky-100/80">
          The elves are still wrapping things up. Come back closer to Christmas!
        </p>
        <Link href="/" className="inline-block text-sm text-sky-200 underline">
          Back to PoliNetwork Live
        </Link>
      </div>
    )
  }
  return (
    <div className="space-y-24">
      {list.data.map((santa) => (
        <SantaExperience
          key={santa.id}
          santa={santa}
          onChange={(next) => list.setData((list.data ?? []).map((s) => (s.id === next.id ? next : s)))}
        />
      ))}
    </div>
  )
}

function SantaExperience({
  santa,
  onChange,
}: {
  santa: SecretSantaView
  onChange: (s: SecretSantaView) => void
}) {
  const [editing, setEditing] = useState(false)
  const [justJoined, setJustJoined] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { config, entry } = santa

  const save = async (next: SecretSantaEntry) => {
    try {
      const saved = await api<SecretSantaView>(`/api/secret-santa/${santa.id}/entry`, {
        method: "PUT",
        body: next,
      })
      setJustJoined(!entry)
      onChange(saved)
      setEditing(false)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    }
  }
  const withdraw = async () => {
    const warning = santa.drawn
      ? "Withdraw from Secret Santa? The person you were giving a present to will get a new Santa, and you can't join again."
      : "Withdraw from Secret Santa? You can write a new letter until the draw."
    if (!confirm(warning)) return
    try {
      onChange(await api<SecretSantaView>(`/api/secret-santa/${santa.id}/entry`, { method: "DELETE" }))
      setEditing(false)
      setJustJoined(false)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    }
  }

  let body: ReactNode
  if (!entry && !santa.canJoin) {
    body = (
      <Paper className="text-center">
        <p className="text-4xl">🔔</p>
        <p className="mt-2 text-xl font-semibold">Sign-ups are closed</p>
        <p className="mt-1 text-sm opacity-70">
          The elves have sealed the mailbox for this year. See you next Christmas!
        </p>
      </Paper>
    )
  } else if (!entry || editing) {
    body = (
      <Letter
        config={config}
        entry={entry}
        gadgetLocked={santa.gadgetDrawn}
        onSave={save}
        onCancel={entry ? () => setEditing(false) : undefined}
      />
    )
  } else if (!santa.drawn) {
    body = <Waiting santa={santa} justJoined={justJoined} />
  } else if (santa.match) {
    body = <Reveal activityId={santa.id} match={santa.match} exchange={config.exchange} />
  } else {
    body = (
      <Paper className="text-center">
        <p className="text-4xl">🧦</p>
        <p className="mt-2 font-semibold">After a withdrawal there's nobody left for you to surprise.</p>
        <p className="mt-1 text-sm opacity-70">The organisers will be in touch.</p>
      </Paper>
    )
  }

  return (
    <article aria-labelledby={`santa-${santa.id}`} className="space-y-8">
      <Hero santa={santa} />
      <Steps santa={santa} />
      {body}
      {entry && !editing && <GadgetTicket santa={santa} />}
      {error && (
        <p role="alert" className="rounded-2xl bg-rose-500/25 px-4 py-3 text-center text-sm text-rose-50">
          {error}
        </p>
      )}
      {entry && !editing && (
        <div className="flex justify-center gap-6 text-sm">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sky-100 underline underline-offset-4"
          >
            Edit my letter
          </button>
          <button
            type="button"
            onClick={() => void withdraw()}
            className="text-sky-100/60 underline underline-offset-4"
          >
            Withdraw
          </button>
        </div>
      )}
    </article>
  )
}

// ---- hero, steps and details --------------------------------------------------------------

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-[0.25em] uppercase" style={{ color: XMAS.gold }}>
      {children}
    </p>
  )
}

function daysToChristmas(now: Date) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.UTC(now.getFullYear(), 11, 25) - today) / 86_400_000)
}

function Hero({ santa }: { santa: SecretSantaView }) {
  const days = daysToChristmas(new Date())
  const { config } = santa
  const details = [
    config.deadline && { icon: "✉️", label: "Letters by", value: config.deadline },
    config.exchange && { icon: "🤝", label: "Gift exchange", value: config.exchange },
    config.budget && { icon: "💶", label: "Budget", value: config.budget },
  ].filter(Boolean) as { icon: string; label: string; value: string }[]
  return (
    <section className="xmas-rise space-y-5 text-center">
      <TreeIllustration className="mx-auto h-36 w-28 drop-shadow-[0_0_24px_oklch(86%_0.14_88/0.25)]" />
      <Eyebrow>Secret Santa</Eyebrow>
      <h1 id={`santa-${santa.id}`} className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        {santa.title}
      </h1>
      {days >= 0 && (
        <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur-sm">
          <span aria-hidden>🎄</span>
          {days === 0 ? "Merry Christmas!" : days === 1 ? "1 day to Christmas" : `${days} days to Christmas`}
        </p>
      )}
      {config.intro && <p className="mx-auto max-w-md text-pretty text-sky-50/85">{config.intro}</p>}
      {details.length > 0 && (
        <dl className="flex flex-wrap justify-center gap-2 text-sm">
          {details.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1.5 backdrop-blur-sm"
            >
              <span aria-hidden>{item.icon}</span>
              <dt className="text-sky-100/70">{item.label}</dt>
              <dd className="font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function Steps({ santa }: { santa: SecretSantaView }) {
  const steps = [
    { label: "Write your letter", done: Boolean(santa.entry) },
    { label: "The draw", done: santa.drawn },
    { label: "Gift exchange", done: false },
  ]
  const current = steps.findIndex((step) => !step.done)
  return (
    <ol className="grid grid-cols-3 gap-2 text-center text-xs" aria-label="Progress">
      {steps.map((step, i) => (
        <li key={step.label} className="relative flex flex-col items-center gap-2">
          {i > 0 && (
            <span
              aria-hidden
              className="absolute top-4 right-1/2 h-0.5 w-full -translate-x-4"
              style={{ background: steps[i - 1]?.done ? XMAS.gold : "oklch(100% 0 0 / 0.15)" }}
            />
          )}
          <span
            className="relative flex size-8 items-center justify-center rounded-full text-sm font-bold"
            style={
              step.done
                ? { background: XMAS.gold, color: XMAS.night }
                : i === current
                  ? { background: XMAS.red, boxShadow: `0 0 0 4px oklch(60% 0.2 25 / 0.3)` }
                  : { background: "oklch(100% 0 0 / 0.12)", color: "oklch(100% 0 0 / 0.6)" }
            }
            aria-current={i === current ? "step" : undefined}
          >
            {step.done ? (
              <svg viewBox="0 0 16 16" className="size-4" aria-label="done">
                <path
                  d="M3 8.5 6.5 12 13 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              i + 1
            )}
          </span>
          <span className={i === current ? "font-semibold" : "text-sky-100/70"}>{step.label}</span>
        </li>
      ))}
    </ol>
  )
}

// ---- the letter ---------------------------------------------------------------------------

function Paper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`xmas-rise relative overflow-hidden rounded-3xl p-6 pt-8 shadow-2xl ${className}`}
      style={{ background: PAPER, color: INK }}
    >
      <AirmailEdge />
      {children}
    </div>
  )
}

function AirmailEdge() {
  return (
    <span
      aria-hidden
      className="absolute inset-x-0 top-0 h-2"
      style={{
        background: `repeating-linear-gradient(135deg, ${XMAS.red} 0 12px, ${PAPER} 12px 20px, ${XMAS.pine} 20px 32px, ${PAPER} 32px 40px)`,
      }}
    />
  )
}

const linedPaper: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(to bottom, transparent 0 31px, oklch(85% 0.03 250 / 0.7) 31px 32px)",
  lineHeight: "32px",
}

function Letter({
  config,
  entry,
  gadgetLocked,
  onSave,
  onCancel,
}: {
  config: SecretSantaConfig
  entry: SecretSantaEntry | null
  gadgetLocked: boolean
  onSave: (entry: SecretSantaEntry) => Promise<void>
  onCancel?: () => void
}) {
  const [likes, setLikes] = useState(entry?.likes ?? "")
  const [dislikes, setDislikes] = useState(entry?.dislikes ?? "")
  const [gadget, setGadget] = useState(entry?.gadget ?? config.gadget.enabled)
  const [saving, setSaving] = useState(false)
  const parsed = secretSanta.responseSchema(config).safeParse({ likes, dislikes, gadget })
  const prize = config.gadget.prize || "a PoliNetwork gadget"

  const submit = async () => {
    if (!parsed.success || saving) return
    setSaving(true)
    try {
      await onSave(parsed.data)
    } finally {
      setSaving(false)
    }
  }
  const area =
    "block w-full resize-none bg-transparent px-1 text-[17px] outline-none placeholder:text-slate-400 focus-visible:bg-sky-100/40"
  return (
    <Paper>
      <Stamp
        className="absolute top-5 right-5 h-16 w-14 rotate-6"
        paper={PAPER}
        year={new Date().getFullYear()}
      />
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="pr-16">
          <p className="text-2xl font-semibold tracking-tight">Dear Secret Santa,</p>
          <p className="mt-1 text-sm text-slate-500">Not a wish list: just what makes me happy.</p>
        </div>
        <label className="block">
          <span className="text-sm font-semibold" style={{ color: XMAS.redDark }}>
            Things I love
          </span>
          <textarea
            value={likes}
            onChange={(e) => setLikes(e.target.value)}
            maxLength={600}
            rows={4}
            placeholder="Dark chocolate, board games, anything with cats, Studio Ghibli, hiking…"
            className={area}
            style={linedPaper}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold" style={{ color: XMAS.redDark }}>
            Better not <span className="font-normal text-slate-500">(optional)</span>
          </span>
          <textarea
            value={dislikes}
            onChange={(e) => setDislikes(e.target.value)}
            maxLength={400}
            rows={2}
            placeholder="Allergies, things I already have too many of…"
            className={area}
            style={linedPaper}
          />
        </label>
        {config.gadget.enabled && (
          <label
            className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-dashed p-3 text-sm"
            style={{ borderColor: XMAS.goldDark, background: "oklch(94% 0.05 90)" }}
          >
            <input
              type="checkbox"
              checked={gadget}
              disabled={gadgetLocked}
              onChange={(e) => setGadget(e.target.checked)}
              className="mt-0.5 size-5 shrink-0"
              style={{ accentColor: XMAS.redDark }}
            />
            <span>
              <span aria-hidden>🎟 </span>Also put my name in the secret draw for <b>{prize}</b>
              {gadgetLocked && (
                <span className="block text-slate-500">The gadget has already been drawn.</span>
              )}
            </span>
          </label>
        )}
        <p className="text-right text-sm text-slate-500 italic">Only my Secret Santa will read this.</p>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!parsed.success || saving}
            className="flex-1 rounded-full px-6 py-4 text-lg font-semibold text-white shadow-lg transition active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
            style={{ background: XMAS.red }}
          >
            {saving ? "Sending…" : entry ? "Save my letter" : "Send to the North Pole ✉️"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="px-3 text-sm text-slate-500 underline">
              Cancel
            </button>
          )}
        </div>
      </form>
    </Paper>
  )
}

// ---- waiting for the draw -----------------------------------------------------------------

function Waiting({ santa, justJoined }: { santa: SecretSantaView; justJoined: boolean }) {
  const shown = Math.min(santa.participants, 14)
  return (
    <Paper className="text-center">
      {justJoined && (
        <span
          className="xmas-stamp absolute top-8 right-4 rounded-lg border-4 px-2 py-0.5 text-sm font-black tracking-widest uppercase"
          style={{ borderColor: XMAS.red, color: XMAS.red }}
        >
          Sent ✓
        </span>
      )}
      <GiftBox className="xmas-wobble mx-auto h-36 w-36" />
      <p className="mt-2 text-2xl font-semibold tracking-tight">You're on the list!</p>
      <p className="mt-1 text-pretty text-slate-600">
        Your letter is in the North Pole mailbox. Come back after the draw to find out who you're surprising.
      </p>
      <div className="mt-5 space-y-2">
        <div className="flex flex-wrap justify-center gap-1" aria-hidden>
          {Array.from({ length: shown }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: one icon per participant, no identity
              key={i}
              className="xmas-pop text-lg"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {["🎁", "🎄", "⛄", "🧦", "⭐"][i % 5]}
            </span>
          ))}
          {santa.participants > shown && (
            <span className="self-center text-sm text-slate-500">+{santa.participants - shown}</span>
          )}
        </div>
        <p className="text-sm text-slate-500">
          {santa.participants} {santa.participants === 1 ? "elf has" : "elves have"} signed up so far
        </p>
      </div>
    </Paper>
  )
}

// ---- the reveal ---------------------------------------------------------------------------

type RevealStage = "wrapped" | "opening" | "open"

function Reveal({
  activityId,
  match,
  exchange,
}: {
  activityId: string
  match: NonNullable<SecretSantaView["match"]>
  exchange: string
}) {
  const storageKey = `secret-santa-opened:${activityId}:${match.name}`
  const [stage, setStage] = useState<RevealStage>(() => {
    try {
      return localStorage.getItem(storageKey) === "1" ? "open" : "wrapped"
    } catch {
      return "wrapped"
    }
  })
  const [celebrate, setCelebrate] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const unwrap = () => {
    try {
      localStorage.setItem(storageKey, "1")
    } catch {
      /* Private mode: it just stays wrapped next time. */
    }
    if (prefersReducedMotion()) {
      setStage("open")
      return
    }
    setStage("opening")
    timer.current = setTimeout(() => {
      setStage("open")
      setCelebrate(true)
    }, 950)
  }

  if (stage !== "open") {
    const opening = stage === "opening"
    return (
      <div className="xmas-rise text-center">
        <button
          type="button"
          onClick={unwrap}
          disabled={opening}
          aria-label="Unwrap your present"
          className="group relative mx-auto block rounded-full outline-offset-8"
        >
          <span
            aria-hidden
            className="absolute inset-0 -z-10 rounded-full blur-2xl transition-opacity duration-500"
            style={{ background: XMAS.gold, opacity: opening ? 0.55 : 0.2 }}
          />
          <GiftBox
            className={`h-52 w-52 transition-transform duration-200 ease-out group-hover:scale-105 group-active:scale-95 ${opening ? "xmas-shake" : "xmas-wobble"}`}
            lidClassName={opening ? "xmas-lid-off" : undefined}
          />
          {opening && <Burst />}
        </button>
        <p className="mt-4 text-2xl font-semibold tracking-tight">The draw is done! 🎉</p>
        <p className="mt-1 text-sky-100/80">Tap the present to unwrap it</p>
      </div>
    )
  }

  return (
    <div className="relative pt-6">
      {celebrate && <Burst />}
      <svg aria-hidden viewBox="0 0 100 30" className="mx-auto -mb-1 h-8 w-24">
        <path
          d="M50 30 C 40 12, 20 10, 8 2"
          stroke={XMAS.gold}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <div
        className="xmas-tag relative mx-auto max-w-sm rounded-3xl p-6 pt-9 shadow-2xl"
        style={{ background: PAPER, color: INK }}
      >
        <span
          aria-hidden
          className="absolute top-3 left-1/2 size-4 -translate-x-1/2 rounded-full ring-2"
          style={{ background: XMAS.night, boxShadow: `0 0 0 3px ${XMAS.gold}` }}
        />
        <p className="text-center text-sm tracking-wide text-slate-500 uppercase">
          You're the Secret Santa of
        </p>
        <p
          className="mt-1 text-center text-4xl font-semibold tracking-tight text-balance break-words"
          style={{ color: XMAS.redDark }}
        >
          {match.name}
        </p>
        <div className="mt-5 space-y-4 border-t border-dashed border-slate-300 pt-4">
          <div>
            <p className="text-xs font-bold tracking-wider uppercase" style={{ color: XMAS.pine }}>
              ❤️ Loves
            </p>
            <p className="mt-1 whitespace-pre-line break-words">{match.likes}</p>
          </div>
          {match.dislikes && (
            <div>
              <p className="text-xs font-bold tracking-wider uppercase" style={{ color: XMAS.pine }}>
                🙅 Better not
              </p>
              <p className="mt-1 whitespace-pre-line break-words">{match.dislikes}</p>
            </div>
          )}
        </div>
        <p className="mt-5 text-center text-sm text-slate-500">
          Shh… keep it a secret 🤫{exchange && <span className="block">See you at: {exchange}</span>}
        </p>
      </div>
    </div>
  )
}

// ---- gadget draw --------------------------------------------------------------------------

function GadgetTicket({ santa }: { santa: SecretSantaView }) {
  const { config, entry } = santa
  if (!config.gadget.enabled || !entry?.gadget) return null
  const prize = config.gadget.prize || "a PoliNetwork gadget"

  if (santa.gadgetWon) {
    return (
      <div
        className="xmas-rise relative overflow-hidden rounded-3xl p-5 text-center shadow-[0_0_40px_oklch(86%_0.14_88/0.35)]"
        style={{ background: `linear-gradient(135deg, ${XMAS.gold}, ${XMAS.goldDark})`, color: XMAS.night }}
      >
        <span aria-hidden className="xmas-shimmer absolute inset-y-0 -left-1/3 w-1/3 bg-white/50 blur-md" />
        <p className="relative text-xs font-black tracking-[0.3em] uppercase">Golden ticket</p>
        <p className="relative mt-1 text-2xl font-semibold tracking-tight">⭐ You won {prize}! ⭐</p>
        <p className="relative mt-1 text-sm">We'll hand it to you at the gift exchange.</p>
      </div>
    )
  }
  return (
    <div
      className="relative flex items-center gap-4 rounded-2xl border-2 border-dashed px-5 py-4 text-sm"
      style={{ borderColor: "oklch(86% 0.14 88 / 0.5)", background: "oklch(86% 0.14 88 / 0.08)" }}
    >
      <span aria-hidden className="text-3xl">
        🎟
      </span>
      <p className="text-sky-50/90">
        {santa.gadgetWon === false ? (
          <>
            The draw for <b>{prize}</b> went to someone else this time. Merry Christmas anyway! ✨
          </>
        ) : (
          <>
            Your name is in the secret draw for <b>{prize}</b>. Fingers crossed! ✨
          </>
        )}
      </p>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <span
        className="size-8 animate-spin rounded-full border-2 border-white/20"
        style={{ borderTopColor: XMAS.gold }}
      />
    </div>
  )
}
