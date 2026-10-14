import { createContext, type ReactNode, useContext, useState } from "react"
import { Link, useRoute } from "wouter"
import { api, loginUrl, logout, useEventStream, useMe } from "../api.ts"
import { Backdrop, Wordmark } from "../brand.tsx"
import { Icon, type IconName } from "../icons.tsx"
import { Button, Card, cx, Tag } from "../ui.tsx"

export interface StageInfo {
  status: "open" | "closed"
  changedAt: number
  activity: { id: string; slug: string; type: string; title: string } | null
  /** The running presentation, whose leaderboard the audience sees between activities. */
  presentation: { id: string; slug: string; title: string } | null
}

const StageContext = createContext<StageInfo | null>(null)

/** The live stage, shared by every admin page through a single event stream. */
export function useStage() {
  return useContext(StageContext)
}

export async function controlStage(
  action: "open" | "close" | "clear" | { activity: string; status: "open" | "closed" },
) {
  return typeof action === "string"
    ? api<StageInfo>(`/api/admin/stage/${action}`, { method: "POST" })
    : api<StageInfo>("/api/admin/stage", { body: action })
}

/** Starts a presentation, or ends the running one with null. */
export async function controlPresentation(presentation: string | null) {
  return api<StageInfo>("/api/admin/stage/presentation", { body: { presentation } })
}

/** Deletes every answer, draw and point of an activity once confirmed; tells whether it did. */
export async function resetActivity(activity: { id: string; title: string }) {
  if (!confirm(`Delete every answer and point of "${activity.title}"?`)) return false
  await api(`/api/admin/activities/${activity.id}/reset`, { method: "POST" })
  return true
}

/** The same for every activity of a presentation: a fresh start for its leaderboard. */
export async function resetPresentation(presentation: { id: string; title: string }) {
  if (!confirm(`Delete every answer and point of every activity in "${presentation.title}"?`)) return false
  await api(`/api/admin/presentations/${presentation.id}/reset`, { method: "POST" })
  return true
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const me = useMe()
  const user = me.data?.user
  const [stage, setStage] = useState<StageInfo | null>(null)
  useEventStream(user?.isAdmin ? "/api/admin/events" : null, { stage: (s: StageInfo) => setStage(s) })

  if (me.loading && !me.data) return null
  if (!user) {
    window.location.href = loginUrl()
    return null
  }
  if (!user.isAdmin) {
    return (
      <div className="relative flex min-h-dvh items-center justify-center p-6 text-center">
        <Backdrop calm />
        <Card className="relative max-w-md space-y-4 p-8">
          <p className="kicker">Live admin</p>
          <p className="font-display text-2xl font-medium tracking-tight text-slate-800">Not an admin</p>
          <p className="text-slate-600">
            You are signed in as <b className="font-semibold text-slate-800">{user.name}</b>, but you are not
            an admin of this app. Ask for the admin permission in the PoliNetwork IdP.
          </p>
          <Button onClick={() => void logout()}>Sign out</Button>
        </Card>
      </div>
    )
  }

  return (
    <StageContext.Provider value={stage}>
      <div className="relative min-h-dvh text-slate-950">
        <Backdrop calm />
        <header className="sticky top-0 z-20 px-4 pt-4">
          <div className="glass-solid mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 py-2.5 pr-2.5 pl-5 sm:rounded-full!">
            <Link href="/">
              <Wordmark suffix="Live admin" />
            </Link>
            <nav className="flex flex-wrap gap-1.5 text-sm">
              <NavLink href="/" icon="list">
                Activities
              </NavLink>
              <NavLink href="/presentations" icon="layers">
                Presentations
              </NavLink>
              <NavLink href="/api" icon="key">
                API
              </NavLink>
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-slate-600 transition hover:bg-white hover:text-pn"
              >
                Audience page <Icon name="external-link" className="size-3.5" />
              </a>
            </nav>
            <div className="ml-auto flex items-center gap-1.5 text-sm text-slate-600">
              <span className="hidden px-2 sm:inline">{user.name}</span>
              <Button variant="ghost" onClick={() => void logout()} title="Sign out">
                <Icon name="log-out" /> Sign out
              </Button>
            </div>
          </div>
          <StageBar stage={stage} />
        </header>
        <main className="relative mx-auto max-w-6xl px-4 pt-10 pb-20">{children}</main>
      </div>
    </StageContext.Provider>
  )
}

/** The title of an admin page, with a kicker above it like on the slides. */
export function PageHeader({
  kicker,
  title,
  back,
  children,
}: {
  kicker: string
  title: ReactNode
  /** Where the kicker leads, e.g. back to the list. */
  back?: string
  /** Buttons and tags on the right. */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="mr-auto min-w-0">
        {back ? (
          <Link href={back} className="kicker mb-3 inline-flex items-center gap-1.5 hover:text-pn">
            <Icon name="arrow-left" className="size-3.5" /> {kicker}
          </Link>
        ) : (
          <p className="kicker mb-3">{kicker}</p>
        )}
        <h1 className="font-display text-4xl leading-tight font-medium tracking-tight text-balance text-slate-800">
          {title}
        </h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2.5">{children}</div>}
    </div>
  )
}

function NavLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  const [active] = useRoute(href)
  return (
    <Link
      href={href}
      className={cx(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 transition [&>svg]:size-4",
        active ? "bg-pn font-medium text-white" : "text-slate-600 hover:bg-white hover:text-pn",
      )}
    >
      <Icon name={icon} />
      {children}
    </Link>
  )
}

function StageBar({ stage }: { stage: StageInfo | null }) {
  if (!stage) return null
  const open = stage.status === "open"
  return (
    <div className="glass mx-auto mt-3 flex max-w-6xl flex-wrap items-center gap-3 py-2 pr-2 pl-5 sm:rounded-full! text-sm">
      <span
        className={cx(
          "size-2.5 shrink-0 rounded-full",
          stage.activity
            ? open
              ? "bg-emerald-500 shadow-[0_0_0_4px_rgb(16_185_129/0.2)]"
              : "bg-amber-400"
            : "bg-slate-300",
        )}
      />
      <span className="label-caps">On stage</span>
      {stage.activity ? (
        <>
          <Link
            href={`/activities/${stage.activity.id}`}
            className="font-headline text-slate-800 underline decoration-slate-300 underline-offset-4 hover:decoration-pn"
          >
            {stage.activity.title}
          </Link>
          <Tag tone={open ? "live" : "warn"}>{open ? "open" : "closed"}</Tag>
        </>
      ) : (
        <span className="text-slate-500">nothing, the audience sees the idle screen</span>
      )}
      {stage.presentation && (
        <Link
          href={`/presentations/${stage.presentation.id}`}
          title="Running presentation: the audience sees its leaderboard between activities"
        >
          <Tag tone="blue" className="hover:bg-sky-800">
            <Icon name="layers" /> {stage.presentation.title}
          </Tag>
        </Link>
      )}
      {stage.activity && (
        <span className="ml-auto flex gap-2">
          {open ? (
            <Button onClick={() => void controlStage("close")}>
              <Icon name="lock" /> Close answers
            </Button>
          ) : (
            <Button variant="success" onClick={() => void controlStage("open")}>
              <Icon name="play" /> Open answers
            </Button>
          )}
          <Button
            variant="ghost"
            title="Delete its answers and points"
            onClick={() => stage.activity && void resetActivity(stage.activity)}
          >
            <Icon name="rotate-ccw" /> Reset answers
          </Button>
          <Button variant="ghost" onClick={() => void controlStage("clear")}>
            Clear stage
          </Button>
        </span>
      )}
    </div>
  )
}
