import { type ReactNode, useEffect, useState } from "react"
import { activityUIs } from "../../activities/ui-registry.ts"
import { api, joinAsGuest, loginUrl, logout, type Me, type Players, useEventStream, useMe } from "../api.ts"
import { CountsToLeaderboard, Leaderboard, type LeaderboardView, MyPlace } from "../audience-ui.tsx"
import { Backdrop, Orbit, Wordmark } from "../brand.tsx"
import { Icon } from "../icons.tsx"
import { cx } from "../ui.tsx"

interface AudienceStage {
  status: "open" | "closed"
  changedAt: number
  activity: {
    id: string
    type: string
    config: unknown
    /** Only Soci may answer it. */
    membersOnly: boolean
    countsToLeaderboard: boolean
  } | null
  myResponse: unknown
  outcome: { draw: object; youWon: boolean; points: number | null } | null
  /** The running presentation's points, if one is running. */
  leaderboard: LeaderboardView | null
}

export function AudiencePage() {
  const me = useMe()
  const user = me.data?.user
  const players = me.data?.players ?? "accounts"
  const playing = me.data?.playing ?? false
  const { reload } = me

  // Not playing, phones wait for the presenter to let people in with just a name (or stop doing so).
  useEffect(() => {
    if (playing) return
    const timer = setInterval(reload, 5000)
    return () => clearInterval(timer)
  }, [playing, reload])

  let content: ReactNode
  if (me.loading && !me.data) content = <Spinner />
  else if (user && playing) content = <Live me={user} onRejoin={reload} />
  else if (players === "accounts") content = <SignIn />
  else content = <JoinAsGuest players={players} signedIn={Boolean(user)} reload={reload} />

  return (
    <div className="relative flex min-h-dvh flex-col text-slate-950">
      <Backdrop />
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 tall:pt-[max(1.25rem,env(safe-area-inset-top))] tall:pb-3 sm:px-5">
        {/* On the narrowest phones "Live" makes room for the menu. */}
        <Wordmark suffix="Live" className="shrink-0 max-[22.5rem]:[&>.kicker]:hidden" />
        {/* With everyone playing, the sign-in sits under the name instead. */}
        {user ? <UserMenu user={user} /> : players === "guests" && <SignInLink />}
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {content}
      </main>
    </div>
  )
}

function Live({ me, onRejoin }: { me: Me; onRejoin: () => void }) {
  const [stage, setStage] = useState<AudienceStage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const connected = useEventStream("/api/audience/events", {
    stage: (data: AudienceStage) => {
      setStage(data)
      setError(null)
    },
    // Guest access started or ended: this phone has to join again.
    rejoin: onRejoin,
  })
  // A phone that missed `rejoin` (asleep, offline) is refused when it reconnects: ask again whether
  // it still plays, or it would wait on the old stage forever.
  useEffect(() => {
    if (connected) return
    const timer = setInterval(onRejoin, 5000)
    return () => clearInterval(timer)
  }, [connected, onRejoin])

  if (!stage) return <Spinner />

  const ui = stage.activity && activityUIs[stage.activity.type]
  if (!stage.activity || !ui) {
    return (
      <div className="space-y-10">
        <Centered
          emblem
          kicker={stage.leaderboard ? "Between games" : "You're in"}
          title={stage.leaderboard ? "Catch your breath" : "Nothing to answer right now"}
          text="Keep this page open: questions show up here as soon as the presenter asks them."
          footer={<ConnectionDot connected={connected} />}
        />
        {stage.leaderboard && <Leaderboard board={stage.leaderboard} />}
      </div>
    )
  }

  const activity = stage.activity
  if (activity.membersOnly && !me.canParticipate && !me.isAdmin) {
    return (
      <div key={activity.id} className="space-y-10">
        <SociOnly guest={me.guest} />
        {stage.leaderboard && <Leaderboard board={stage.leaderboard} />}
      </div>
    )
  }
  const submit = async (response: unknown) => {
    try {
      const saved = await api<{ response: unknown; stage: AudienceStage }>("/api/audience/respond", {
        body: { activityId: activity.id, response },
      })
      setStage(saved.stage)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
      throw e
    }
  }

  return (
    <div key={activity.id} className="animate-pop-in space-y-3 tall:space-y-4">
      <div className="flex items-center justify-between">
        <StatusPill open={stage.status === "open"} />
        <ConnectionDot connected={connected} />
      </div>
      <CountsToLeaderboard.Provider value={activity.countsToLeaderboard}>
        <ui.Audience
          config={activity.config}
          me={me}
          outcome={stage.outcome}
          response={stage.myResponse}
          open={stage.status === "open"}
          submit={submit}
        />
      </CountsToLeaderboard.Provider>
      {/* Once answers are locked the activity itself explains why (too slow, closed…). */}
      {error && stage.status === "open" && (
        <p className="rounded-2xl border-[1.5px] border-rose-200 bg-rose-50/80 px-4 py-3 text-center text-sm text-rose-700">
          {error}
        </p>
      )}
      {stage.status === "closed" && stage.leaderboard && (
        <MyPlace board={stage.leaderboard} className="glass animate-pop-in px-5 py-3" />
      )}
    </div>
  )
}

/** The one thing to do on the screens before joining. */
const BIG_BUTTON =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-pn px-6 py-4 font-headline text-lg font-medium text-white shadow-[0_16px_32px_-16px_rgb(17_86_174/0.8)] transition hover:bg-pn-deep active:scale-[0.98]"

function SignIn() {
  return (
    <Centered
      emblem
      kicker="Live questions"
      title={
        <>
          Join the <span className="text-gradient">presentation</span>
        </>
      }
      text="Sign in with your PoliNetwork account to vote, answer and play along."
      footer={
        <a href={loginUrl("/")} className={BIG_BUTTON}>
          Sign in with PoliNetwork
          <Icon name="arrow-right" className="size-5" />
        </a>
      }
    />
  )
}

/**
 * While guests may join: a name is all it takes. With guests only, the PoliNetwork sign-in waits in
 * the corner for the admin; with everyone, it is the second way in.
 */
function JoinAsGuest({
  players,
  signedIn,
  reload,
}: {
  players: Exclude<Players, "accounts">
  signedIn: boolean
  reload: () => void
}) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const join = async () => {
    setJoining(true)
    try {
      await joinAsGuest(name)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setJoining(false)
      // Joined, or guest access may have just ended: either way the page changes.
      reload()
    }
  }
  return (
    <Centered
      emblem
      kicker="Live questions"
      title={
        <>
          Join the <span className="text-gradient">presentation</span>
        </>
      }
      text="Type your name to vote, answer and play along. It shows on the leaderboard."
      footer={
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void join()
          }}
        >
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder="Your name"
            aria-label="Your name"
            autoComplete="name"
            maxLength={40}
            className="glass w-full rounded-full! px-6 py-4 text-center font-headline text-lg text-slate-800 outline-none placeholder:text-slate-400 focus:ring-4 focus:ring-blue-400/30"
          />
          <button
            type="submit"
            disabled={!name.trim() || joining}
            className={cx(BIG_BUTTON, "disabled:opacity-50")}
          >
            Join
            <Icon name="arrow-right" className="size-5" />
          </button>
          {players === "everyone" && (
            <p className="pt-2 text-sm text-slate-500">
              Socio?{" "}
              <a href={loginUrl("/")} className="font-medium text-pn underline underline-offset-4">
                Sign in with PoliNetwork
              </a>{" "}
              to answer the games for Soci too.
            </p>
          )}
          {signedIn && players === "guests" && (
            <p className="text-sm text-slate-500">
              Only guests play this one. Joining signs you out of your PoliNetwork account on this device.
            </p>
          )}
          {error && <p className="text-sm text-rose-700">{error}</p>}
        </form>
      }
    />
  )
}

/** The PoliNetwork sign-in, kept small in the corner for the admin while guests may join with a name. */
function SignInLink() {
  return (
    <a
      href={loginUrl("/")}
      className="glass shrink-0 rounded-full! px-3.5 py-1.5 text-sm font-medium text-pn hover:bg-white/80"
    >
      Sign in
    </a>
  )
}

/** What people who are not Soci see while a members-only activity is on stage. */
function SociOnly({ guest }: { guest?: boolean }) {
  if (guest) {
    return (
      <Centered
        icon="lock"
        kicker="Soci only"
        title="This one is for Soci"
        text="Guests cannot answer this one. Keep this page open: the next game is coming up."
      />
    )
  }
  return (
    <Centered
      icon="lock"
      kicker="Soci only"
      title="This one is for Soci"
      text="Only PoliNetwork members (Soci) can answer this one. Keep this page open: the next game may be open to everyone. If you are a Socio, sign out and in again."
      footer={
        <button
          type="button"
          onClick={() => void logout()}
          className="text-sm font-medium text-pn underline underline-offset-4"
        >
          Sign out
        </button>
      }
    />
  )
}

/**
 * Fits a phone next to the wordmark: the name gives way first, and admins and guests (who have a
 * link beside it) only see their picture there.
 */
function UserMenu({ user }: { user: Me }) {
  const compact = user.isAdmin || user.guest
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm sm:gap-2.5">
      {user.guest && <SignInLink />}
      {user.isAdmin && (
        <a
          href="/admin"
          className="shrink-0 rounded-full px-2 py-1.5 font-medium text-pn hover:bg-white/70 sm:px-3"
        >
          Admin
        </a>
      )}
      <button
        type="button"
        onClick={() => {
          // A guest who leaves comes back as someone new: their points stay behind.
          if (user.guest && !confirm("Leave the game? Your points stay with the name you are leaving."))
            return
          void logout()
        }}
        className={cx(
          "glass flex min-w-9 items-center gap-2 rounded-full! py-1 pl-1 text-slate-700 hover:bg-white/80",
          compact ? "pr-1 sm:pr-3" : "pr-3",
        )}
        title={user.guest ? `Playing as ${user.name}. Leave` : `Signed in as ${user.name}. Sign out`}
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="size-7 shrink-0 rounded-full" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-pn font-display text-xs font-semibold text-white">
            {user.name.slice(0, 1)}
          </span>
        )}
        <span className={cx("max-w-32 min-w-0 truncate font-medium", compact && "max-sm:hidden")}>
          {user.name.split(" ")[0]}
        </span>
      </button>
    </div>
  )
}

function Centered({
  emblem,
  icon,
  kicker,
  title,
  text,
  footer,
}: {
  /** The logo in its glass rings, for the screens people look at the longest. */
  emblem?: boolean
  icon?: "lock"
  kicker: string
  title: ReactNode
  text: string
  footer?: ReactNode
}) {
  return (
    <div className="animate-pop-in text-center">
      {emblem && <Orbit className="mx-auto mb-10 w-52" />}
      {icon && (
        <div className="glass mx-auto mb-6 flex size-16 items-center justify-center rounded-full! text-3xl text-sky-700">
          <Icon name={icon} />
        </div>
      )}
      <p className="kicker mb-3">{kicker}</p>
      <h1 className="font-display text-[2.375rem] leading-[1.08] font-medium tracking-tight text-balance text-slate-800">
        {title}
      </h1>
      <div className="mx-auto mt-6 h-1 w-14 rounded-full bg-gradient-to-r from-sky-300 to-blue-400" />
      <p className="mt-6 font-headline text-pretty text-slate-600">{text}</p>
      {footer && <div className="pt-8">{footer}</div>}
    </div>
  )
}

function StatusPill({ open }: { open: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-xs font-semibold tracking-[0.12em] uppercase",
        open
          ? "bg-emerald-600 text-white"
          : "bg-white/70 text-slate-600 ring-[1.5px] ring-slate-300 ring-inset",
      )}
    >
      {open ? (
        <span className="relative flex size-2">
          <span className="absolute inset-0 motion-safe:animate-ping rounded-full bg-white/80" />
          <span className="relative size-2 rounded-full bg-white" />
        </span>
      ) : (
        <Icon name="lock" className="size-3.5" />
      )}
      {open ? "Live" : "Closed"}
    </span>
  )
}

function ConnectionDot({ connected }: { connected: boolean }) {
  return connected ? null : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
      <span className="size-1.5 motion-safe:animate-pulse rounded-full bg-amber-400" /> Reconnecting…
    </span>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center">
      <span className="size-8 motion-safe:animate-spin rounded-full border-2 border-white border-t-blue-400" />
    </div>
  )
}
