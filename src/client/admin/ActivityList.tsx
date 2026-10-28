import { useEffect, useRef, useState } from "react"
import { Link, useLocation } from "wouter"
import { api, type Players, useApi } from "../api.ts"
import { Icon } from "../icons.tsx"
import { Button, Card, Field, Input, Select, Tag } from "../ui.tsx"
import {
  activitiesResetEvent,
  controlStage,
  PageHeader,
  resetActivity,
  resetPresentation,
  useStage,
} from "./AdminLayout.tsx"

export interface ActivitySummary {
  id: string
  slug: string
  type: string
  title: string
  /** Slug of the presentation it belongs to. */
  presentation: string | null
  /** How many people answered. */
  answers: number
  membersOnly: boolean
  countsToLeaderboard: boolean
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
  /** Who plays while it runs. */
  players: Players
}

/** Every activity, reloaded when the stage changes or answers are reset. */
export function useActivities() {
  const activities = useApi<ActivitySummary[]>("/api/admin/activities")
  const changedAt = useStage()?.changedAt
  const seen = useRef(changedAt)
  const { reload } = activities
  useEffect(() => {
    window.addEventListener(activitiesResetEvent, reload)
    return () => window.removeEventListener(activitiesResetEvent, reload)
  }, [reload])
  useEffect(() => {
    if (changedAt === seen.current) return
    // The first stage to arrive is the one the list was loaded with.
    if (seen.current !== undefined) reload()
    seen.current = changedAt
  }, [changedAt, reload])
  return activities
}

/** "3 answers", or nothing when nobody answered. */
export function answerCount(answers: number) {
  return answers === 0 ? null : `${answers} ${answers === 1 ? "answer" : "answers"}`
}

export function ActivityList() {
  const activities = useActivities()
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
    <div className="space-y-10">
      <PageHeader kicker="Live admin" title="Activities" />
      {types.data && presentations.data && (
        <NewActivity types={types.data} presentations={presentations.data} />
      )}
      {activities.data?.length === 0 && <p className="text-sm text-slate-500">No activities yet.</p>}
      {groups.map((group) => (
        <section key={group.key ?? ""} className="space-y-4">
          <div className="flex items-center gap-3 px-1">
            <h2 className="mr-auto font-headline text-lg text-slate-800">
              {group.presentation ? (
                <Link
                  href={`/presentations/${group.presentation.id}`}
                  className="group inline-flex items-center gap-2 hover:text-pn"
                >
                  {group.presentation.title}
                  <Icon
                    name="arrow-right"
                    className="size-4 text-sky-700 transition group-hover:translate-x-0.5"
                  />
                </Link>
              ) : (
                <span className="text-slate-500">Not in a presentation</span>
              )}
            </h2>
            {group.presentation && (
              <PresentationResetButton presentation={group.presentation} onReset={activities.reload} />
            )}
          </div>
          <ActivityRows activities={group.activities} types={types.data ?? []} onReset={activities.reload} />
        </section>
      ))}
    </div>
  )
}

/** Clears every answer of a presentation's activities, e.g. between two rehearsals. */
export function PresentationResetButton({
  presentation,
  onReset,
}: {
  presentation: PresentationSummary
  onReset: () => void
}) {
  return (
    <Button
      variant="ghost"
      title="Delete every answer, draw and point of its activities"
      onClick={async () => {
        if (await resetPresentation(presentation)) onReset()
      }}
    >
      <Icon name="rotate-ccw" /> Reset answers
    </Button>
  )
}

export function ActivityRows({
  activities,
  types,
  onReset,
}: {
  activities: ActivitySummary[]
  types: ActivityType[]
  /** Called after an activity's answers were reset from its row. */
  onReset: () => void
}) {
  const stage = useStage()
  return (
    <Card className="divide-y-[1.5px] divide-white p-0">
      {activities.length === 0 && <p className="px-6 py-5 text-sm text-slate-500">No activities yet.</p>}
      {activities.map((a) => {
        const onStage = stage?.activity?.id === a.id
        const label = types.find((t) => t.type === a.type)?.label ?? a.type
        return (
          <div key={a.id} className="flex items-center gap-4 px-6 py-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Link
                href={`/activities/${a.id}`}
                className="block truncate font-headline text-slate-800 hover:text-pn"
              >
                {a.title}
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Tag>{label}</Tag>
                <code className="font-mono">{a.slug}</code>
                {a.membersOnly && <Tag>Soci only</Tag>}
                {!a.countsToLeaderboard && <Tag>Off the leaderboard</Tag>}
                {answerCount(a.answers) && <span>· {answerCount(a.answers)}</span>}
              </div>
            </div>
            {onStage && (
              <Tag tone={stage?.status === "open" ? "live" : "warn"}>on stage · {stage?.status}</Tag>
            )}
            <Button
              variant="ghost"
              className="px-2.5"
              title="Reset answers"
              aria-label={`Reset the answers of ${a.title}`}
              onClick={async () => {
                if (await resetActivity(a)) onReset()
              }}
            >
              <Icon name="rotate-ccw" />
            </Button>
            <Button
              variant={onStage ? "secondary" : "success"}
              disabled={onStage && stage?.status === "open"}
              onClick={() => void controlStage({ activity: a.id, status: "open" })}
            >
              <Icon name="play" /> Open
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
        className="grid items-end gap-x-4 gap-y-5 @lg:grid-cols-2 @4xl:grid-cols-[13rem_1fr_1fr_12rem_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Field label="Type">
          <Select
            value={type}
            onChange={setType}
            options={types.map((t) => ({ value: t.type, label: t.label, description: t.description }))}
          />
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
          <Icon name="plus" /> Create
        </Button>
      </form>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
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
    <Select
      value={value}
      onChange={onChange}
      options={[{ value: "", label: "None" }, ...presentations.map((p) => ({ value: p.id, label: p.title }))]}
    />
  )
}
