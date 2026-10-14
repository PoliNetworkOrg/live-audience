import { useEffect, useState } from "react"
import { Link, useLocation } from "wouter"
import { api, useApi, useEventStream } from "../api.ts"
import { Button, Card, Field, Input } from "../ui.tsx"
import {
  ActivityRows,
  type ActivitySummary,
  type ActivityType,
  NewActivity,
  type PresentationSummary,
  slugify,
} from "./ActivityList.tsx"
import { controlPresentation, useStage } from "./AdminLayout.tsx"

interface Leaderboard {
  leaderboard: { rank: number; name: string; points: number }[]
}

export function PresentationList() {
  const presentations = useApi<PresentationSummary[]>("/api/admin/presentations")
  const stage = useStage()
  const [, navigate] = useLocation()
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const effectiveSlug = slug ?? slugify(title)

  const create = async () => {
    try {
      const created = await api<{ id: string }>("/api/admin/presentations", {
        body: { title, slug: effectiveSlug },
      })
      navigate(`/presentations/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Presentations</h1>
        <p className="text-sm text-slate-500">
          Group the activities of one talk: their points add up to a leaderboard, which the audience sees
          between activities.
        </p>
      </div>
      <Card>
        <form
          className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Welcome talk" />
          </Field>
          <Field label="Slug (used by the API)">
            <Input
              value={effectiveSlug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="welcome-talk"
            />
          </Field>
          <Button type="submit" variant="primary" disabled={!title.trim() || !effectiveSlug} className="py-2">
            Create
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </Card>
      <Card className="divide-y divide-slate-100 p-0">
        {presentations.data?.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No presentations yet.</p>
        )}
        {presentations.data?.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/presentations/${p.id}`} className="font-medium hover:underline">
                {p.title}
              </Link>
              <div className="text-xs text-slate-500">
                <code>{p.slug}</code>
              </div>
            </div>
            {stage?.presentation?.id === p.id && (
              <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">running</span>
            )}
          </div>
        ))}
      </Card>
    </div>
  )
}

export function PresentationPage({ id }: { id: string }) {
  const loaded = useApi<PresentationSummary>(`/api/admin/presentations/${id}`)
  const activities = useApi<ActivitySummary[]>("/api/admin/activities")
  const types = useApi<ActivityType[]>("/api/admin/types")
  const presentations = useApi<PresentationSummary[]>("/api/admin/presentations")
  const stage = useStage()
  const [, navigate] = useLocation()
  const [draft, setDraft] = useState({ title: "", slug: "" })
  const [error, setError] = useState<string | null>(null)
  const [resets, setResets] = useState(0)

  useEffect(() => {
    if (loaded.data) setDraft({ title: loaded.data.title, slug: loaded.data.slug })
  }, [loaded.data])

  if (loaded.error) return <p className="text-rose-600">{loaded.error.message}</p>
  const presentation = loaded.data
  if (!presentation) return null
  const running = stage?.presentation?.id === presentation.id
  const dirty = draft.title !== presentation.title || draft.slug !== presentation.slug

  const save = async () => {
    try {
      loaded.setData(
        await api<PresentationSummary>(`/api/admin/presentations/${id}`, { method: "PATCH", body: draft }),
      )
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const remove = async () => {
    if (!confirm(`Delete "${presentation.title}" and its leaderboard? Its activities stay, ungrouped.`))
      return
    await api(`/api/admin/presentations/${id}`, { method: "DELETE" })
    navigate("/presentations")
  }
  const reset = async () => {
    if (!confirm("Delete every answer and point of every activity in this presentation?")) return
    await api(`/api/admin/presentations/${id}/reset`, { method: "POST" })
    setResets((n) => n + 1)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/presentations" className="text-sm text-slate-500 hover:underline">
          ← Presentations
        </Link>
        <h1 className="text-xl font-semibold">{presentation.title}</h1>
        {running && (
          <span className="mr-auto rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
            running
          </span>
        )}
        <span className={running ? "" : "ml-auto"}>
          {running ? (
            <Button variant="ghost" onClick={() => void controlPresentation(null)}>
              End presentation
            </Button>
          ) : (
            <Button variant="success" onClick={() => void controlPresentation(presentation.id)}>
              Start presentation
            </Button>
          )}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="font-medium">Activities</h2>
            <ActivityRows
              activities={activities.data?.filter((a) => a.presentation === presentation.slug) ?? []}
              types={types.data ?? []}
            />
            {types.data && presentations.data && (
              <NewActivity
                types={types.data}
                presentations={presentations.data}
                presentationId={presentation.id}
              />
            )}
          </section>
          <Card className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title">
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              <Field label="Slug" hint="Presentations read the leaderboard by this.">
                <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
              </Field>
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
                Save
              </Button>
              <Button variant="danger" className="ml-auto" onClick={() => void reset()}>
                Reset all answers
              </Button>
              <Button variant="danger" onClick={() => void remove()}>
                Delete
              </Button>
            </div>
          </Card>
        </div>
        <LeaderboardPanel key={resets} presentation={presentation} />
      </div>
    </div>
  )
}

function LeaderboardPanel({ presentation }: { presentation: PresentationSummary }) {
  const board = useApi<Leaderboard>(`/api/admin/presentations/${presentation.id}/leaderboard`)
  // Live while it is the running presentation; otherwise points only change through this page.
  useEventStream("/api/admin/events", {
    leaderboard: (data: Leaderboard & { id: string }) => {
      if (data.id === presentation.id) board.setData(data)
    },
  })
  const entries = board.data?.leaderboard ?? []
  return (
    <Card className="space-y-3 self-start">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Leaderboard</h2>
        <Button variant="ghost" onClick={board.reload}>
          Refresh
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">No points yet.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {entries.map((entry, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: names can repeat
            <li key={index} className="flex gap-2">
              <span className="w-8 text-right text-slate-400 tabular-nums">{entry.rank}.</span>
              <span className="flex-1 truncate">{entry.name}</span>
              <span className="font-medium tabular-nums">{entry.points.toLocaleString("en")}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-slate-500">
        API: <code className="break-all">GET /api/v1/presentations/{presentation.slug}/leaderboard</code>
      </p>
    </Card>
  )
}
