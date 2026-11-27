import { useEffect, useRef, useState } from "react"
import { ApiError, api, useApi, useEventStream } from "../../client/api.ts"
import { Button, Card, Field, Input, Textarea } from "../../client/ui.tsx"
import { confirmationClosesAt, type SecretSantaConfig, type SecretSantaEntry } from "./definition.ts"

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
  /** The pairings are a draft: no email has gone out and participants cannot see them yet. */
  held: boolean
  withoutEmail: number
  emailsSent: number
  counters: {
    active: number
    confirmed: number
    pending: number
    unmatched: number
    removed: number
    former: number
    gadget: number
  }
  participants: Participant[]
  removed: { userId: string; name: string; at: number }[]
  /** Who withdrew or was removed and is not active now, newest first. */
  formerParticipants: FormerParticipant[]
  history: {
    id: string
    actor: string
    kind: string
    reason: string
    at: number
    changes: { userId: string; name: string; field: string; before: string | null; after: string | null }[]
  }[]
}
interface FormerParticipant {
  userId: string
  name: string
  email: string | null
  reason: "withdrawn" | "unconfirmed" | "admin"
  at: number
  /** Null when the letter was not kept (removals made before the archive existed). */
  entry: SecretSantaEntry | null
}
/** `onSaved` runs in the same update as the new data, so a closing form never sees itself vanish. */
type Save = (
  path: string,
  body: object,
  method?: "POST" | "PATCH" | "DELETE",
  onSaved?: () => void,
) => Promise<void>

const STATUS_ID = "santa-admin-status"
const letterButtonId = (userId: string) => `santa-letter-button-${userId}`
const readmitButtonId = (userId: string) => `santa-readmit-button-${userId}`

const leaveReasons: Record<FormerParticipant["reason"], string> = {
  withdrawn: "Si è ritirato",
  unconfirmed: "Non ha confermato",
  admin: "Rimosso dagli organizzatori",
}
const entryFieldLabels: Record<string, string> = {
  likes: "Cose che ama",
  dislikes: "Meglio di no",
  gadget: "Adesione gadget",
}

/** The server message, plus which letter fields are wrong when it rejects a letter. */
function errorMessage(e: unknown) {
  if (!(e instanceof Error)) return String(e)
  if (e instanceof ApiError && Array.isArray(e.details)) {
    const issues = (e.details as { path?: unknown[]; message?: string }[])
      .map((issue) => {
        const field = issue.path?.find((part) => typeof part === "string" && part in entryFieldLabels)
        return [typeof field === "string" ? entryFieldLabels[field] : null, issue.message]
          .filter(Boolean)
          .join(": ")
      })
      .filter(Boolean)
    if (issues.length) return `${e.message}. ${issues.join("; ")}.`
  }
  return e.message
}

export function SecretSantaAdmin({ activityId, config }: { activityId: string; config: SecretSantaConfig }) {
  const view = useApi<AdminView>(`/api/admin/secret-santa/${activityId}`)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const [selected, setSelected] = useState<string | null>(null)
  const [editingCycle, setEditingCycle] = useState(false)
  const [editingEntry, setEditingEntry] = useState<{ userId: string; name: string } | null>(null)
  const [readmitting, setReadmitting] = useState<{ userId: string; name: string } | null>(null)
  /** Outcome of the last letter correction or readmission, announced and focused when its form closes. */
  const [notice, setNotice] = useState<string | null>(null)
  /** Element to focus once a form has closed: its trigger, or the notice when the trigger is gone. */
  const focusAfterClose = useRef<string | null>(null)
  const cached = useRef<AdminView | null>(null)
  if (view.data) cached.current = view.data
  useEventStream(`/api/admin/events?activity=${encodeURIComponent(activityId)}`, {
    results: () => view.reload(),
  })
  const latest = cached.current
  // Someone else changed the data under an open form (another organizer, the person themselves):
  // close it and say why instead of letting it disappear silently.
  useEffect(() => {
    if (!latest) return
    if (readmitting && !latest.formerParticipants.some((p) => p.userId === readmitting.userId)) {
      setReadmitting(null)
      setNotice(
        latest.participants.some((p) => p.userId === readmitting.userId)
          ? `${readmitting.name} risulta già tra i partecipanti attivi. La riammissione non è stata salvata.`
          : `${readmitting.name} non è più tra i rimossi e ritirati. La riammissione non è stata salvata.`,
      )
      focusAfterClose.current = STATUS_ID
    }
    if (editingEntry && !latest.participants.some((p) => p.userId === editingEntry.userId)) {
      setEditingEntry(null)
      setNotice(
        `${editingEntry.name} non partecipa più a questo giro. La correzione della letterina non è stata salvata.`,
      )
      focusAfterClose.current = STATUS_ID
    }
    if (selected !== null && !latest.participants.some((p) => p.userId === selected)) {
      setSelected(null)
      setNotice("La persona selezionata non partecipa più a questo giro.")
      focusAfterClose.current = STATUS_ID
    }
  }, [latest, readmitting, editingEntry, selected])
  useEffect(() => {
    if (!focusAfterClose.current || editingEntry || readmitting) return
    const target = document.getElementById(focusAfterClose.current) ?? document.getElementById(STATUS_ID)
    focusAfterClose.current = null
    target?.focus()
  })
  const save: Save = async (path, body, method = "PATCH", onSaved) => {
    const next = await api<AdminView>(`/api/admin/secret-santa/${activityId}${path}`, { method, body })
    onSaved?.()
    view.setData(next)
    setError(null)
  }
  const closeLetter = (person: { userId: string; name: string }, saved: boolean) => {
    setEditingEntry(null)
    if (saved) setNotice(`Letterina di ${person.name} aggiornata.`)
    focusAfterClose.current = letterButtonId(person.userId)
  }
  const closeReadmit = (person: { userId: string; name: string }, saved: boolean) => {
    setReadmitting(null)
    if (saved) setNotice(`${person.name} è di nuovo tra i partecipanti.`)
    // After a readmission the person leaves this list, so their button is gone.
    focusAfterClose.current = saved ? STATUS_ID : readmitButtonId(person.userId)
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
  const letterPerson = data.participants.find((p) => p.userId === editingEntry?.userId)
  const readmitPerson = data.formerParticipants.find((p) => p.userId === readmitting?.userId)
  /** One correction at a time: every other action waits until the open form is closed. */
  const editorOpen =
    editingCycle || selected !== null || letterPerson !== undefined || readmitPerson !== undefined
  /** A 409 means someone else changed the data: fetch it so the form can show the conflict. */
  const onConflict = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) view.reload()
  }
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
          disabled={busy || data.drawnAt !== null || data.participants.length < 2 || editorOpen}
          onClick={() =>
            void control(
              "/draw",
              `Estrarre i regali per ${data.participants.length} persone? Le iscrizioni si chiudono e ${
                config.revealAt && Date.parse(config.revealAt) > Date.now()
                  ? `le email partiranno il ${new Date(config.revealAt).toLocaleString("it-IT")}: fino ad allora potrai controllare e modificare gli abbinamenti.`
                  : "partiranno subito le email."
              }`,
            )
          }
        >
          {data.drawnAt !== null ? "Estrazione effettuata" : "Estrai i regali"}
        </Button>
        {data.drawnAt !== null && (
          <Button
            variant="danger"
            disabled={busy || editorOpen}
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
        {data.held && (
          <Button
            variant="primary"
            disabled={busy || editorOpen}
            onClick={() =>
              void control(
                "/release",
                "Inviare adesso le email dell'estrazione? Ognuno vedrà a chi fa il regalo e da lì ogni modifica manderà una mail di aggiornamento.",
              )
            }
          >
            Invia le email ora
          </Button>
        )}
        {data.drawnAt !== null && data.participants.length >= 3 && (
          <Button disabled={busy || editorOpen} onClick={() => setEditingCycle(true)}>
            Modifica abbinamenti
          </Button>
        )}
        <Button variant="ghost" onClick={view.reload}>
          Aggiorna dati
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {data.drawnAt !== null
          ? data.held
            ? `Estratto il ${new Date(data.drawnAt).toLocaleString("it-IT")}. Bozza visibile solo agli admin: puoi modificare gli abbinamenti senza che parta nessuna email.${config.revealAt ? ` Email e risultato ai partecipanti il ${new Date(config.revealAt).toLocaleString("it-IT")}.` : ""}`
            : `Estratto il ${new Date(data.drawnAt).toLocaleString("it-IT")}. Email estrazione inviate: ${data.emailsSent}/${data.participants.length}.`
          : config.drawAt
            ? `Estrazione automatica: ${new Date(config.drawAt).toLocaleString("it-IT")}.${config.revealAt ? ` Invio email: ${new Date(config.revealAt).toLocaleString("it-IT")}.` : ""}`
            : "Nessuna estrazione automatica configurata."}
        {data.withoutEmail > 0 && ` ${data.withoutEmail} persone senza email.`}
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      <p
        id={STATUS_ID}
        role="status"
        tabIndex={-1}
        className={notice ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" : "sr-only"}
      >
        {notice}
      </p>
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
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11"
                      disabled={editorOpen && selected !== p.userId}
                      aria-label={`Gestisci ${p.name}`}
                      onClick={() => setSelected(p.userId)}
                    >
                      Gestisci
                    </Button>
                    <Button
                      id={letterButtonId(p.userId)}
                      className="min-h-11"
                      disabled={editorOpen && editingEntry?.userId !== p.userId}
                      aria-label={`Modifica letterina di ${p.name}`}
                      onClick={() => {
                        setNotice(null)
                        setEditingEntry({ userId: p.userId, name: p.name })
                      }}
                    >
                      Modifica letterina
                    </Button>
                  </div>
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
      {letterPerson && (
        <EntryEditor
          key={letterPerson.userId}
          participant={letterPerson}
          initialRevision={data.revision}
          currentRevision={data.revision}
          drawn={data.drawnAt !== null}
          config={config}
          save={save}
          onConflict={onConflict}
          onClose={(saved) => closeLetter(letterPerson, saved)}
        />
      )}
      {data.formerParticipants.length > 0 && (
        <section aria-labelledby="santa-former-title">
          <h3 id="santa-former-title" className="font-medium">
            Rimossi e ritirati ({data.counters.former})
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Chi si è ritirato o è stato rimosso può essere riammesso. L'intervento resta nello storico.
          </p>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.formerParticipants.map((p) => (
              <li key={p.userId} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {leaveReasons[p.reason]} · {new Date(p.at).toLocaleString("it-IT")}
                    </p>
                  </div>
                  {readmitPerson?.userId !== p.userId && (
                    <Button
                      id={readmitButtonId(p.userId)}
                      className="min-h-11"
                      disabled={busy || editorOpen}
                      aria-label={`Riammetti ${p.name}`}
                      onClick={() => {
                        setNotice(null)
                        setReadmitting({ userId: p.userId, name: p.name })
                      }}
                    >
                      Riammetti
                    </Button>
                  )}
                </div>
                {readmitPerson?.userId === p.userId && (
                  <ReadmitEditor
                    key={p.userId}
                    person={readmitPerson}
                    view={data}
                    config={config}
                    save={save}
                    onConflict={onConflict}
                    onClose={(saved) => closeReadmit(readmitPerson, saved)}
                  />
                )}
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
          {snapshot.held
            ? "Le email non sono ancora partite: nessuno riceve aggiornamenti, ognuno avrà direttamente il destinatario corretto."
            : "Le conferme dei regali restano valide. Le persone coinvolte ricevono una mail di aggiornamento."}
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

/** Moves keyboard focus to a form's heading when it opens, so it is announced and reachable. */
function useFocusOnOpen() {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return heading
}

function LetterFields({
  value,
  onChange,
  disabled,
  config,
}: {
  value: SecretSantaEntry
  onChange: (entry: SecretSantaEntry) => void
  disabled: boolean
  config: SecretSantaConfig
}) {
  return (
    <>
      <Field label="Cose che ama">
        <Textarea
          className="text-base"
          required
          maxLength={600}
          disabled={disabled}
          value={value.likes}
          onChange={(e) => onChange({ ...value, likes: e.target.value })}
        />
      </Field>
      <Field label="Meglio di no (facoltativo)">
        <Textarea
          className="text-base"
          maxLength={400}
          disabled={disabled}
          value={value.dislikes}
          onChange={(e) => onChange({ ...value, dislikes: e.target.value })}
        />
      </Field>
      {/* Like the participant form: no gadget sign-up when this round has no gadget. */}
      {config.gadget.enabled && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={value.gadget}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, gadget: e.target.checked })}
            className="size-5"
          />
          Partecipa all'estrazione del gadget
        </label>
      )}
    </>
  )
}

const sameEntry = (a: SecretSantaEntry, b: SecretSantaEntry) =>
  a.likes.trim() === b.likes.trim() && a.dislikes.trim() === b.dislikes.trim() && a.gadget === b.gadget

function EntryEditor({
  participant,
  initialRevision,
  currentRevision,
  drawn,
  config,
  save,
  onConflict,
  onClose,
}: {
  participant: Participant
  initialRevision: string
  currentRevision: string
  drawn: boolean
  config: SecretSantaConfig
  save: Save
  onConflict: (e: unknown) => void
  onClose: (saved: boolean) => void
}) {
  /** The stored letter and revision the draft is based on; moved forward only by the organizer. */
  const [base, setBase] = useState({ entry: participant.entry, revision: initialRevision })
  const [entry, setEntry] = useState<SecretSantaEntry>(participant.entry)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const heading = useFocusOnOpen()
  const unchanged = sameEntry(entry, base.entry)
  const stale = base.revision !== currentRevision
  /** The letter itself changed meanwhile, not just someone else's state. */
  const letterChanged = stale && !sameEntry(participant.entry, base.entry)
  const rebase = (reload: boolean) => {
    if (reload) setEntry(participant.entry)
    setBase({ entry: participant.entry, revision: currentRevision })
    setError(null)
  }
  const submit = async () => {
    if (saving || stale || unchanged || !reason.trim() || !entry.likes.trim()) return
    setSaving(true)
    try {
      await save(
        `/participants/${encodeURIComponent(participant.userId)}/entry`,
        { revision: base.revision, reason, entry },
        "PATCH",
        () => onClose(true),
      )
    } catch (e) {
      setError(errorMessage(e))
      onConflict(e)
    } finally {
      setSaving(false)
    }
  }
  return (
    <form
      aria-labelledby={`santa-letter-${participant.userId}`}
      className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h3 id={`santa-letter-${participant.userId}`} ref={heading} tabIndex={-1} className="font-semibold">
        Modifica la letterina di {participant.name}
      </h3>
      <p className="text-sm text-slate-600">
        {drawn
          ? "Chi le fa il regalo vedrà la letterina aggiornata con la data della correzione. Non parte nessuna email."
          : "Chi le farà il regalo leggerà la letterina corretta dopo l'estrazione. Non parte nessuna email."}
      </p>
      <LetterFields value={entry} onChange={setEntry} disabled={saving} config={config} />
      <Field label="Motivo della correzione">
        <Textarea
          className="text-base"
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div role="status" className="space-y-2 text-sm text-amber-800">
        {stale && letterChanged && (
          <>
            <p>
              Nel frattempo la letterina di {participant.name} è stata modificata. Carica la versione salvata
              (perdi le tue modifiche) oppure tieni le tue e salvale al suo posto.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" onClick={() => rebase(true)}>
                Carica la letterina salvata
              </Button>
              <Button className="min-h-11" onClick={() => rebase(false)}>
                Tieni le mie modifiche
              </Button>
            </div>
          </>
        )}
        {stale && !letterChanged && (
          <>
            <p>
              La situazione è cambiata mentre scrivevi, ma la letterina di {participant.name} è la stessa. Le
              tue modifiche restano.
            </p>
            <Button className="min-h-11" onClick={() => rebase(false)}>
              Usa i dati aggiornati
            </Button>
          </>
        )}
      </div>
      {unchanged && <p className="text-xs text-slate-500">Modifica almeno un campo per salvare.</p>}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          className="min-h-11"
          disabled={saving || stale || unchanged || !reason.trim() || !entry.likes.trim()}
        >
          {saving ? "Salvataggio…" : "Salva la letterina"}
        </Button>
        <Button className="min-h-11" disabled={saving} onClick={() => onClose(false)}>
          Chiudi senza salvare
        </Button>
      </div>
    </form>
  )
}

function ReadmitEditor({
  person,
  view,
  config,
  save,
  onConflict,
  onClose,
}: {
  person: FormerParticipant
  view: AdminView
  config: SecretSantaConfig
  save: Save
  onConflict: (e: unknown) => void
  onClose: (saved: boolean) => void
}) {
  const [revision, setRevision] = useState(view.revision)
  const [entry, setEntry] = useState<SecretSantaEntry>(
    () => person.entry ?? { likes: "", dislikes: "", gadget: config.gadget.enabled },
  )
  const [giverId, setGiverId] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const heading = useFocusOnOpen()
  const drawn = view.drawnAt !== null
  const active = view.participants
  const needsGiver = drawn && active.length > 0
  const closesAt = confirmationClosesAt(config.confirmationDueAt)
  const deadlinePassed = needsGiver && closesAt !== null && Date.now() >= closesAt
  const giver = active.find((p) => p.userId === giverId)
  const stale = revision !== view.revision
  const ready =
    !saving &&
    !stale &&
    Boolean(reason.trim()) &&
    Boolean(entry.likes.trim()) &&
    (!needsGiver || giver !== undefined) &&
    (!deadlinePassed || confirmed)
  const ids = `santa-readmit-${person.userId}`
  const submit = async () => {
    if (!ready) return
    setSaving(true)
    try {
      await save(
        `/participants/${encodeURIComponent(person.userId)}/readmit`,
        {
          revision,
          reason,
          entry,
          giverId: needsGiver ? giverId : null,
          confirmed: deadlinePassed && confirmed,
        },
        "POST",
        () => onClose(true),
      )
    } catch (e) {
      setError(errorMessage(e))
      onConflict(e)
    } finally {
      setSaving(false)
    }
  }
  return (
    <form
      aria-labelledby={`${ids}-title`}
      className="mt-3 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h4 id={`${ids}-title`} ref={heading} tabIndex={-1} className="font-semibold">
        Riammetti {person.name}
      </h4>
      <p className="break-all text-sm text-slate-500">{person.email ?? "Email assente"}</p>
      {person.entry === null && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          La letterina di questa persona non è stata conservata: scrivila insieme a lei prima di riammetterla.
        </p>
      )}
      <LetterFields value={entry} onChange={setEntry} disabled={saving} config={config} />
      {!drawn ? (
        <p className="text-sm text-slate-600">
          L'estrazione non è ancora stata fatta: la persona torna tra gli iscritti e partecipa al sorteggio,
          anche se le iscrizioni sono chiuse.
        </p>
      ) : !needsGiver ? (
        <p className="text-sm text-slate-600">
          Non ci sono partecipanti attivi: la persona rientra senza nessuno a cui fare il regalo.
        </p>
      ) : (
        <>
          <Field
            label="Chi le farà il regalo"
            hint="Solo questa persona cambia destinatario; tutti gli altri abbinamenti restano uguali."
          >
            <select
              required
              disabled={saving}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-blue-500"
              value={giverId}
              onChange={(e) => setGiverId(e.target.value)}
            >
              <option value="">Scegli una persona</option>
              {active.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name} ({p.match ? `ora regala a ${p.match.name}` : "ora non regala a nessuno"})
                </option>
              ))}
            </select>
          </Field>
          {/* Always mounted, so screen readers announce the preview when a Santa is chosen. */}
          <p
            aria-live="polite"
            className={giver ? "rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200" : "sr-only"}
          >
            {giver && (
              <>
                <strong>{giver.name}</strong> regalerà a <strong>{person.name}</strong>,{" "}
                <strong>{person.name}</strong> regalerà a <strong>{giver.match?.name ?? giver.name}</strong>.
              </>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {giver && !giver.email
              ? `${giver.name} non ha un'email: avvisa di persona del cambio.`
              : "Se aveva già ricevuto l'email dell'estrazione, chi fa il regalo riceve una mail di aggiornamento."}{" "}
            {person.email
              ? `${person.name} riceve una mail per aprire la lettera dorata e scoprire a chi fare il regalo.`
              : `${person.name} non ha un'email: comunica di persona a chi fare il regalo.`}
          </p>
          {deadlinePassed && (
            <div className="space-y-1">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  disabled={saving}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  aria-describedby={`${ids}-deadline`}
                  className="size-5"
                />
                Ha già preso il regalo
              </label>
              <p id={`${ids}-deadline`} className="text-xs text-amber-800">
                La scadenza per confermare il regalo è passata: chi non ha confermato viene rimosso a
                mezzanotte. Riammetti questa persona solo se ha già preso il regalo.
                {giver && !giver.match && (
                  <>
                    {" "}
                    {giver.name} ora non regala a nessuno e con la riammissione riceve un destinatario: la
                    conferma vale anche per {giver.name}, quindi assicurati che abbia già preso il regalo.
                  </>
                )}
              </p>
            </div>
          )}
        </>
      )}
      <Field label="Motivo della riammissione">
        <Textarea
          className="text-base"
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div role="status" className="space-y-2 text-sm text-amber-800">
        {stale && (
          <>
            <p>
              La situazione è cambiata mentre compilavi il modulo. Controlla le scelte sui dati aggiornati,
              poi continua.
            </p>
            <Button
              className="min-h-11"
              onClick={() => {
                if (!view.participants.some((p) => p.userId === giverId)) setGiverId("")
                setRevision(view.revision)
                setError(null)
              }}
            >
              Usa i dati aggiornati
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" className="min-h-11" disabled={!ready}>
          {saving ? "Salvataggio…" : `Riammetti ${person.name}`}
        </Button>
        <Button className="min-h-11" disabled={saving} onClick={() => onClose(false)}>
          Chiudi senza salvare
        </Button>
      </div>
    </form>
  )
}
