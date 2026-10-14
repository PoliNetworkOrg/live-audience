import { type ReactNode, useState } from "react"
import { activityUIs } from "../../activities/ui-registry.ts"
import { api, loginUrl, logout, type Me, useEventStream, useMe } from "../api.ts"
import { Leaderboard, type LeaderboardView, MyPlace } from "../audience-ui.tsx"
import { Backdrop, Orbit, Wordmark } from "../brand.tsx"
import { Icon } from "../icons.tsx"
import { cx } from "../ui.tsx"

interface AudienceStage {
  status: "open" | "closed"
  changedAt: number
  activity: { id: string; type: string; config: unknown } | null
  myResponse: unknown
  outcome: { draw: object; youWon: boolean; points: number | null } | null
  /** The running presentation's points, if one is running. */
  leaderboard: LeaderboardView | null
}

export function AudiencePage() {
  const me = useMe()
  const user = me.data?.user

  let content: ReactNode
  if (me.loading && !me.data) content = <Spinner />
  else if (!user) content = <SignIn />
  else if (!user.canParticipate && !user.isAdmin) content = <NotAMember />
  else content = <Live me={user} />

  return (
    <div className="relative flex min-h-dvh flex-col text-slate-950">
      <Backdrop />
      <header className="relative z-10 flex items-center justify-between gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
        <Wordmark suffix="Live" />
        {user && <UserMenu user={user} />}
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {content}
      </main>
    </div>
  )
}

function Live({ me }: { me: Me }) {
  const [stage, setStage] = useState<AudienceStage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const connected = useEventStream("/api/audience/events", {
    stage: (data: AudienceStage) => {
      setStage(data)
      setError(null)
    },
  })

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
    <div key={activity.id} className="animate-pop-in space-y-7">
      <div className="flex items-center justify-between">
        <StatusPill open={stage.status === "open"} />
        <ConnectionDot connected={connected} />
      </div>
      <ui.Audience
        config={activity.config}
        me={me}
        outcome={stage.outcome}
        response={stage.myResponse}
        open={stage.status === "open"}
        submit={submit}
      />
      {/* Once answers are locked the activity itself explains why (too slow, closed…). */}
      {error && stage.status === "open" && (
        <p className="rounded-2xl border-[1.5px] border-rose-200 bg-rose-50/80 px-4 py-3 text-center text-sm text-rose-700">
          {error}
        </p>
      )}
      {stage.status === "closed" && stage.leaderboard && (
        <MyPlace board={stage.leaderboard} className="glass animate-pop-in px-5 py-4" />
      )}
    </div>
  )
}

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
        <a
          href={loginUrl("/")}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-pn px-6 py-4 font-headline text-lg font-medium text-white shadow-[0_16px_32px_-16px_rgb(17_86_174/0.8)] transition hover:bg-pn-deep active:scale-[0.98]"
        >
          Sign in with PoliNetwork
          <Icon name="arrow-right" className="size-5" />
        </a>
      }
    />
  )
}

function NotAMember() {
  return (
    <Centered
      icon="lock"
      kicker="Members only"
      title="Reserved to Soci"
      text="Live questions are reserved for PoliNetwork members (Soci). If you think this is a mistake, sign in again with your @polinetwork.org account."
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

function UserMenu({ user }: { user: Me }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      {user.isAdmin && (
        <a href="/admin" className="rounded-full px-3 py-1.5 font-medium text-pn hover:bg-white/70">
          Admin
        </a>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        className="glass flex items-center gap-2 rounded-full! py-1 pr-3 pl-1 text-slate-700 hover:bg-white/80"
        title="Sign out"
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="size-7 rounded-full" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-pn font-display text-xs font-semibold text-white">
            {user.name.slice(0, 1)}
          </span>
        )}
        <span className="max-w-32 truncate font-medium">{user.name.split(" ")[0]}</span>
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
          <span className="absolute inset-0 animate-ping rounded-full bg-white/80" />
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
      <span className="size-1.5 animate-pulse rounded-full bg-amber-400" /> Reconnecting…
    </span>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center">
      <span className="size-8 animate-spin rounded-full border-2 border-white border-t-blue-400" />
    </div>
  )
}
