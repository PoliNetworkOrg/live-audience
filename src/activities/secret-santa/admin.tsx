import { useRef, useState } from "react"
import { api, useApi, useEventStream } from "../../client/api.ts"
import { Button, Card, Field, Input, Textarea } from "../../client/ui.tsx"
import type { SecretSantaConfig, SecretSantaEntry } from "./definition.ts"

interface Participant {
  userId: string
  name: string
  email: string | null
  entry: SecretSantaEntry
  gadget: boolean
  hasMatch: boolean | null
  match: { userId: string; name: string } | null
  giver: { userId: string; name: string } | null
  giftConfirmedAt: number | null
  drawEmailSent: boolean
}
interface AdminView {
  revision: string
  drawnAt: number | null
  withoutEmail: number
  emailsSent: number
  counters: {
    active: number
    confirmed: number
    pending: number
    unmatched: number
    removed: number
    gadget: number
  }
  participants: Participant[]
  removed: { userId: string; name: string; at: number }[]
  history: {
    id: string
    actor: string
    kind: string
    reason: string
    at: number
    changes: { userId: string; name: string; field: string; before: string | null; after: string | null }[]
  }[]
}
type Save = (path: string, body: object, method?: "PATCH" | "DELETE") => Promise<void>

export function SecretSantaAdmin({ activityId, config }: { activityId: string; config: SecretSantaConfig }) {
  const view = useApi<AdminView>(`/api/admin/secret-santa/${activityId}`)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const [selected, setSelected] = useState<string | null>(null)
  const [editingCycle, setEditingCycle] = useState(false)
  const cached = useRef<AdminView | null>(null)
  if (view.data) cached.current = view.data
  useEventStream(`/api/admin/events?activity=${encodeURIComponent(activityId)}`, {
    results: () => view.reload(),
  })
  const save: Save = async (path, body, method = "PATCH") => {
    view.setData(await api<AdminView>(`/api/admin/secret-santa/${activityId}${path}`, { method, body }))
    setError(null)
  }
  const control = async (path: string, question: string) => {
    if (busy || !confirm(question)) return
    setBusy(true)
    try {
      view.setData(await api<AdminView>(`/api/admin/secret-santa/${activityId}${path}`, { method: "POST" }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const data = cached.current
  if (!data)
    return (
      <Card>
        <p role="status">{view.error?.message ?? "Caricamento partecipanti…"}</p>
        {view.error && <Button onClick={view.reload}>Riprova</Button>}
      </Card>
    )
  const rows = data.participants.filter(
    (p) =>
      `${p.name} ${p.email ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (filter === "all" ||
        (filter === "confirmed" && p.giftConfirmedAt !== null) ||
        (filter === "pending" && p.hasMatch && p.giftConfirmedAt === null) ||
        (filter === "unmatched" && p.hasMatch === false) ||
        (filter === "without-email" && !p.email)),
  )
  const person = data.participants.find((p) => p.userId === selected)
  const counters = [
    ["Iscritti attivi", data.counters.active],
    ["Regali confermati", data.counters.confirmed],
    ["Da confermare", data.counters.pending],
    ["Senza destinatario", data.counters.unmatched],
    ["Rimossi alla scadenza", data.counters.removed],
    ["Adesioni gadget", data.counters.gadget],
  ] as const
  return (
    <Card className="min-w-0 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Gestione Secret Santa</h2>
        <p className="mt-1 text-sm text-slate-500">
          Abbinamenti e letterine completi sono visibili solo agli amministratori. Ogni partecipante vede il
          proprio destinatario.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {counters.map(([label, count]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={
            busy || data.drawnAt !== null || data.participants.length < 2 || editingCycle || selected !== null
          }
          onClick={() =>
            void control(
              "/draw",
              `Estrarre i regali per ${data.participants.length} persone? Le iscrizioni si chiudono e partiranno le email.`,
            )
          }
        >
          {data.drawnAt !== null ? "Estrazione effettuata" : "Estrai i regali"}
        </Button>
        {data.drawnAt !== null && (
          <Button
            variant="danger"
            disabled={busy || editingCycle || selected !== null}
            onClick={() =>
              void control(
                "/undo-draw",
                "Annullare l'estrazione e le conferme del regalo? Le letterine degli attivi restano. Le email già inviate non si possono richiamare; al prossimo sorteggio partiranno di nuovo.",
              )
            }
          >
            Annulla estrazione
          </Button>
        )}
        {data.drawnAt !== null && data.participants.length >= 3 && (
          <Button disabled={busy || editingCycle || selected !== null} onClick={() => setEditingCycle(true)}>
            Modifica abbinamenti
          </Button>
        )}
        <Button variant="ghost" onClick={view.reload}>
          Aggiorna dati
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {data.drawnAt !== null
          ? `Estratto il ${new Date(data.drawnAt).toLocaleString("it-IT")}. Email estrazione inviate: ${data.emailsSent}/${data.participants.length}.`
          : config.drawAt
            ? `Estrazione automatica: ${new Date(config.drawAt).toLocaleString("it-IT")}.`
            : "Nessuna estrazione automatica configurata."}
        {data.withoutEmail > 0 && ` ${data.withoutEmail} persone senza email.`}
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      {view.error && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Aggiornamento non riuscito. I dati mostrati potrebbero essere superati; la bozza è conservata. Usa
          «Aggiorna dati» per riprovare.
        </p>
      )}
      {editingCycle && (
        <CycleEditor
          initial={data}
          currentRevision={data.revision}
          save={save}
          onClose={() => setEditingCycle(false)}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cerca persona">
          <Input
            className="text-base"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome o email"
          />
        </Field>
        <Field label="Mostra">
          <select
            aria-label="Filtra partecipanti"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-blue-500"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Tutti gli attivi</option>
            <option value="confirmed">Regalo confermato</option>
            <option value="pending">Da confermare</option>
            <option value="unmatched">Senza destinatario</option>
            <option value="without-email">Senza email</option>
          </select>
        </Field>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <caption className="sr-only">Partecipanti e abbinamenti Secret Santa</caption>
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {["Persona", "Regala a", "Riceve da", "Regalo", "Email estrazione", "Gestione"].map((label) => (
                <th key={label} className="px-3 py-2 font-medium" scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.userId}>
                <th scope="row" className="px-3 py-3 font-medium">
                  <span className="block">{p.name}</span>
                  <span className="block text-xs font-normal text-slate-500">
                    {p.email ?? "Email assente"}
                  </span>
                </th>
                <td className="px-3 py-3">
                  {p.match?.name ?? (data.drawnAt === null ? "Da estrarre" : "Nessuno")}
                </td>
                <td className="px-3 py-3">{p.giver?.name ?? "—"}</td>
                <td className="px-3 py-3">
                  {p.giftConfirmedAt !== null ? (
                    <span className="font-medium text-emerald-700">Confermato</span>
                  ) : p.hasMatch ? (
                    "Da confermare"
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-3">
                  {!p.email
                    ? "Email assente"
                    : p.drawEmailSent
                      ? "Inviata"
                      : data.drawnAt !== null
                        ? "Da inviare"
                        : "—"}
                </td>
                <td className="px-3 py-3">
                  <Button
                    className="min-h-11"
                    disabled={editingCycle || (selected !== null && selected !== p.userId)}
                    aria-label={`Gestisci ${p.name}`}
                    onClick={() => setSelected(p.userId)}
                  >
                    Gestisci
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-slate-500">
                  Nessuna persona corrisponde ai filtri.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {person && (
        <ParticipantEditor
          key={person.userId}
          participant={person}
          initialRevision={data.revision}
          currentRevision={data.revision}
          config={config}
          save={save}
          onClose={() => setSelected(null)}
        />
      )}
      {data.removed.length > 0 && (
        <section>
          <h3 className="font-medium">Rimossi per mancata conferma</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {data.removed.map((p) => (
              <li key={p.userId}>
                {p.name} · {new Date(p.at).toLocaleString("it-IT")}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="border-t border-slate-100 pt-4">
        <h3 className="font-medium">Interventi degli organizzatori</h3>
        {data.history.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nessuna correzione manuale registrata.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.history.map((event) => (
              <li key={event.id} className="py-3 text-sm">
                <p className="font-medium">
                  {event.kind} · {event.actor}
                </p>
                <p className="text-xs text-slate-500">{new Date(event.at).toLocaleString("it-IT")}</p>
                <p className="mt-1 break-words">{event.reason}</p>
                <details className="mt-1 text-slate-600">
                  <summary className="cursor-pointer">Vedi modifiche</summary>
                  <ul className="mt-1 space-y-1">
                    {event.changes.map((change) => (
                      <li key={`${change.userId}-${change.field}`}>
                        {change.name} · {change.field}: {change.before ?? "—"} → {change.after ?? "—"}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  )
}

function CycleEditor({
  initial,
  currentRevision,
  save,
  onClose,
}: {
  initial: AdminView
  currentRevision: string
  save: Save
  onClose: () => void
}) {
  const [snapshot] = useState(initial)
  const [order, setOrder] = useState(() => {
    const ids = initial.participants.map((p) => p.userId)
    const seen: string[] = []
    let current = ids[0]
    while (current && !seen.includes(current)) {
      seen.push(current)
      current = initial.participants.find((p) => p.userId === current)?.match?.userId
    }
    return seen.length === ids.length && seen.every((id) => ids.includes(id)) && current === ids[0]
      ? seen
      : ids
  })
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const assignments = Object.fromEntries(order.map((id, i) => [id, order[(i + 1) % order.length] as string]))
  const nameOf = (id: string | null | undefined) =>
    snapshot.participants.find((p) => p.userId === id)?.name ?? "Nessuno"
  const changes = snapshot.participants.filter((p) => p.match?.userId !== assignments[p.userId])
  const move = (index: number, delta: number) => {
    const next = [...order]
    const other = index + delta
    ;[next[index], next[other]] = [next[other] as string, next[index] as string]
    setOrder(next)
  }
  const submit = async () => {
    if (saving || !reason.trim() || !changes.length) return
    setSaving(true)
    try {
      await save("/assignments", { revision: snapshot.revision, reason, assignments })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <form
      className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h3 className="font-semibold">Correggi il giro dei regali</h3>
      <p className="text-sm text-slate-600">
        Ogni persona regala alla successiva; l'ultima regala alla prima. Sposta le persone e controlla gli
        abbinamenti che cambiano prima di salvare.
      </p>
      <ol className="space-y-2">
        {order.map((id, i) => (
          <li
            key={id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm"
          >
            <span className="min-w-0 flex-1 break-words">
              <strong>{nameOf(id)}</strong> → {nameOf(assignments[id])}
            </span>
            <Button
              className="min-h-11 min-w-11"
              disabled={saving || i === 0}
              aria-label={`Sposta su ${nameOf(id)}`}
              onClick={() => move(i, -1)}
            >
              ↑
            </Button>
            <Button
              className="min-h-11 min-w-11"
              disabled={saving || i === order.length - 1}
              aria-label={`Sposta giù ${nameOf(id)}`}
              onClick={() => move(i, 1)}
            >
              ↓
            </Button>
          </li>
        ))}
      </ol>
      <div>
        <h4 className="text-sm font-semibold">Anteprima: {changes.length} abbinamenti cambiano</h4>
        <ul className="mt-2 space-y-1 text-sm">
          {changes.map((p) => (
            <li key={p.userId}>
              {p.name}: {p.match?.name ?? "Nessuno"} → <strong>{nameOf(assignments[p.userId])}</strong>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Le conferme dei regali restano valide. Le persone coinvolte ricevono una mail di aggiornamento.
        </p>
      </div>
      <Field label="Motivo della correzione">
        <Textarea
          className="text-base"
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Descrivi il caso particolare"
        />
      </Field>
      {snapshot.revision !== currentRevision && (
        <p role="status" className="text-sm text-amber-800">
          I dati sono cambiati mentre modificavi il giro. Chiudi e riapri la modifica per lavorare sui dati
          aggiornati.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={saving || !reason.trim() || !changes.length || snapshot.revision !== currentRevision}
        >
          {saving ? "Salvataggio…" : "Salva gli abbinamenti"}
        </Button>
        <Button disabled={saving} onClick={onClose}>
          Chiudi senza salvare
        </Button>
      </div>
    </form>
  )
}

function ParticipantEditor({
  participant,
  initialRevision,
  currentRevision,
  config,
  save,
  onClose,
}: {
  participant: Participant
  initialRevision: string
  currentRevision: string
  config: SecretSantaConfig
  save: Save
  onClose: () => void
}) {
  const [snapshot] = useState({ person: participant, revision: initialRevision })
  const [confirmed, setConfirmed] = useState(participant.giftConfirmedAt !== null)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (remove = false) => {
    if (saving || !reason.trim()) return
    if (
      remove &&
      !confirm(
        `Rimuovere ${participant.name}? Il giro sarà aggiornato e le persone coinvolte saranno avvisate.`,
      )
    )
      return
    setSaving(true)
    try {
      await save(
        `/participants/${encodeURIComponent(participant.userId)}${remove ? "" : "/confirmation"}`,
        { revision: snapshot.revision, reason, ...(remove ? {} : { confirmed }) },
        remove ? "DELETE" : "PATCH",
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <form
      className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h3 className="font-semibold">Gestisci {participant.name}</h3>
      <p className="break-all text-sm text-slate-500">{participant.email ?? "Email assente"}</p>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium">Le cose che ama</dt>
          <dd className="whitespace-pre-wrap break-words text-slate-600">{participant.entry.likes}</dd>
        </div>
        {participant.entry.dislikes && (
          <div>
            <dt className="font-medium">Meglio di no</dt>
            <dd className="whitespace-pre-wrap break-words text-slate-600">{participant.entry.dislikes}</dd>
          </div>
        )}
      </dl>
      {participant.hasMatch && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={saving}
            className="size-5"
          />
          Il regalo è già stato acquistato o preparato
        </label>
      )}
      {participant.giftConfirmedAt !== null && (
        <p className="text-xs text-slate-500">
          Conferma registrata il {new Date(participant.giftConfirmedAt).toLocaleString("it-IT")}.
        </p>
      )}
      {config.confirmationDueAt && !confirmed && participant.giftConfirmedAt !== null && (
        <p className="text-sm text-amber-800">
          Revocando la conferma torneranno ad applicarsi la scadenza e la rimozione automatica.
        </p>
      )}
      <Field label="Motivo dell'intervento">
        <Textarea
          className="text-base"
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {snapshot.revision !== currentRevision && (
        <p role="status" className="text-sm text-amber-800">
          La situazione è cambiata. Chiudi e riapri la persona prima di salvare.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {participant.hasMatch && (
          <Button
            type="submit"
            variant="primary"
            disabled={
              saving ||
              !reason.trim() ||
              confirmed === (snapshot.person.giftConfirmedAt !== null) ||
              snapshot.revision !== currentRevision
            }
          >
            {saving ? "Salvataggio…" : "Salva conferma"}
          </Button>
        )}
        <Button disabled={saving} onClick={onClose}>
          Chiudi
        </Button>
      </div>
      <div className="border-t border-slate-200 pt-4">
        <Button
          variant="danger"
          disabled={saving || !reason.trim() || snapshot.revision !== currentRevision}
          onClick={() => void submit(true)}
        >
          Rimuovi partecipante
        </Button>
      </div>
    </form>
  )
}
