import { useState } from "react"
import { Link, useLocation } from "wouter"
import { api, useApi } from "../api.ts"
import { Button, Card, Field, Input } from "../ui.tsx"
import { controlStage, useStage } from "./AdminLayout.tsx"

interface ActivitySummary {
  id: string
  slug: string
  type: string
  title: string
}

export interface ActivityType {
  type: string
  label: string
  description: string
}

export function ActivityList() {
  const activities = useApi<ActivitySummary[]>("/api/admin/activities")
  const types = useApi<ActivityType[]>("/api/admin/types")
  const stage = useStage()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Activities</h1>
      </div>
      {types.data && <NewActivity types={types.data} />}
      <Card className="divide-y divide-slate-100 p-0">
        {activities.data?.length === 0 && <p className="p-4 text-sm text-slate-500">No activities yet.</p>}
        {activities.data?.map((a) => {
          const onStage = stage?.activity?.id === a.id
          const label = types.data?.find((t) => t.type === a.type)?.label ?? a.type
          return (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/activities/${a.id}`} className="font-medium hover:underline">
                  {a.title}
                </Link>
                <div className="text-xs text-slate-500">
                  {label} · <code>{a.slug}</code>
                </div>
              </div>
              {onStage && (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  on stage · {stage?.status}
                </span>
              )}
              <Button
                variant={onStage ? "secondary" : "success"}
                disabled={onStage && stage?.status === "open"}
                onClick={() => void controlStage({ activity: a.id, status: "open" })}
              >
                ▶ Open
              </Button>
            </div>
          )
        })}
      </Card>
    </div>
  )
}

function slugify(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

function NewActivity({ types }: { types: ActivityType[] }) {
  const [, navigate] = useLocation()
  const [type, setType] = useState(types[0]?.type ?? "")
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const effectiveSlug = slug ?? slugify(title)

  const create = async () => {
    try {
      const created = await api<{ id: string }>("/api/admin/activities", {
        body: { type, title, slug: effectiveSlug },
      })
      navigate(`/activities/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card>
      <form
        className="grid items-end gap-3 sm:grid-cols-[10rem_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {types.map((t) => (
              <option key={t.type} value={t.type} title={t.description}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title (admin only)">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner poll" />
        </Field>
        <Field label="Slug (used by the API)">
          <Input value={effectiveSlug} onChange={(e) => setSlug(e.target.value)} placeholder="dinner-poll" />
        </Field>
        <Button type="submit" variant="primary" disabled={!title.trim() || !effectiveSlug} className="py-2">
          Create
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Card>
  )
}
