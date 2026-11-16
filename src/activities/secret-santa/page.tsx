import { type CSSProperties, type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react"
import { Link } from "wouter"
import { api, loginUrl, logout, type Me, useApi, useMe } from "../../client/api.ts"
import {
  Burst,
  Elf,
  FlyingSleigh,
  GiftBox,
  Icon,
  type IconName,
  MysteryGift,
  Snowfall,
  SnowPuff,
  SnowyHills,
  Sparkle,
  Sparks,
  Stamp,
  StringLights,
  TreeIllustration,
  XMAS,
} from "./decorations.tsx"
import {
  GADGET_NAME,
  type SecretSantaConfig,
  type SecretSantaEntry,
  type SecretSantaView,
  secretSanta,
} from "./definition.ts"

/**
 * The Secret Santa page (`/secret-santa`): what participants see, dressed up for Christmas. In Italian,
 * like the draw email that links here. PoliNetwork blue and ice white as the base; gold, red and green
 * only as accents (lights, the golden letter, the wax seal).
 */

export const SECRET_SANTA_PATH = "/secret-santa"
const PAPER = XMAS.white
const INK = XMAS.navy

/** The current time, refreshed every `intervalMs`. */
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })
}

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
      lang="it"
      className="relative min-h-dvh overflow-x-hidden"
      style={{
        color: INK,
        background: XMAS.ice,
      }}
    >
      {/* Keep fixed children in one stable viewport, independent of mobile browser toolbar changes. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-lvh overflow-hidden [contain:strict]"
        style={{ background: `linear-gradient(to bottom, ${XMAS.ice}, oklch(92% 0.035 240))` }}
      >
        <FlyingSleigh />
        <div className="opacity-20 sm:opacity-100">
          <SnowyHills />
        </div>
        <div className="opacity-40 sm:opacity-100">
          <Snowfall />
        </div>
      </div>
      <header className="relative z-10 pt-[env(safe-area-inset-top)]">
        <StringLights />
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 pt-5">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-medium"
            style={{ color: XMAS.brand800 }}
          >
            <img src="/logo.png" alt="" className="size-7 rounded-full" />
            <span>
              PoliNetwork <span style={{ color: XMAS.blue }}>Live</span>
            </span>
          </Link>
          {user && <UserChip user={user} />}
        </div>
      </header>
      <main className="relative z-10 mx-auto w-full max-w-lg px-5 pt-8 pb-8 sm:pb-[46lvh]">{content}</main>
    </div>
  )
}

function UserChip({ user }: { user: Me }) {
  return (
    <button
      type="button"
      onClick={() => void logout()}
      title="Esci"
      className="flex items-center gap-2 rounded-full border bg-white/80 py-1 pr-3 pl-1 text-sm shadow-sm backdrop-blur-sm transition hover:bg-white"
      style={{ borderColor: XMAS.frost }}
    >
      {user.picture ? (
        <img src={user.picture} alt="" className="size-6 rounded-full" />
      ) : (
        <span
          className="flex size-6 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: XMAS.blue }}
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
    <div className="xmas-rise space-y-4 text-center sm:space-y-6">
      <SantaLogo className="mx-auto h-32 w-auto sm:h-52" />
      <div className="space-y-4 rounded-3xl bg-sky-50 px-4 py-5 sm:bg-transparent sm:p-0 sm:space-y-6">
        <Eyebrow>Secret Santa</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          Qualcuno in PoliNetwork ha un regalo per te
        </h1>
        <p className="leading-relaxed text-pretty" style={{ color: XMAS.muted }}>
          Accedi con il tuo account PoliNetwork per scrivere la tua letterina e scoprire chi devi sorprendere.
        </p>
      </div>
      <a
        href={loginUrl(`${SECRET_SANTA_PATH}${window.location.search}${window.location.hash}`)}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-full px-4 py-3 text-base font-semibold text-white shadow-lg transition active:scale-[0.97] sm:px-6 sm:py-4 sm:text-lg"
        style={{ background: XMAS.blue }}
      >
        Accedi con PoliNetwork
      </a>
    </div>
  )
}

function SecretSantas() {
  const list = useApi<SecretSantaView[]>("/api/secret-santa")
  if (list.loading && !list.data) return <Spinner />
  if (list.error)
    return (
      <div className="space-y-3 text-center">
        <p role="alert" className="text-rose-700">
          {list.error.message}
        </p>
        <button type="button" onClick={list.reload} className="underline">
          Riprova
        </button>
      </div>
    )
  if (!list.data?.length) {
    return (
      <div className="xmas-rise space-y-5 text-center">
        <TreeIllustration className="mx-auto h-32 w-24" />
        <h1 className="text-3xl font-semibold tracking-tight">Nessun Secret Santa in corso</h1>
        <p style={{ color: XMAS.muted }}>
          Gli elfi stanno ancora preparando tutto. Torna più vicino a Natale!
        </p>
        <Link href="/" className="inline-block text-sm underline" style={{ color: XMAS.blue }}>
          Torna a PoliNetwork Live
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
          reload={list.reload}
          onChange={(updated) => {
            list.setData((list.data ?? []).map((item) => (item.id === updated.id ? updated : item)))
            list.reload()
          }}
        />
      ))}
    </div>
  )
}

function SantaExperience({
  santa,
  reload,
  onChange,
}: {
  santa: SecretSantaView
  reload: () => void
  onChange: (s: SecretSantaView) => void
}) {
  const now = useNow()
  // Once the automatic draw is due, look for it every 10 s, so the golden letter shows up by itself.
  const drawDue = !santa.drawn && Boolean(santa.config.drawAt) && now >= Date.parse(santa.config.drawAt)
  useEffect(() => {
    if (!drawDue && !santa.drawn) return
    const timer = setInterval(reload, 10_000)
    return () => clearInterval(timer)
  }, [drawDue, santa.drawn, reload])
  const canJoin =
    santa.canJoin && !(santa.config.signupsCloseAt && now >= Date.parse(santa.config.signupsCloseAt))
  const [wantsEditing, setEditing] = useState(false)
  const editing = wantsEditing && !santa.drawn
  const [justJoined, setJustJoined] = useState(false)
  const [delivery, setDelivery] = useState<SecretSantaView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { config, entry } = santa
  // Whether this browser has opened the golden letter for the current match (see Reveal). The gift
  // confirmation only shows up after that; `letterOpenedNow` tells it to enter with a little delay.
  const letterKey = santa.match ? openedLetterKey(santa.id, santa.match.name) : null
  const [letter, setLetter] = useState(() => ({ key: letterKey, opened: readLetterOpened(letterKey) }))
  const [letterOpenedNow, setLetterOpenedNow] = useState(false)
  if (letter.key !== letterKey) {
    setLetter({ key: letterKey, opened: readLetterOpened(letterKey) })
    setLetterOpenedNow(false)
  }
  const onLetterOpened = () => {
    if (letter.opened) return
    setLetter({ key: letterKey, opened: true })
    setLetterOpenedNow(true)
  }

  const save = async (next: SecretSantaEntry) => {
    try {
      const saved = await api<SecretSantaView>(`/api/secret-santa/${santa.id}/entry`, {
        method: "PUT",
        body: next,
      })
      setJustJoined(!entry)
      if (!entry && !prefersReducedMotion()) setDelivery(saved)
      else onChange(saved)
      setEditing(false)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Qualcosa è andato storto")
    }
  }
  const withdrawalDialog = useRef<HTMLDialogElement>(null)
  const withdrawalCancel = useRef<HTMLButtonElement>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null)
  const withdraw = async () => {
    if (withdrawing) return
    setWithdrawing(true)
    setWithdrawalError(null)
    try {
      const next = await api<SecretSantaView>(`/api/secret-santa/${santa.id}/entry`, { method: "DELETE" })
      withdrawalDialog.current?.close()
      onChange(next)
      setEditing(false)
      setJustJoined(false)
      setError(null)
    } catch (e) {
      setWithdrawalError(e instanceof Error ? e.message : "Ritiro non riuscito. Riprova.")
    } finally {
      setWithdrawing(false)
    }
  }

  let body: ReactNode
  if (delivery) {
    body = (
      <SendingLetter
        onDelivered={() => {
          onChange(delivery)
          setDelivery(null)
        }}
      />
    )
  } else if (santa.removed) {
    body = (
      <Paper className="text-center">
        <h2 className="text-2xl font-semibold">Sei stato rimosso da questo Secret Santa</h2>
        <p className="mt-3" style={{ color: XMAS.muted }}>
          Non hai confermato di aver preso il regalo entro la mezzanotte prevista. Gli abbinamenti sono stati
          aggiornati. Se pensi che ci sia un errore o hai bisogno di aiuto, scrivi su Telegram a{" "}
          <a className="font-semibold underline" href="https://t.me/bia3ia">
            @bia3ia
          </a>{" "}
          o a{" "}
          <a className="font-semibold underline" href="https://t.me/viganogabriele">
            @viganogabriele
          </a>
          .
        </p>
      </Paper>
    )
  } else if (!entry && !canJoin) {
    body = (
      <Paper className="text-center">
        <GiftBox className="mx-auto h-24 w-24" color={XMAS.brand800} />
        <p className="mt-3 text-xl font-semibold">
          {santa.drawn ? "L'estrazione è già stata fatta" : "Le iscrizioni sono chiuse"}
        </p>
        <p className="mt-1 text-sm" style={{ color: XMAS.muted }}>
          Gli elfi hanno sigillato la cassetta delle lettere. Ci vediamo il prossimo Natale!
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
  } else if (santa.match && letterKey) {
    body = (
      <Reveal
        key={letterKey}
        activityId={santa.id}
        storageKey={letterKey}
        initiallyOpen={letter.opened}
        onOpened={onLetterOpened}
        match={santa.match}
        exchange={config.exchange}
      />
    )
  } else {
    body = (
      <Paper className="text-center">
        <p className="text-lg font-semibold">Dopo un ritiro non è rimasto nessuno da sorprendere per te.</p>
        <p className="mt-1 text-sm" style={{ color: XMAS.muted }}>
          Gli organizzatori ti contatteranno.
        </p>
      </Paper>
    )
  }

  return (
    <article aria-labelledby={`santa-${santa.id}`} className="space-y-10">
      <Hero santa={santa} now={now} />
      <Steps santa={santa} />
      {!santa.drawn && <Countdown santa={santa} now={now} canJoin={canJoin} />}
      {body}
      {entry && santa.drawn && santa.match && letter.opened && (
        <GiftConfirmation santa={santa} now={now} entering={letterOpenedNow} onChange={onChange} />
      )}
      {entry && !editing && !santa.hasEmail && !santa.drawn && (
        <Note>
          Non abbiamo il tuo indirizzo email, quindi non possiamo avvisarti dell'estrazione. Torna qui
          {santa.config.drawAt ? ` dopo ${formatWhen(santa.config.drawAt)}` : " dopo l'estrazione"}, oppure
          esci e rientra.
        </Note>
      )}
      {entry && !editing && <GadgetTicket santa={santa} />}
      {error && (
        <p
          role="alert"
          className="rounded-2xl bg-rose-50 px-4 py-3 text-center text-sm text-rose-800 ring-1 ring-rose-200"
        >
          {error}
        </p>
      )}
      {entry && !editing && (
        <div className="flex justify-center gap-6 text-sm">
          {!santa.drawn && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="underline underline-offset-4"
              style={{ color: XMAS.blue }}
            >
              Modifica la letterina
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setWithdrawalError(null)
              withdrawalDialog.current?.showModal()
              withdrawalCancel.current?.focus()
            }}
            className="underline underline-offset-4"
            style={{ color: XMAS.muted }}
          >
            Ritirati
          </button>
        </div>
      )}
      <dialog
        ref={withdrawalDialog}
        aria-labelledby={`withdrawal-title-${santa.id}`}
        aria-describedby={`withdrawal-description-${santa.id}`}
        aria-busy={withdrawing}
        onCancel={(event) => {
          if (withdrawing) event.preventDefault()
        }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border p-6 shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-sm"
        style={{ background: XMAS.white, borderColor: XMAS.frost, color: XMAS.navy }}
      >
        <GiftBox className="mx-auto size-20" />
        <h2 id={`withdrawal-title-${santa.id}`} className="mt-3 text-center text-2xl font-semibold">
          Vuoi ritirarti dal Secret Santa?
        </h2>
        <p
          id={`withdrawal-description-${santa.id}`}
          className="mt-3 text-center"
          style={{ color: XMAS.muted }}
        >
          {santa.drawn
            ? "Gli abbinamenti saranno aggiornati e non potrai più iscriverti a questo giro."
            : "Potrai scrivere una nuova letterina fino alla chiusura delle iscrizioni."}
        </p>
        {withdrawalError && (
          <p role="alert" className="mt-4 text-center text-sm text-rose-800">
            {withdrawalError}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3">
          <button
            ref={withdrawalCancel}
            type="button"
            disabled={withdrawing}
            onClick={() => withdrawalDialog.current?.close()}
            className="min-h-12 rounded-full px-4 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60"
            style={{ background: XMAS.blue }}
          >
            Resta nel Secret Santa
          </button>
          <button
            type="button"
            disabled={withdrawing}
            onClick={() => void withdraw()}
            className="min-h-12 rounded-full border border-rose-200 px-4 py-3 font-semibold text-rose-800 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60"
          >
            {withdrawing ? "Ritiro in corso…" : "Conferma il ritiro"}
          </button>
        </div>
      </dialog>
    </article>
  )
}

/** Darker gold for text on light paper: XMAS.goldDark alone is too faint to read. */
const GOLD_INK = "oklch(50% 0.11 70)"

/** "il 14 dicembre alle 18:32" (with "l'8" and "l'11", and "il 1°"), Italian time. */
function formatConfirmedAt(at: number) {
  const date = new Date(at)
  const day = Number(date.toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "numeric" }))
  const month = date.toLocaleDateString("it-IT", { timeZone: "Europe/Rome", month: "long" })
  const time = date.toLocaleTimeString("it-IT", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
  })
  const article = day === 8 || day === 11 ? "l'" : "il "
  return `${article}${day === 1 ? "1°" : day} ${month} alle ${time}`
}

/**
 * "Ho preso il regalo": an open present the participant taps to wrap it up. It shows up only once the
 * golden letter has been opened (`entering` when that just happened). The confirmed state appears
 * only after the server accepts it: the lid closes, the ribbon and bow go on, a gold stamp lands.
 */
function GiftConfirmation({
  santa,
  now,
  entering,
  onChange,
}: {
  santa: SecretSantaView
  now: number
  entering: boolean
  onChange: (s: SecretSantaView) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justConfirmed, setJustConfirmed] = useState(false)
  const section = useRef<HTMLElement>(null)
  const confirmedHeading = useRef<HTMLHeadingElement>(null)
  const scrollOnMount = useRef(!entering)
  useEffect(() => {
    // From the reminder email; not when it just appeared under the name the person is reading.
    if (scrollOnMount.current && window.location.hash === `#gift-confirmation-${santa.id}`)
      section.current?.scrollIntoView({ block: "start" })
  }, [santa.id])
  const confirmed = santa.giftConfirmedAt !== null
  useEffect(() => {
    if (confirmed && justConfirmed) confirmedHeading.current?.focus({ preventScroll: true })
  }, [confirmed, justConfirmed])
  const expired = santa.confirmationClosesAt !== null && now >= santa.confirmationClosesAt
  const confirm = async () => {
    if (saving || confirmed || expired) return
    setSaving(true)
    try {
      onChange(
        await api<SecretSantaView>(`/api/secret-santa/${santa.id}/confirm-gift`, {
          method: "POST",
          body: {},
        }),
      )
      setJustConfirmed(true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conferma non riuscita. Riprova.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      ref={section}
      id={`gift-confirmation-${santa.id}`}
      aria-labelledby={`gift-confirmation-title-${santa.id}`}
      className="xmas-rise relative scroll-mt-6 rounded-3xl border bg-white px-5 py-7 text-center shadow-[0_20px_50px_oklch(35%_0.06_250/0.12)] sm:px-8"
      style={{ borderColor: XMAS.frost, animationDelay: entering ? "650ms" : undefined }}
    >
      {confirmed ? (
        <>
          <div className="relative mx-auto size-40">
            <GiftBox wrap={justConfirmed ? "tying" : "tied"} checked className="size-full" />
            {justConfirmed && <Burst delay={1} />}
            <span aria-hidden className="absolute inset-x-0 bottom-3 flex justify-center">
              <span
                className={`rounded-lg border-[3px] px-2.5 py-1 text-xs font-black tracking-[0.18em] whitespace-nowrap uppercase shadow-sm ${justConfirmed ? "xmas-stamp" : ""}`}
                style={{
                  borderColor: XMAS.goldDark,
                  color: GOLD_INK,
                  background: "oklch(98% 0.03 92)",
                  transform: "rotate(-12deg)",
                  animationDelay: justConfirmed ? "950ms" : undefined,
                }}
              >
                Regalo pronto!
              </span>
            </span>
          </div>
          <h2
            ref={confirmedHeading}
            id={`gift-confirmation-title-${santa.id}`}
            tabIndex={-1}
            className="mt-4 text-2xl font-semibold tracking-tight outline-offset-4"
          >
            Il tuo regalo è pronto!
          </h2>
          {santa.giftConfirmedAt !== null && (
            <p className="mt-1 font-medium" style={{ color: XMAS.blue }}>
              Hai confermato {formatConfirmedAt(santa.giftConfirmedAt)}
            </p>
          )}
        </>
      ) : (
        <>
          <Eyebrow>Ultimo passo</Eyebrow>
          <h2
            id={`gift-confirmation-title-${santa.id}`}
            className="mt-2 text-2xl font-semibold tracking-tight"
          >
            Hai preso il regalo?
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-pretty" style={{ color: XMAS.muted }}>
            {expired
              ? "Il termine per confermare è scaduto. Stiamo aggiornando le partecipazioni."
              : "Quando l'hai comprato o preparato, tocca il pacchetto per chiuderlo. Non serve averlo già consegnato."}
          </p>
          <button
            type="button"
            disabled={saving || expired}
            aria-label={saving ? "Conferma in corso…" : "Conferma: ho preso il regalo"}
            onClick={() => void confirm()}
            className="group mx-auto mt-4 flex flex-col items-center gap-3 rounded-3xl px-4 pt-2 pb-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 disabled:cursor-not-allowed"
          >
            <span
              className={`block size-40 transition-transform duration-200 ease-out motion-safe:group-hover:-translate-y-1 motion-safe:group-active:scale-[0.97] group-disabled:translate-y-0 ${saving || expired ? "opacity-60" : ""}`}
            >
              <GiftBox wrap="open" className={`size-full ${saving || expired ? "" : "xmas-wobble"}`} />
            </span>
            <span
              className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 py-2.5 font-semibold text-white shadow-md transition group-disabled:shadow-none"
              style={{ background: saving || expired ? "oklch(72% 0.05 250)" : XMAS.blue }}
            >
              <Icon name="gift" className="size-5" />
              {saving ? "Conferma in corso…" : "Ho preso il regalo"}
            </span>
          </button>
          {!expired && santa.config.confirmationDueAt && (
            <p className="mx-auto mt-3 max-w-sm text-sm text-pretty" style={{ color: XMAS.muted }}>
              Conferma entro{" "}
              <b className="font-semibold" style={{ color: XMAS.navy }}>
                {formatWhen(santa.config.confirmationDueAt)}
              </b>
              . Hai tempo fino a mezzanotte dello stesso giorno.
            </p>
          )}
        </>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200"
        >
          {error}
        </p>
      )}
    </section>
  )
}

// ---- hero, countdown and steps ---------------------------------------------------------------

/** Centre the blue badge: the supplied PNG has extra space on the right for the hat. */
function SantaLogo({ className }: { className?: string }) {
  return (
    <img
      src="/secret-santa-logo.png"
      alt="PoliNetwork"
      width={1874}
      height={2000}
      className={`translate-x-[9.63%] drop-shadow-[0_12px_28px_oklch(52%_0.18_257/0.25)] ${className ?? ""}`}
    />
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-[0.28em] uppercase" style={{ color: XMAS.blue }}>
      {children}
    </p>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-2xl border bg-white/70 px-4 py-3 text-center text-sm backdrop-blur-sm"
      style={{ borderColor: XMAS.frost, color: XMAS.muted }}
    >
      {children}
    </p>
  )
}

function daysToChristmas(now: Date) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.UTC(now.getFullYear(), 11, 25) - today) / 86_400_000)
}

function Hero({ santa, now }: { santa: SecretSantaView; now: number }) {
  const days = daysToChristmas(new Date(now))
  const { config } = santa
  const details = [
    config.signupsCloseAt && {
      icon: "mail",
      label: "Iscrizioni fino a",
      value: formatWhen(config.signupsCloseAt),
    },
    config.drawAt && { icon: "shuffle", label: "Estrazione", value: formatWhen(config.drawAt) },
    config.exchange && { icon: "gift", label: "Scambio dei regali", value: config.exchange },
    config.budget && { icon: "coins", label: "Budget", value: config.budget },
    santa.drawn &&
      config.confirmationDueAt && {
        icon: "check",
        label: "Conferma regalo entro",
        value: formatWhen(config.confirmationDueAt),
      },
  ].filter(Boolean) as { icon: IconName; label: string; value: string }[]
  return (
    <section className="xmas-rise space-y-5 text-center">
      <SantaLogo className="mx-auto h-32 w-auto sm:h-52" />
      <div className="space-y-5 rounded-3xl bg-sky-50 px-4 py-5 sm:bg-transparent sm:p-0">
        <Eyebrow>Secret Santa PoliNetwork</Eyebrow>
        <h1
          id={`santa-${santa.id}`}
          className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl"
        >
          {santa.title}
        </h1>
        {days >= 0 && (
          <p
            className="inline-flex items-center gap-2 rounded-full border bg-white/80 px-4 py-1.5 text-sm font-medium shadow-sm backdrop-blur-sm"
            style={{ borderColor: XMAS.frost, color: XMAS.brand800 }}
          >
            <Icon name="star" className="size-4 text-amber-500" />
            {days === 0
              ? "Buon Natale!"
              : days === 1
                ? "Manca 1 giorno a Natale"
                : `Mancano ${days} giorni a Natale`}
          </p>
        )}
        {config.intro && (
          <p className="mx-auto max-w-md leading-relaxed text-pretty" style={{ color: XMAS.muted }}>
            {config.intro}
          </p>
        )}
      </div>
      {details.length > 0 && (
        <dl
          className="mx-auto grid max-w-md gap-px overflow-hidden rounded-2xl border text-left text-sm shadow-sm sm:grid-cols-2"
          style={{ borderColor: XMAS.frost, background: XMAS.frost }}
        >
          {details.map((item, index) => (
            <div
              key={item.label}
              // An odd last card spans both columns, so the grid never ends with an empty cell.
              className={`flex items-start gap-3 bg-white/90 px-4 py-3 ${
                details.length % 2 === 1 && index === details.length - 1 ? "sm:col-span-2" : ""
              }`}
            >
              <span
                className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: XMAS.ice, color: XMAS.blue }}
              >
                <Icon name={item.icon} />
              </span>
              <span className="min-w-0">
                <dt className="text-xs" style={{ color: XMAS.muted }}>
                  {item.label}
                </dt>
                <dd className="font-medium break-words first-letter:uppercase">{item.value}</dd>
              </span>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

/** Big ice tiles counting down to the next moment: sign-ups closing, then the draw. */
function Countdown({ santa, now, canJoin }: { santa: SecretSantaView; now: number; canJoin: boolean }) {
  const { signupsCloseAt, drawAt } = santa.config
  const target =
    canJoin && signupsCloseAt
      ? { label: "Le iscrizioni chiudono tra", at: Date.parse(signupsCloseAt) }
      : drawAt
        ? { label: "L'estrazione è tra", at: Date.parse(drawAt) }
        : null
  if (!target) return null
  const left = Math.max(0, target.at - now)
  if (left === 0) {
    return (
      <p className="text-center text-sm font-medium" style={{ color: XMAS.blue }}>
        Gli elfi stanno pescando i nomi proprio adesso…
      </p>
    )
  }
  const units = [
    { label: "giorni", value: Math.floor(left / 86_400_000) },
    { label: "ore", value: Math.floor(left / 3_600_000) % 24 },
    { label: "minuti", value: Math.floor(left / 60_000) % 60 },
    { label: "secondi", value: Math.floor(left / 1000) % 60 },
  ]
  return (
    <section aria-label={target.label} className="text-center">
      <p className="text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: XMAS.muted }}>
        {target.label}
      </p>
      <div className="mt-3 flex justify-center gap-2">
        {units.map((unit) => (
          <div
            key={unit.label}
            className="w-[4.6rem] rounded-2xl border bg-white py-2.5 shadow-[0_6px_18px_oklch(52%_0.18_257/0.12)]"
            style={{ borderColor: XMAS.frost }}
          >
            <p className="text-3xl font-semibold tabular-nums" style={{ color: XMAS.navy }}>
              {String(unit.value).padStart(2, "0")}
            </p>
            <p className="text-[11px] tracking-wide uppercase" style={{ color: XMAS.muted }}>
              {unit.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Steps({ santa }: { santa: SecretSantaView }) {
  const steps = [
    { label: "Scrivi la letterina", done: Boolean(santa.entry) },
    { label: "Estrazione", done: santa.drawn },
    { label: "Scambio dei regali", done: false },
  ]
  const current = steps.findIndex((step) => !step.done)
  return (
    <ol className="grid grid-cols-3 gap-2 text-center text-xs" aria-label="Avanzamento">
      {steps.map((step, i) => (
        <li key={step.label} className="relative flex flex-col items-center gap-2">
          {i > 0 && (
            <span
              aria-hidden
              className="absolute top-4 right-[calc(50%+1rem)] h-0.5 w-[calc(100%-1.5rem)]"
              style={{ background: steps[i - 1]?.done ? XMAS.blue : XMAS.frost }}
            />
          )}
          <span
            className="relative z-10 flex size-8 items-center justify-center rounded-full text-sm font-bold"
            style={
              step.done
                ? { background: XMAS.blue, color: XMAS.white }
                : i === current
                  ? {
                      background: XMAS.white,
                      color: XMAS.blue,
                      boxShadow: `0 0 0 2px ${XMAS.blue}, 0 0 0 6px oklch(52% 0.18 257 / 0.15)`,
                    }
                  : { background: XMAS.white, color: XMAS.muted, boxShadow: `0 0 0 1px ${XMAS.frost}` }
            }
            aria-current={i === current ? "step" : undefined}
          >
            {step.done ? <Icon name="check" className="size-4" /> : i + 1}
          </span>
          <span
            className={i === current ? "font-semibold" : ""}
            style={{ color: i === current ? XMAS.navy : XMAS.muted }}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  )
}

// ---- the letter ---------------------------------------------------------------------------

function Paper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`xmas-rise relative overflow-hidden rounded-3xl border p-6 pt-8 shadow-[0_20px_50px_oklch(35%_0.06_250/0.15)] ${className}`}
      style={{ background: PAPER, color: INK, borderColor: XMAS.frost }}
    >
      <AirmailEdge />
      {children}
    </div>
  )
}

/** Blue and white airmail stripes, with a thread of red. */
function AirmailEdge() {
  return (
    <span
      aria-hidden
      className="absolute inset-x-0 top-0 h-2"
      style={{
        background: `repeating-linear-gradient(135deg, ${XMAS.blue} 0 12px, ${PAPER} 12px 20px, ${XMAS.red} 20px 32px, ${PAPER} 32px 40px)`,
      }}
    />
  )
}

const linedPaper: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 31px, oklch(88% 0.04 245) 31px 32px)",
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
    "block w-full resize-none bg-transparent px-1 text-[17px] outline-none placeholder:text-slate-500 focus-visible:bg-sky-50"
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
          <p className="text-2xl font-semibold tracking-tight">Caro Secret Santa,</p>
          <p className="mt-1 text-sm" style={{ color: XMAS.muted }}>
            Non è una lista dei desideri: solo le cose che mi rendono felice.
          </p>
        </div>
        <label className="block">
          <span className="text-sm font-semibold" style={{ color: XMAS.blue }}>
            Le cose che amo
          </span>
          <textarea
            value={likes}
            onChange={(e) => setLikes(e.target.value)}
            maxLength={600}
            rows={4}
            placeholder="Cioccolato fondente, giochi da tavolo, gatti, Studio Ghibli, montagna…"
            className={area}
            style={linedPaper}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold" style={{ color: XMAS.blue }}>
            Meglio di no{" "}
            <span className="font-normal" style={{ color: XMAS.muted }}>
              (facoltativo)
            </span>
          </span>
          <textarea
            value={dislikes}
            onChange={(e) => setDislikes(e.target.value)}
            maxLength={400}
            rows={2}
            placeholder="Allergie, cose che ho già in abbondanza…"
            className={area}
            style={linedPaper}
          />
        </label>
        {config.gadget.enabled && (
          <label className={`block text-left ${gadgetLocked ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={gadget}
              disabled={gadgetLocked}
              onChange={(e) => setGadget(e.target.checked)}
              className="peer sr-only"
            />
            <Ticket
              gold={gadget}
              className="transition-transform duration-150 ease-out peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-blue-500 peer-disabled:opacity-75 motion-safe:active:scale-[0.98] motion-safe:peer-disabled:active:scale-100"
              stub={<MysteryGift muted={!gadget} className="h-12 w-11" />}
            >
              <span className="flex items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span
                    aria-hidden
                    className="block text-[11px] font-bold tracking-[0.2em] uppercase"
                    style={{ color: gadget ? GOLD_INK : XMAS.blue }}
                  >
                    Biglietto speciale
                  </span>
                  <span className="mt-0.5 block font-semibold">
                    Partecipo anche all'estrazione di {GADGET_NAME}
                  </span>
                  <span className="mt-0.5 block text-sm" style={{ color: XMAS.muted }}>
                    {gadgetLocked
                      ? "L'estrazione del gadget è già stata fatta: questa scelta non si può più cambiare."
                      : "Cos'è? Sorpresa. Per ora raccogliamo solo le adesioni."}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2"
                  style={
                    gadget
                      ? { background: XMAS.blue, borderColor: XMAS.blue, color: XMAS.white }
                      : { borderColor: XMAS.sky, borderStyle: "dashed", background: XMAS.white }
                  }
                >
                  {gadget && <Icon name="check" className="xmas-pop size-4" />}
                </span>
              </span>
            </Ticket>
          </label>
        )}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!parsed.success || saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-full px-6 py-4 text-lg font-semibold text-white shadow-lg transition active:scale-[0.97] disabled:shadow-none disabled:active:scale-100"
            style={{ background: parsed.success ? XMAS.blue : "oklch(80% 0.03 250)" }}
          >
            <Icon name="mail" className="size-5" />
            {saving ? "Invio…" : entry ? "Salva la letterina" : "Spedisci al Polo Nord"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 text-sm underline"
              style={{ color: XMAS.muted }}
            >
              Annulla
            </button>
          )}
        </div>
      </form>
    </Paper>
  )
}

// ---- waiting for the draw -----------------------------------------------------------------

const MINI_GIFT_COLORS = [XMAS.blue, XMAS.brand800, XMAS.brand500, XMAS.red, XMAS.pine]

const SEND_MS = 2700

function SendingLetter({ onDelivered }: { onDelivered: () => void }) {
  const delivered = useEffectEvent(onDelivered)
  useEffect(() => {
    const timer = setTimeout(() => delivered(), SEND_MS)
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onMotionChange = () => {
      if (motion.matches) delivered()
    }
    motion.addEventListener("change", onMotionChange)
    return () => {
      clearTimeout(timer)
      motion.removeEventListener("change", onMotionChange)
    }
  }, [])

  return (
    <div
      className="overflow-hidden rounded-3xl border bg-white/80 p-6 text-center"
      style={{ borderColor: XMAS.frost }}
    >
      <div aria-hidden className="relative h-64 [perspective:900px]">
        <div className="xmas-send-flight absolute inset-x-0 bottom-6 mx-auto h-36 w-56">
          <span
            className="absolute inset-0 rounded-xl border bg-white shadow-lg"
            style={{ borderColor: XMAS.frost }}
          />
          <span
            className="xmas-send-paper absolute inset-x-4 -top-12 h-36 rounded-lg border bg-white p-4 text-left shadow-sm"
            style={{ ...linedPaper, borderColor: XMAS.frost, color: XMAS.blue }}
          >
            Caro Secret Santa…
            <Icon name="heart" className="mt-3 size-6" />
          </span>
          <span
            className="absolute inset-0 z-20 flex items-end justify-center rounded-xl bg-white pb-5 text-sm font-semibold"
            style={{ clipPath: "polygon(0 0, 50% 50%, 100% 0, 100% 100%, 0 100%)", color: XMAS.blue }}
          >
            <AirmailEdge />
            Per il Polo Nord
          </span>
          <span
            className="xmas-send-flap absolute inset-x-0 top-0 z-30 h-1/2 origin-top"
            style={{ background: XMAS.frost, clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
          />
          <Elf
            hat={XMAS.pine}
            holding="gift"
            frontArmRest={-60}
            className="xmas-post-elf absolute -right-7 -bottom-2 z-40 w-14 -scale-x-100"
          />
          {[0, 1, 2].map((i) => (
            <Sparkle
              key={i}
              className="xmas-send-star absolute top-1/2 -left-6 size-4"
              color={i === 1 ? XMAS.sky : XMAS.gold}
              style={{ animationDelay: `${1400 + i * 120}ms` }}
            />
          ))}
        </div>
      </div>
      <p role="status" className="text-xl font-semibold">
        La tua letterina vola al Polo Nord!
      </p>
      <p className="mt-2 text-sm" style={{ color: XMAS.muted }}>
        Un elfo si occupa della consegna.
      </p>
      <button
        type="button"
        onClick={onDelivered}
        className="mt-3 min-h-11 px-4 text-sm underline underline-offset-4"
        style={{ color: XMAS.blue }}
      >
        Salta l'animazione
      </button>
    </div>
  )
}

function Waiting({ santa, justJoined }: { santa: SecretSantaView; justJoined: boolean }) {
  const shown = Math.min(santa.participants, 3)
  const confirmation = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (justJoined) confirmation.current?.focus({ preventScroll: true })
  }, [justJoined])
  return (
    <Paper className="text-center">
      {justJoined && (
        <span
          className="xmas-stamp absolute top-8 right-4 rounded-lg border-[3px] px-2 py-0.5 text-sm font-black tracking-widest uppercase"
          style={{ borderColor: XMAS.red, color: XMAS.red }}
        >
          Spedita
        </span>
      )}
      <GiftBox className="xmas-wobble mx-auto h-36 w-36" />
      <h2
        ref={confirmation}
        tabIndex={-1}
        className="mt-2 text-2xl font-semibold tracking-tight outline-offset-4"
      >
        Ci sei!
      </h2>
      <p className="mt-1 text-pretty" style={{ color: XMAS.muted }}>
        La tua letterina è nella cassetta del Polo Nord. Torna dopo l'estrazione per scoprire chi devi
        sorprendere.
      </p>
      <div className="mt-6 space-y-2">
        <div className="flex flex-wrap justify-center gap-1.5" aria-hidden>
          {Array.from({ length: shown }, (_, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: one icon per participant, no identity
              key={i}
              className="xmas-pop"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <GiftBox className="size-6" color={MINI_GIFT_COLORS[i % MINI_GIFT_COLORS.length]} />
            </span>
          ))}
        </div>
        <p className="text-sm" style={{ color: XMAS.muted }}>
          {santa.participants === 1
            ? "1 persona iscritta finora"
            : `${santa.participants} persone iscritte finora`}
        </p>
      </div>
    </Paper>
  )
}

// ---- the reveal ---------------------------------------------------------------------------

type RevealStage = "sealed" | "opening" | "open"

const GOLD_FOIL =
  "linear-gradient(135deg, oklch(93% 0.09 92) 0%, oklch(81% 0.14 82) 35%, oklch(91% 0.11 92) 55%, oklch(73% 0.13 72) 100%)"
const GOLD_FOIL_DARK =
  "linear-gradient(160deg, oklch(85% 0.12 86) 0%, oklch(71% 0.13 72) 60%, oklch(65% 0.12 68) 100%)"
const FOLD_LINES =
  "linear-gradient(to bottom right, transparent 49.6%, oklch(60% 0.1 70 / 0.35) 50%, transparent 50.4%), linear-gradient(to bottom left, transparent 49.6%, oklch(60% 0.1 70 / 0.35) 50%, transparent 50.4%)"

const SEAL_STYLE: CSSProperties = {
  background: `radial-gradient(circle at 35% 30%, oklch(64% 0.2 25), ${XMAS.redDark} 70%)`,
  color: XMAS.gold,
  boxShadow: "0 0 0 3px oklch(47% 0.17 25 / 0.45), 0 6px 14px oklch(20% 0.05 250 / 0.3)",
}

/**
 * A golden envelope sealed with red wax. Opening it, two elves do the work: Tonio cracks the seal
 * with his candy cane, Gina lifts the flap and pulls the card out, then they vanish in a puff of
 * stars and the gift tag takes its place. The whole show runs on `--open` (see Reveal).
 */
function GoldenLetter({ opening, onOpen }: { opening: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={opening ? "Salta l'animazione" : "Apri la tua lettera dorata"}
      className="group relative mx-auto block w-[19rem] max-w-full outline-offset-8 [perspective:900px]"
    >
      <span
        aria-hidden
        className="absolute inset-x-4 top-1/4 -z-10 h-3/4 rounded-full blur-3xl transition-opacity duration-700"
        style={{ background: XMAS.gold, opacity: opening ? 0.8 : 0.45 }}
      />
      <span
        aria-hidden
        className={`relative block aspect-[3/2] w-full transition-transform duration-300 ease-out group-hover:-translate-y-1 group-active:scale-[0.97] ${opening ? "xmas-letter-beats" : "xmas-float"}`}
      >
        <span
          className="absolute inset-0 rounded-2xl shadow-[0_24px_50px_oklch(55%_0.12_75/0.35)]"
          style={{ background: GOLD_FOIL_DARK }}
        />
        <span
          className={`absolute inset-x-5 top-3 bottom-3 z-10 flex flex-col items-center rounded-xl pt-5 shadow-md ${opening ? "xmas-letter-card" : ""}`}
          style={{ background: PAPER, color: INK }}
        >
          <span className="text-[10px] tracking-[0.3em] uppercase" style={{ color: XMAS.blue }}>
            Secret Santa
          </span>
          <span className="mt-1 text-lg font-semibold">La tua persona</span>
        </span>
        <span
          className="absolute inset-0 z-20 rounded-2xl"
          style={{ background: GOLD_FOIL, clipPath: "polygon(0 0, 50% 55%, 100% 0, 100% 100%, 0 100%)" }}
        />
        <span
          className="absolute inset-0 z-20 rounded-2xl"
          style={{ background: FOLD_LINES, clipPath: "polygon(0 100%, 50% 55%, 100% 100%)" }}
        />
        <span
          className={`absolute inset-x-0 top-0 z-30 h-[58%] origin-top ${opening ? "xmas-letter-flap" : ""}`}
          style={{
            background: GOLD_FOIL,
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
            filter: "drop-shadow(0 2px 2px oklch(40% 0.08 70 / 0.35))",
          }}
        />
        {!opening && (
          <span className="absolute inset-0 z-30 overflow-hidden rounded-2xl">
            <span className="xmas-shimmer absolute inset-y-0 -left-1/3 w-1/4 bg-white/50 blur-md" />
          </span>
        )}
        {opening ? (
          <span
            aria-hidden
            className="absolute top-[58%] left-1/2 z-40 size-14 -translate-x-1/2 -translate-y-1/2"
          >
            <span
              className="xmas-seal-ring absolute inset-0 rounded-full border-2"
              style={{ borderColor: XMAS.gold }}
            />
            <span
              className="xmas-seal-half-l absolute inset-0 flex items-center justify-center rounded-full"
              style={{ ...SEAL_STYLE, clipPath: "inset(-24px 50% -24px -24px)" }}
            >
              <Icon name="star" className="size-6" />
            </span>
            <span
              className="xmas-seal-half-r absolute inset-0 flex items-center justify-center rounded-full"
              style={{ ...SEAL_STYLE, clipPath: "inset(-24px -24px -24px 50%)" }}
            >
              <Icon name="star" className="size-6" />
            </span>
          </span>
        ) : (
          <span
            className="absolute top-[58%] left-1/2 z-40 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
            style={SEAL_STYLE}
          >
            <Icon name="star" className="size-6" />
          </span>
        )}
        {opening && <Sparks />}
        {opening && <LetterElves />}
      </span>
    </button>
  )
}

/** Where the trail and card twinkles appear, in % of the envelope. */
const TRAIL_TWINKLES = [
  { left: "90%", top: "40%", size: "size-3", color: XMAS.gold, delay: "0ms" },
  { left: "86%", top: "-12%", size: "size-3", color: XMAS.white, delay: "100ms" },
  { left: "80%", top: "-38%", size: "size-4", color: XMAS.gold, delay: "200ms" },
]
const CARD_TWINKLES = [
  { left: "10%", top: "-66%", size: "size-4", color: XMAS.gold, delay: "0ms" },
  { left: "30%", top: "-74%", size: "size-3", color: XMAS.white, delay: "60ms" },
  { left: "62%", top: "-76%", size: "size-3", color: XMAS.sky, delay: "120ms" },
  { left: "90%", top: "-62%", size: "size-4", color: XMAS.gold, delay: "180ms" },
]

/**
 * The two elves opening the letter. Tonio (red hat) hops onto the envelope and cracks the seal with
 * his candy cane; Gina (green hat) leaps onto the top edge, lifts the flap and yanks the card out.
 * Each path wrapper is exactly the envelope's size, so its translate % are % of the envelope.
 */
function LetterElves() {
  return (
    <>
      <span aria-hidden className="xmas-elf-a-path pointer-events-none absolute inset-0 z-50">
        <SnowPuff className="xmas-puff pointer-events-none absolute -bottom-3 -left-4 w-16" />
        <Elf
          hat={XMAS.red}
          holding="cane"
          frontArmRest={-110}
          backArmRest={12}
          frontArmClassName="xmas-elf-a-arm"
          eyesClassName="xmas-elf-blink"
          className="xmas-elf-a-body pointer-events-none absolute -bottom-2 -left-3 w-14"
        />
        <span
          className="xmas-poof pointer-events-none absolute size-8 -translate-x-1/2 translate-y-1/2"
          style={{ left: 16, bottom: 29 }}
        >
          <Sparkle className="size-full" color={XMAS.gold} />
        </span>
      </span>
      <span aria-hidden className="xmas-elf-b-path pointer-events-none absolute inset-0 z-50">
        <SnowPuff
          className="xmas-puff pointer-events-none absolute -right-4 -bottom-3 w-16"
          style={{ animationDelay: "120ms" }}
        />
        <Elf
          hat={XMAS.pine}
          frontArmRest={10}
          backArmRest={10}
          frontArmClassName="xmas-elf-b-arm"
          backArmClassName="xmas-elf-b-arm"
          eyesClassName="xmas-elf-blink"
          className="xmas-elf-b-body pointer-events-none absolute -right-3 -bottom-2 w-14 -scale-x-100"
        />
        <span
          className="xmas-poof pointer-events-none absolute size-8 translate-x-1/2 translate-y-1/2"
          style={{ right: 16, bottom: 29 }}
        >
          <Sparkle className="size-full" color={XMAS.gold} />
        </span>
      </span>
      {TRAIL_TWINKLES.map((twinkle) => (
        <span
          key={`${twinkle.left}-${twinkle.top}`}
          aria-hidden
          className={`xmas-trail-twinkle pointer-events-none absolute z-50 ${twinkle.size} -translate-1/2`}
          style={{
            left: twinkle.left,
            top: twinkle.top,
            animationDelay: `calc(var(--open) * 0.52 + ${twinkle.delay})`,
          }}
        >
          <Sparkle className="size-full" color={twinkle.color} />
        </span>
      ))}
      {CARD_TWINKLES.map((twinkle) => (
        <span
          key={`${twinkle.left}-${twinkle.top}`}
          aria-hidden
          className={`xmas-card-twinkle pointer-events-none absolute z-50 ${twinkle.size} -translate-1/2`}
          style={{
            left: twinkle.left,
            top: twinkle.top,
            animationDelay: `calc(var(--open) * 0.72 + ${twinkle.delay})`,
          }}
        >
          <Sparkle className="size-full" color={twinkle.color} />
        </span>
      ))}
    </>
  )
}

/** How long the opening show lasts. Keep in sync: every opening keyframe in styles.css runs on var(--open). */
const OPEN_MS = 3000

/** Remembers, per browser, that someone opened the golden letter for this match. */
function openedLetterKey(activityId: string, matchName: string) {
  return `secret-santa-opened:${activityId}:${matchName}`
}

function readLetterOpened(key: string | null) {
  if (!key) return false
  try {
    return localStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

function Reveal({
  activityId,
  storageKey,
  initiallyOpen,
  onOpened,
  match,
  exchange,
}: {
  activityId: string
  storageKey: string
  initiallyOpen: boolean
  /** Called once the letter is open and the name is showing (also when it already was). */
  onOpened: () => void
  match: NonNullable<SecretSantaView["match"]>
  exchange: string
}) {
  const [stage, setStage] = useState<RevealStage>(initiallyOpen ? "open" : "sealed")
  const [celebrate, setCelebrate] = useState(false)
  const revealedName = useRef<HTMLHeadingElement>(null)
  const sealedLetter = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const opened = useEffectEvent(onOpened)
  useEffect(() => {
    if (stage === "open") opened()
  }, [stage])
  useEffect(() => {
    // A reminder email links to the gift confirmation, which waits for the letter: show the letter.
    if (!initiallyOpen && window.location.hash === `#gift-confirmation-${activityId}`)
      sealedLetter.current?.scrollIntoView({ block: "start" })
  }, [initiallyOpen, activityId])
  useEffect(() => {
    if (stage === "open" && celebrate) revealedName.current?.focus({ preventScroll: true })
    if (stage !== "opening") return
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onMotionChange = () => {
      if (motion.matches) {
        clearTimeout(timer.current)
        setCelebrate(false)
        setStage("open")
      }
    }
    motion.addEventListener("change", onMotionChange)
    return () => motion.removeEventListener("change", onMotionChange)
  }, [stage, celebrate])

  const finish = () => {
    clearTimeout(timer.current)
    setStage("open")
    setCelebrate(true)
  }

  const open = () => {
    // A second tap while the elves are at work skips the show.
    if (stage === "opening") {
      finish()
      return
    }
    try {
      localStorage.setItem(storageKey, "1")
    } catch {
      /* Private mode: it just stays sealed next time. */
    }
    if (prefersReducedMotion()) {
      setCelebrate(true)
      setStage("open")
      return
    }
    setStage("opening")
    timer.current = setTimeout(finish, OPEN_MS)
  }

  if (stage !== "open") {
    return (
      <div
        ref={sealedLetter}
        className={`scroll-mt-6 text-center ${stage === "opening" ? "xmas-stage-out" : "xmas-rise"}`}
        style={{ "--open": `${OPEN_MS}ms` } as CSSProperties}
      >
        <div className="flex h-88 items-end justify-center pb-3">
          <GoldenLetter opening={stage === "opening"} onOpen={open} />
        </div>
        <p className="mt-8 text-2xl font-semibold tracking-tight">L'estrazione è fatta!</p>
        <p aria-live="polite" className="mt-1" style={{ color: XMAS.muted }}>
          {stage === "opening"
            ? "Gli elfi la stanno aprendo… Tocca per saltare."
            : "È arrivata una lettera dorata per te. Toccala per aprirla."}
        </p>
      </div>
    )
  }

  return (
    <div className={`relative pt-6 ${celebrate ? "pb-9" : ""}`}>
      {celebrate && <Burst delay={0.15} />}
      <svg aria-hidden viewBox="0 0 100 30" className="mx-auto -mb-1 h-8 w-24">
        <path
          d="M50 30 C 40 12, 20 10, 8 2"
          stroke={XMAS.goldDark}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <div
        className="xmas-tag relative mx-auto max-w-sm rounded-3xl border p-6 pt-9 shadow-[0_24px_60px_oklch(35%_0.06_250/0.18)]"
        style={{ background: PAPER, color: INK, borderColor: XMAS.frost }}
      >
        <span
          aria-hidden
          className="absolute top-3 left-1/2 size-4 -translate-x-1/2 rounded-full"
          style={{ background: XMAS.ice, boxShadow: `0 0 0 3px ${XMAS.gold}` }}
        />
        <p className="text-center text-xs tracking-[0.25em] uppercase" style={{ color: XMAS.blue }}>
          Sei il Secret Santa di
        </p>
        <h2
          ref={revealedName}
          tabIndex={-1}
          className="mt-2 text-center text-4xl font-semibold tracking-tight text-balance break-words outline-offset-4"
        >
          {match.name}
        </h2>
        <div className="mt-5 space-y-4 border-t border-dashed pt-4" style={{ borderColor: XMAS.frost }}>
          <TagLine icon="heart" label="Ama">
            {match.likes}
          </TagLine>
          {match.dislikes && (
            <TagLine icon="ban" label="Meglio di no">
              {match.dislikes}
            </TagLine>
          )}
          {match.editedAt != null && (
            <p className="text-xs" style={{ color: XMAS.muted }}>
              Letterina aggiornata dagli organizzatori il {formatWhen(new Date(match.editedAt).toISOString())}
            </p>
          )}
        </div>
        <p className="mt-5 text-center text-sm" style={{ color: XMAS.muted }}>
          Mi raccomando, acqua in bocca.
          {exchange && <span className="block">Ci vediamo a: {exchange}</span>}
        </p>
        {celebrate && (
          <>
            <span aria-hidden className="pointer-events-none absolute -bottom-9 left-3 w-11">
              <Elf
                hat={XMAS.red}
                holding="cane"
                frontArmRest={-110}
                backArmRest={12}
                frontArmClassName="xmas-elf-wave"
                className="xmas-elf-tag block w-full"
              />
            </span>
            <span aria-hidden className="pointer-events-none absolute right-3 -bottom-9 w-11">
              <Elf
                hat={XMAS.pine}
                holding="gift"
                frontArmRest={-60}
                backArmRest={-60}
                className="xmas-elf-tag block w-full -scale-x-100"
                style={{ animationDelay: "430ms" }}
              />
            </span>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setCelebrate(false)
          setStage("sealed")
        }}
        className="mx-auto mt-5 block min-h-11 px-4 text-sm underline underline-offset-4"
        style={{ color: XMAS.blue }}
      >
        Rivedi l'apertura
      </button>
    </div>
  )
}

function TagLine({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div>
      <p
        className="flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase"
        style={{ color: XMAS.blue }}
      >
        <Icon name={icon} className="size-3.5" />
        {label}
      </p>
      <p className="mt-1 whitespace-pre-line break-words">{children}</p>
    </div>
  )
}

// ---- gadget draw --------------------------------------------------------------------------

/** Where the ticket is perforated: the stub's width, and the two notches cut on that line. */
const TICKET_STUB = "4.75rem"
const TICKET_NOTCH: CSSProperties = {
  maskImage: `radial-gradient(circle at ${TICKET_STUB} 0, transparent 9px, #000 9.5px), radial-gradient(circle at ${TICKET_STUB} 100%, transparent 9px, #000 9.5px)`,
  maskSize: "100% 51%",
  maskPosition: "top, bottom",
  maskRepeat: "no-repeat",
}
const GOLD_TICKET = "linear-gradient(135deg, oklch(97% 0.045 92) 0%, oklch(91% 0.08 88) 100%)"
const ICE_TICKET = `linear-gradient(135deg, ${XMAS.white} 0%, ${XMAS.ice} 100%)`

/**
 * A tear-off ticket: a stub with a picture, a perforated line with two notches, and the text. Gold
 * when it counts, ice otherwise. The notches are a mask, so the outer span carries the focus ring
 * and the drop shadow (a mask would clip both).
 */
function Ticket({
  gold,
  stub,
  className = "",
  children,
}: {
  gold: boolean
  stub: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={`block rounded-2xl ${className}`}
      style={{
        filter: gold
          ? "drop-shadow(0 8px 14px oklch(60% 0.1 75 / 0.25))"
          : "drop-shadow(0 4px 10px oklch(35% 0.06 250 / 0.1))",
      }}
    >
      <span
        className="relative flex min-h-24 rounded-2xl"
        style={{ ...TICKET_NOTCH, background: gold ? GOLD_TICKET : ICE_TICKET, color: INK }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-1.5 rounded-xl border-[1.5px] border-dashed"
          style={{ borderColor: gold ? XMAS.goldDark : XMAS.sky }}
        />
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center"
          style={{ width: TICKET_STUB }}
        >
          {stub}
        </span>
        <span
          aria-hidden
          className="my-3 shrink-0 border-l-2 border-dotted"
          style={{ borderColor: gold ? XMAS.goldDark : XMAS.sky }}
        />
        <span className="relative min-w-0 flex-1 py-4 pr-4 pl-4">{children}</span>
      </span>
    </span>
  )
}

/** Shown under the letter to people who entered the gadget draw. It never says what the gadget is. */
function GadgetTicket({ santa }: { santa: SecretSantaView }) {
  const { config, entry } = santa
  if (!config.gadget.enabled || !entry?.gadget) return null

  return (
    <div className="xmas-rise">
      <Ticket gold stub={<MysteryGift className="xmas-wobble h-14 w-13" />}>
        <span
          className="float-right ml-2 inline-block rounded-md border-2 px-1.5 py-0.5 text-[11px] font-black tracking-[0.14em] whitespace-nowrap uppercase"
          style={{ borderColor: XMAS.pine, color: XMAS.pine, transform: "rotate(-8deg)" }}
        >
          Sei dentro!
        </span>
        <span className="block text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: GOLD_INK }}>
          Gadget segreto
        </span>
        <span className="mt-1 block font-semibold text-pretty">
          Sei nell'estrazione del gadget segreto PoliNetwork.
        </span>
        <span className="mt-0.5 block text-sm" style={{ color: XMAS.muted }}>
          Cos'è? Lo scoprirai più avanti.
        </span>
      </Ticket>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <span
        className="size-8 animate-spin rounded-full border-2"
        style={{ borderColor: XMAS.frost, borderTopColor: XMAS.blue }}
      />
    </div>
  )
}
