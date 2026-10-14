import { type ReactNode, useState } from "react"
import { activityUIs } from "../../activities/ui-registry.ts"
import { api, loginUrl, logout, type Me, useEventStream, useMe } from "../api.ts"
import { Leaderboard, type LeaderboardView, MyPlace } from "../audience-ui.tsx"

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
    <div className="relative flex min-h-dvh flex-col bg-brand-950 text-white">
      <Backdrop />
      <header className="relative z-10 flex items-center justify-between gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="size-8 rounded-full" />
          <span className="font-semibold tracking-tight">
            PoliNetwork <span className="text-sky-300">Live</span>
          </span>
        </div>
        {user && <UserMenu user={user} />}
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
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
      <div className="space-y-8">
        <Centered
          icon={<span className="animate-float block text-6xl">{stage.leaderboard ? "🏁" : "✨"}</span>}
          title={stage.leaderboard ? "Catch your breath" : "Nothing to do right now"}
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
    <div key={activity.id} className="animate-pop-in space-y-4">
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
        <p className="rounded-xl bg-rose-500/20 px-4 py-3 text-center text-sm text-rose-100">{error}</p>
      )}
      {stage.status === "closed" && stage.leaderboard && (
        <MyPlace board={stage.leaderboard} className="animate-pop-in rounded-2xl bg-white/5 px-4 py-3" />
      )}
    </div>
  )
}

function SignIn() {
  return (
    <Centered
      icon={<span className="animate-float block text-6xl">🎤</span>}
      title="Join the presentation"
      text="Sign in with your PoliNetwork account to vote and answer live questions."
      footer={
        <a
          href={loginUrl("/")}
          className="inline-flex w-full items-center justify-center rounded-2xl bg-white px-5 py-4 text-lg font-semibold text-brand-950 transition active:scale-[0.98]"
        >
          Sign in with PoliNetwork
        </a>
      }
    />
  )
}

function NotAMember() {
  return (
    <Centered
      icon={<span className="block text-6xl">🔒</span>}
      title="Members only"
      text="Live questions are reserved for PoliNetwork members (Soci). If you think this is a mistake, sign in again with your @polinetwork.org account."
      footer={
        <button type="button" onClick={() => void logout()} className="text-sm text-sky-200 underline">
          Sign out
        </button>
      }
    />
  )
}

function UserMenu({ user }: { user: Me }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {user.isAdmin && (
        <a href="/admin" className="text-sky-200 hover:text-white">
          Admin
        </a>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        className="flex items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 hover:bg-white/15"
        title="Sign out"
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="size-6 rounded-full" />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-sky-300 text-xs font-bold text-brand-950">
            {user.name.slice(0, 1)}
          </span>
        )}
        <span className="max-w-32 truncate">{user.name.split(" ")[0]}</span>
      </button>
    </div>
  )
}

function Centered({
  icon,
  title,
  text,
  footer,
}: {
  icon: ReactNode
  title: string
  text: string
  footer?: ReactNode
}) {
  return (
    <div className="animate-pop-in space-y-5 text-center">
      {icon}
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      <p className="text-pretty text-sky-100/75">{text}</p>
      {footer && <div className="pt-2">{footer}</div>}
    </div>
  )
}

function StatusPill({ open }: { open: boolean }) {
  return open ? (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-300 uppercase">
      <span className="size-2 animate-pulse rounded-full bg-emerald-400" /> Live
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-white/60 uppercase">
      Closed
    </span>
  )
}

function ConnectionDot({ connected }: { connected: boolean }) {
  return connected ? null : (
    <span className="inline-flex items-center gap-1.5 text-xs text-amber-200/80">
      <span className="size-1.5 animate-pulse rounded-full bg-amber-300" /> Reconnecting…
    </span>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center">
      <span className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-sky-300" />
    </div>
  )
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-32 -left-24 size-96 rounded-full bg-blue-600/30 blur-3xl" />
      <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-sky-400/20 blur-3xl" />
      <div className="absolute -bottom-40 left-1/4 size-[28rem] rounded-full bg-brand-800/60 blur-3xl" />
    </div>
  )
}
