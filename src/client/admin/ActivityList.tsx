import { useState } from "react"
import { Link, useLocation } from "wouter"
import { api, useApi } from "../api.ts"
import { Button, Card, Field, Input, Select } from "../ui.tsx"
import { controlStage, useStage } from "./AdminLayout.tsx"

export interface ActivitySummary {
  id: string
  slug: string
  type: string
  title: string
  /** Slug of the presentation it belongs to. */
  presentation: string | null
}

export interface ActivityType {
  type: string
  label: string
  description: string
}

export interface PresentationSummary {
  id: string
  slug: string
  title: string
}

export function ActivityList() {
  const activities = useApi<ActivitySummary[]>("/api/admin/activities")
  const types = useApi<ActivityType[]>("/api/admin/types")
  const presentations = useApi<PresentationSummary[]>("/api/admin/presentations")
  const groups = [
    ...(presentations.data ?? []).map((p) => ({
      presentation: p as PresentationSummary | null,
      key: p.slug,
    })),
    { presentation: null, key: null },
  ]
    .map((group) => ({
      ...group,
      activities: activities.data?.filter((a) => a.presentation === group.key) ?? [],
    }))
    .filter((group) => group.presentation || group.activities.length > 0)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Activities</h1>
      {types.data && presentations.data && (
        <NewActivity types={types.data} presentations={presentations.data} />
      )}
      {activities.data?.length === 0 && <p className="text-sm text-slate-500">No activities yet.</p>}
      {groups.map((group) => (
        <section key={group.key ?? ""} className="space-y-2">
          <h2 className="text-sm font-medium text-slate-500">
            {group.presentation ? (
              <Link href={`/presentations/${group.presentation.id}`} className="hover:underline">
                {group.presentation.title} →
              </Link>
            ) : (
              "Not in a presentation"
            )}
          </h2>
          <ActivityRows activities={group.activities} types={types.data ?? []} />
        </section>
      ))}
    </div>
  )
}

export function ActivityRows({
  activities,
  types,
}: {
  activities: ActivitySummary[]
  types: ActivityType[]
}) {
  const stage = useStage()
  return (
    <Card className="divide-y divide-slate-100 p-0">
      {activities.length === 0 && <p className="p-4 text-sm text-slate-500">No activities yet.</p>}
      {activities.map((a) => {
        const onStage = stage?.activity?.id === a.id
        const label = types.find((t) => t.type === a.type)?.label ?? a.type
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
  )
}

export function slugify(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

export function NewActivity({
  types,
  presentations,
  presentationId = null,
}: {
  types: ActivityType[]
  presentations: PresentationSummary[]
  /** Preselected presentation, e.g. on a presentation's page. */
  presentationId?: string | null
}) {
  const [, navigate] = useLocation()
  const [type, setType] = useState(types[0]?.type ?? "")
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState<string | null>(null)
  const [presentation, setPresentation] = useState(presentationId ?? "")
  const [error, setError] = useState<string | null>(null)
  const effectiveSlug = slug ?? slugify(title)

  const create = async () => {
    try {
      const created = await api<{ id: string }>("/api/admin/activities", {
        body: { type, title, slug: effectiveSlug, presentationId: presentation || null },
      })
      navigate(`/activities/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card className="@container">
      <form
        className="grid items-end gap-3 @lg:grid-cols-2 @4xl:grid-cols-[10rem_1fr_1fr_12rem_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t.type} value={t.type} title={t.description}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title (admin only)">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner poll" />
        </Field>
        <Field label="Slug (used by the API)">
          <Input value={effectiveSlug} onChange={(e) => setSlug(e.target.value)} placeholder="dinner-poll" />
        </Field>
        <Field label="Presentation">
          <PresentationSelect presentations={presentations} value={presentation} onChange={setPresentation} />
        </Field>
        <Button type="submit" variant="primary" disabled={!title.trim() || !effectiveSlug} className="py-2">
          Create
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Card>
  )
}

/** Picks a presentation by id; "" means none. */
export function PresentationSelect({
  presentations,
  value,
  onChange,
}: {
  presentations: PresentationSummary[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>
      {presentations.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}
        </option>
      ))}
    </Select>
  )
}
