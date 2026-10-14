import { createContext, type ReactNode, useContext, useState } from "react"
import { Link, useRoute } from "wouter"
import { api, loginUrl, logout, useEventStream, useMe } from "../api.ts"
import { Button, cx } from "../ui.tsx"

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
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6 text-center text-slate-700">
        <div className="space-y-2">
          <p className="font-medium">
            You are signed in as {user.name}, but you are not an admin of this app.
          </p>
          <p className="text-sm text-slate-500">Ask for the admin permission in the PoliNetwork IdP.</p>
          <Button onClick={() => void logout()}>Sign out</Button>
        </div>
      </div>
    )
  }

  return (
    <StageContext.Provider value={stage}>
      <div className="min-h-dvh bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <img src="/logo.png" alt="" className="size-6 rounded-full" />
              Live admin
            </Link>
            <nav className="flex gap-1 text-sm">
              <NavLink href="/">Activities</NavLink>
              <NavLink href="/presentations">Presentations</NavLink>
              <NavLink href="/api">API</NavLink>
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
              >
                Audience page ↗
              </a>
            </nav>
            <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
              {user.name}
              <Button variant="ghost" onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </div>
          <StageBar stage={stage} />
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </div>
    </StageContext.Provider>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [active] = useRoute(href)
  return (
    <Link
      href={href}
      className={cx(
        "rounded-md px-2 py-1",
        active ? "bg-slate-100 font-medium" : "text-slate-600 hover:bg-slate-100",
      )}
    >
      {children}
    </Link>
  )
}

function StageBar({ stage }: { stage: StageInfo | null }) {
  if (!stage) return null
  const open = stage.status === "open"
  return (
    <div
      className={cx(
        "border-t text-sm",
        stage.activity
          ? open
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200"
          : "border-slate-200 bg-slate-50",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-1.5">
        {stage.presentation && (
          <Link
            href={`/presentations/${stage.presentation.id}`}
            className="rounded bg-sky-100 px-1.5 text-xs font-medium text-sky-800 hover:underline"
            title="Running presentation: the audience sees its leaderboard between activities"
          >
            {stage.presentation.title}
          </Link>
        )}
        <span className="font-medium">On stage:</span>
        {stage.activity ? (
          <>
            <Link href={`/activities/${stage.activity.id}`} className="underline">
              {stage.activity.title}
            </Link>
            <span
              className={cx(
                "rounded px-1.5 text-xs font-semibold uppercase",
                open ? "bg-emerald-600 text-white" : "bg-amber-500 text-white",
              )}
            >
              {open ? "open" : "closed"}
            </span>
            <span className="ml-auto flex gap-1.5">
              {open ? (
                <Button onClick={() => void controlStage("close")}>Close answers</Button>
              ) : (
                <Button variant="success" onClick={() => void controlStage("open")}>
                  Open answers
                </Button>
              )}
              <Button variant="ghost" onClick={() => void controlStage("clear")}>
                Clear stage
              </Button>
            </span>
          </>
        ) : (
          <span className="text-slate-500">nothing, the audience sees the idle screen</span>
        )}
      </div>
    </div>
  )
}
