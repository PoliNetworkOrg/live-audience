import { useState } from "react"
import { api, useApi } from "../api.ts"
import { Icon } from "../icons.tsx"
import { Button, Card } from "../ui.tsx"
import { PageHeader } from "./AdminLayout.tsx"

export function ApiPage() {
  const key = useApi<{ apiKey: string }>("/api/admin/api-key")
  const [revealed, setRevealed] = useState(false)
  const origin = window.location.origin
  const apiKey = key.data?.apiKey ?? ""

  const regenerate = async () => {
    if (!confirm("Every presentation using the current key will stop working. Continue?")) return
    key.setData(await api<{ apiKey: string }>("/api/admin/api-key", { method: "POST" }))
    setRevealed(true)
  }

  const snippet = `<script type="module">
  import { LiveAudience } from "${origin}/live-audience.js"
  const live = new LiveAudience({ url: "${origin}", key: "${revealed ? apiKey : "<API key>"}" })

  // Flow control, e.g. from your slide-change handler
  await live.open("dinner-poll")   // on stage, answers open
  await live.close()               // answers closed, still on stage
  await live.clear()               // idle screen

  // Or mark slides: <section data-live="dinner-poll"> / data-live-status="closed" / data-live="clear">
  // and call live.applySlide(currentSlide) on every slide change.

  // Live results for your own charts
  live.onResults("dinner-poll", ({ results }) => console.log(results))
</script>`

  return (
    <div className="space-y-10">
      <PageHeader kicker="Live admin" title="API" />
      <Card className="space-y-4">
        <h2 className="kicker">API key</h2>
        <p className="text-sm text-slate-600">
          One global key lets presentations control the stage and read results. Anyone with it can do the
          same, so do not publish it; regenerate it if it leaks.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <code className="rounded-xl border-[1.5px] border-white bg-white/75 px-3 py-1.5 font-mono text-sm break-all">
            {revealed ? apiKey : apiKey.replace(/./g, "•").slice(0, 32)}
          </code>
          <Button onClick={() => setRevealed((r) => !r)}>{revealed ? "Hide" : "Reveal"}</Button>
          <Button onClick={() => void navigator.clipboard.writeText(apiKey)}>Copy</Button>
          <Button variant="danger" onClick={() => void regenerate()}>
            <Icon name="rotate-ccw" /> Regenerate
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="kicker">Quick start (JavaScript client)</h2>
        <pre className="overflow-auto rounded-2xl bg-slate-900 p-5 text-xs leading-relaxed text-slate-100 shadow-[0_20px_40px_-24px_rgb(17_86_174/0.6)]">
          {snippet}
        </pre>
      </Card>

      <Card className="space-y-4">
        <h2 className="kicker">HTTP reference</h2>
        <p className="text-sm text-slate-600">
          Send <code>Authorization: Bearer &lt;key&gt;</code> (or <code>?key=</code>, needed for EventSource).
          Activities are addressed by slug or id. CORS is open to every origin.
        </p>
        <table className="w-full text-left text-sm">
          <tbody className="divide-y-[1.5px] divide-white text-slate-700 [&_td]:py-2.5 [&_td:first-child]:pr-4 [&_td:first-child]:font-mono [&_td:first-child]:text-xs [&_td:first-child]:whitespace-nowrap [&_td:first-child]:text-pn">
            <tr>
              <td>GET /api/v1/stage</td>
              <td>What is on stage: {"{ status, activity, presentation }"}</td>
            </tr>
            <tr>
              <td>POST /api/v1/stage</td>
              <td>
                Body <code>{'{ "activity": "<slug>", "status": "open" | "closed" }'}</code>; status defaults
                to open
              </td>
            </tr>
            <tr>
              <td>POST /api/v1/stage/open</td>
              <td>Open answers on what is on stage</td>
            </tr>
            <tr>
              <td>POST /api/v1/stage/close</td>
              <td>Close answers on what is on stage</td>
            </tr>
            <tr>
              <td>POST /api/v1/stage/clear</td>
              <td>Nothing on stage (idle screen)</td>
            </tr>
            <tr>
              <td>POST /api/v1/stage/presentation</td>
              <td>
                Body <code>{'{ "presentation": "<slug>" | null }'}</code>: start or end a presentation.
                Putting one of its activities on stage starts it too
              </td>
            </tr>
            <tr>
              <td>GET /api/v1/activities</td>
              <td>All activities with their config</td>
            </tr>
            <tr>
              <td>GET /api/v1/activities/:slug/results</td>
              <td>Aggregated results</td>
            </tr>
            <tr>
              <td>POST /api/v1/activities/:slug/reset</td>
              <td>Delete all answers</td>
            </tr>
            <tr>
              <td>POST /api/v1/activities/:slug/draw</td>
              <td>
                Draw a number lottery, reveal a real number or a memory quiz, and score it; repeats return the
                same saved outcome
              </td>
            </tr>
            <tr>
              <td>GET /api/v1/presentations</td>
              <td>All presentations</td>
            </tr>
            <tr>
              <td>GET /api/v1/presentations/:slug/leaderboard</td>
              <td>
                <code>{"{ id, slug, title, leaderboard: [{ rank, name, points }] }"}</code>, best first
              </td>
            </tr>
            <tr>
              <td>GET /api/v1/events</td>
              <td>
                Server-Sent Events: <code>stage</code> on every change, <code>results</code> for what is on
                stage (or for <code>?activity=&lt;slug&gt;</code> only), <code>leaderboard</code> for the
                running presentation
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  )
}
