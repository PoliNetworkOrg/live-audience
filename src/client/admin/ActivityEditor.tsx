import { useEffect, useState } from "react"
import { Link, useLocation } from "wouter"
import { activityUIs } from "../../activities/ui-registry.ts"
import { ApiError, api, useApi, useEventStream } from "../api.ts"
import { Button, Card, Field, Input } from "../ui.tsx"
import { controlStage, useStage } from "./AdminLayout.tsx"

interface Activity {
  id: string
  slug: string
  type: string
  title: string
  config: unknown
  updatedAt: number
}

export function ActivityEditor({ id }: { id: string }) {
  const loaded = useApi<Activity>(`/api/admin/activities/${id}`)
  const [draft, setDraft] = useState<Activity | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [, navigate] = useLocation()

  useEffect(() => {
    if (loaded.data) setDraft(loaded.data)
  }, [loaded.data])

  if (loaded.error) return <p className="text-rose-600">{loaded.error.message}</p>
  if (!draft || !loaded.data) return null

  const ui = activityUIs[draft.type]
  const dirty = JSON.stringify(draft) !== JSON.stringify(loaded.data)

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api<Activity>(`/api/admin/activities/${id}`, {
        method: "PATCH",
        body: { title: draft.title, slug: draft.slug, config: draft.config },
      })
      loaded.setData(saved)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete "${draft.title}" and all its answers?`)) return
    await api(`/api/admin/activities/${id}`, { method: "DELETE" })
    navigate("/")
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className="text-sm text-slate-500 hover:underline">
          ← Activities
        </Link>
        <h1 className="mr-auto text-xl font-semibold">{loaded.data.title}</h1>
        <StageButtons activityId={id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title (admin only)">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="Slug" hint="Presentations refer to the activity by this. Changing it breaks them.">
              <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
            </Field>
          </div>
          <hr className="border-slate-100" />
          {ui ? (
            <ui.Editor config={draft.config} onChange={(config) => setDraft({ ...draft, config })} />
          ) : (
            <p className="text-sm text-rose-600">Unknown activity type "{draft.type}".</p>
          )}
          {error && <ErrorBox error={error} />}
          <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
            <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(loaded.data ?? null)}>
                Discard changes
              </Button>
            )}
            <Button variant="danger" className="ml-auto" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        </Card>
        <ResultsPanel activity={loaded.data} />
      </div>
    </div>
  )
}

function StageButtons({ activityId }: { activityId: string }) {
  const stage = useStage()
  const onStage = stage?.activity?.id === activityId
  if (onStage) {
    return (
      <>
        <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
          on stage · {stage?.status}
        </span>
        {stage?.status === "open" ? (
          <Button onClick={() => void controlStage("close")}>Close answers</Button>
        ) : (
          <Button variant="success" onClick={() => void controlStage("open")}>
            Open answers
          </Button>
        )}
        <Button variant="ghost" onClick={() => void controlStage("clear")}>
          Take off stage
        </Button>
      </>
    )
  }
  return (
    <>
      <Button onClick={() => void controlStage({ activity: activityId, status: "closed" })}>
        Show (closed)
      </Button>
      <Button variant="success" onClick={() => void controlStage({ activity: activityId, status: "open" })}>
        ▶ Put on stage & open
      </Button>
    </>
  )
}

function ResultsPanel({ activity }: { activity: Activity }) {
  const [results, setResults] = useState<{ results: unknown } | null>(null)
  useEventStream(`/api/admin/events?activity=${encodeURIComponent(activity.id)}`, {
    results: (data: { results: unknown }) => setResults(data),
  })
  const ui = activityUIs[activity.type]

  const reset = async () => {
    if (!confirm("Delete every answer to this activity?")) return
    await api(`/api/admin/activities/${activity.id}/reset`, { method: "POST" })
  }

  return (
    <Card className="space-y-3 self-start">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Live results</h2>
        <Button variant="ghost" onClick={() => void reset()}>
          Reset answers
        </Button>
      </div>
      {results &&
        (ui?.Results ? (
          <ui.Results config={activity.config} results={results.results} />
        ) : (
          <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">
            {JSON.stringify(results.results, null, 2)}
          </pre>
        ))}
      <p className="text-xs text-slate-500">
        API: <code className="break-all">GET /api/v1/activities/{activity.slug}/results</code>
      </p>
    </Card>
  )
}

function ErrorBox({ error }: { error: ApiError }) {
  const issues = Array.isArray(error.details) ? (error.details as { path: unknown[]; message: string }[]) : []
  return (
    <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
      <p className="font-medium">{error.message}</p>
      {issues.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {issues.map((issue, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            <li key={i}>
              {issue.path.length > 0 && <code>{issue.path.join(".")}: </code>}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
