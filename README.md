# PoliNetwork Live

Live audience interaction (polls, word clouds, a prize wheel, a number lottery and memory quizzes) for PoliNetwork presentations.

- **Audience page** (`/`): Soci sign in with the PoliNetwork IdP and see whatever is "on stage", usually nothing. When the presenter opens an activity it appears there, live.
- **Admin page** (`/admin`): create and edit activities, put them on stage by hand, preview results, manage the API key. Reserved to an IdP permission.
- **Presentation API** (`/api/v1`): one global API key lets an HTML presentation open/close activities as slides change and read live results to draw its own charts.

There is exactly one stage, so exactly one presentation at a time: no join codes, no QR codes. Signing in is the ticket.

## Stack

One Node 24 process, no build step for the server:

- [Hono](https://hono.dev) HTTP server, run as TypeScript by Node's type stripping (`src/server`)
- React 19 + Vite + Tailwind 4 single-page app (`src/client`)
- SQLite through Node's built-in `node:sqlite` (one file, no native deps, no ORM)
- Server-Sent Events for live updates
- [`openid-client`](https://github.com/panva/openid-client) for login (confidential client, authorization code + PKCE)

## Development

```sh
pnpm install
cp .env.example .env   # DEV_LOGIN=1: fake sign-in, no IdP needed
pnpm dev               # http://localhost:5173 (Vite) → proxies /api and /auth to :8787
```

With `DEV_LOGIN=1`, "Sign in" leads to `/auth/dev-login`, which offers Ada Admin, Sara Socia and Nico Newcomer (not a Socio). Add `&n=2` to the link to be a different person (e.g. `/auth/dev-login?as=socio&n=2`), handy for voting from several tabs or with curl. `DEV_LOGIN` is refused in production and on non-localhost URLs.

Then try `examples/demo-presentation.html?url=http://localhost:5173&key=<API key>` (the key is under Admin → API), with a poll whose slug is `dinner-poll`.

```sh
pnpm test        # Vitest
pnpm typecheck
pnpm check       # Biome (pnpm check:fix to fix)
```

## Setting up the IdP

The app is a regular OIDC client of `auth.polinetwork.org`.

1. **Register the application** at `<IdP>/applications/new`:
   - application type **web**, redirect URI `https://<host>/auth/callback`, post-logout redirect URI `https://<host>/`
   - credential **client secret** (`client_secret_basic`)
   - scopes `openid profile polinetwork:identity`
   - optionally enable end-session (logout also signs out of the IdP) and skip consent (first-party app)

   For local development against a local IdP (`http://localhost:3000`), register a separate **native** app with redirect URI `http://localhost:5173/auth/callback`: the IdP refuses localhost redirects for web apps.
2. **Admin permission**: at `<IdP>/access`, create the permission `live-audience:admin` and attach it to the role(s) that should run presentations (or set `ADMIN_PERMISSION` to an existing one).
3. **Audience**: by default anyone with the `socio` role may take part, which also includes custom roles inheriting from Socio. Change it with `AUDIENCE_ROLE`. Admins can always take part.

Roles and permissions are read from the ID token (`polinetwork_roles`, `polinetwork_permissions`) at sign-in and kept for the session (`SESSION_DAYS`, default 7). Someone who stops being a Socio keeps access until their session ends; signing out and in again refreshes it.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:5173` | Origin users open. Builds the OIDC redirect URI. |
| `PORT` | `8787` | |
| `DATABASE_PATH` | `data/live-audience.db` | `/data/live-audience.db` in Docker |
| `OIDC_ISSUER` | | `https://auth.polinetwork.org/api/auth` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | | From the IdP registration |
| `AUDIENCE_ROLE` | `socio` | IdP role needed to take part |
| `ADMIN_PERMISSION` | `live-audience:admin` | IdP permission needed for `/admin` |
| `SESSION_DAYS` | `7` | |
| `DEV_LOGIN` | `false` | Local fake sign-in |

## Deployment

Every push to `main` publishes `ghcr.io/polinetworkorg/live-audience:latest` (amd64 and arm64).

```sh
docker run -p 8787:8787 -v live-audience-data:/data \
  -e PUBLIC_URL=https://live.polinetwork.org \
  -e OIDC_ISSUER=https://auth.polinetwork.org/api/auth \
  -e OIDC_CLIENT_ID=... -e OIDC_CLIENT_SECRET=... \
  ghcr.io/polinetworkorg/live-audience:latest
```

- Run **one replica**: state is a SQLite file and live updates go through an in-process event bus. A single small container easily handles a room full of people.
- Persist `/data`. Back it up if you care about old answers.
- Server-Sent Events go through Cloudflare and Traefik as is; the server pings every 20 s so idle connections stay open.
- `GET /healthz` returns `ok`.

## Presentation API

Admin → API shows the key, a ready-to-paste snippet and the endpoint list. The short version:

```html
<script type="module">
  import { LiveAudience } from "https://live.polinetwork.org/live-audience.js"
  const live = new LiveAudience({ url: "https://live.polinetwork.org", key: "la_..." })

  await live.open("dinner-poll")   // on stage, answers open (replaces what was on stage)
  await live.show("dinner-poll")   // on stage, answers closed
  await live.close()               // close answers on what is on stage
  await live.reopen()              // reopen them
  await live.clear()               // idle screen
  await live.results("dinner-poll")
  await live.reset("dinner-poll")  // delete all answers
  const stop = live.onResults("dinner-poll", ({ results }) => draw(results))  // live
  live.onStage((stage) => console.log(stage))
</script>
```

Slide integration without code: put `data-live="<slug>"` on a slide (plus `data-live-status="closed"` to show it closed, or `data-live="clear"` for the idle screen) and call `live.applySlide(currentSlideElement)` on every slide change. See `examples/demo-presentation.html`.

Plain HTTP: `Authorization: Bearer <key>` (or `?key=`, which `EventSource` needs). CORS is open to every origin, `file://` included.

| | |
| --- | --- |
| `GET /api/v1/stage` | `{ status: "open" \| "closed", activity: { id, slug, type, title } \| null }` |
| `POST /api/v1/stage` | `{ "activity": "<slug>", "status": "open" \| "closed" }`, status defaults to open |
| `POST /api/v1/stage/open` · `/close` · `/clear` | |
| `GET /api/v1/activities` | Every activity with its config |
| `GET /api/v1/activities/:slug/results` | `{ id, slug, type, title, results }` |
| `POST /api/v1/activities/:slug/reset` | Delete all answers |
| `POST /api/v1/activities/:slug/draw` | Draw a lottery, reveal a real number or a quiz; outcome and winner persist |
| `GET /api/v1/events[?activity=<slug>]` | SSE: `stage` events, and `results` for what is on stage (or for that activity) |

Poll results look like `{ question, totalVoters, options: [{ id, label, votes, percent }] }`. Results never include who answered.

Word clouds accept free words or short phrases, one per line. In Admin, create a **Word cloud**,
set its prompt and the maximum entries per person (1–10, default 3), then put it on stage.
Each entry can contain up to 60 characters. Case, Unicode and whitespace variants are merged;
phrases stay together and repeated entries count once per person. A new answer replaces that
person's previous entries, until answers close.

The admin's live preview shows a cloud with larger text for more frequent entries. Presentation
results are `{ prompt, totalRespondents, words: [{ text, count }] }`, sorted by frequency, without
respondent identities. The existing stage, results, reset and SSE endpoints work for this type too.

For a standalone presentation example, create a word cloud with slug `gadget-ideas` and open
`examples/demo-word-cloud.html?url=http://localhost:5173&key=<API key>&activity=gadget-ideas`.
The example receives the live cloud and lets the presenter open or close answers.

The key is the only protection of this API: keep it out of public repositories and regenerate it (Admin → API) if it leaks. Old keys stop working immediately.

## Adding an activity type

**Purchase interest** (`type: "purchase-interest"`) asks `{ question }` with yes/no responses:
`{ buy: false }`, or `{ buy: true, price: number }`, requiring a non-negative whole euro price
for yes. No responses discard any attached price. Each person's latest response replaces the
previous one until closure. Results are `{ question, totalRespondents, yes, no, noPercent, bands }`;
each band contains `{ min, max, label, count, percent }`. Prices use €10 bands: 0–10 inclusive,
11–20, 21–30, etc. Only populated price bands are returned, sorted ascending; no responses
form a single separate bar. Percentages use all respondents, and results include no identities.

**Guess the real number** (`type: "number-estimate"`) asks for a submitted display name
and integer from 0 to 1,000,000. Config is `{ prompt, target }`; participants receive only
`{ prompt }`. The draw endpoint reveals the configured real figure, selects the nearest
guess and randomly chooses one winner among ties. Results contain
`{ prompt, totalParticipants, draw }`, where draw is
`{ number, distance, tied, winner: { name, number } | null, drawnAt }`.
Other guesses and account identities never leave the API. Empty rounds can reveal the
figure without a winner. Reset is required to reopen or change the target after guesses.

**Memory quiz** (`type: "memory-quiz"`) accepts a free-text `{ name, answer }` response.
Config is `{ question, acceptedAnswers: string[] }`; participants receive only `{ question }`.
Optional `answerMode: "choice" | "order"` and `choices: string[]` add multiple choice
and ordering (2–4 choices or 2–6 distinct ordered items). Choices are public; acceptedAnswers stay private.
Order answers join every item exactly once with ` → `. The audience can move items up
and down with keyboard accessible buttons. Legacy free-text config remains unchanged.
The first correct response received by the server wins and closes the quiz immediately.
Case, Unicode/whitespace variants and trailing `. ! ?` are ignored; guessing several possible
answers in one string does not match. Wrong answers can be updated while the quiz is open.

Results are `{ question, totalParticipants, draw }`, where `draw` is null until a winner or
manual reveal, then `{ answer, winner: { name, answer } | null, drawnAt }`. Only the winner's
submitted display name/answer is exported, not other answers or account identities.
The answer, winner, winning submission and closure are committed together. Reopening requires
reset; retries and reloads cannot replace the first winner. `POST /activities/:slug/draw`
manually closes and reveals an unanswered quiz without inventing a winner.

**Number lottery** (`type: "number-lottery"`) accepts `{ name, number }`, with one integer
from 0 to 100 per signed-in participant and config `{ prompt }`. Participants can update
their guess until extraction. `POST /api/v1/activities/:slug/draw` (also available under
`/api/admin`) closes guesses and draws an inclusive 0–100 number on the server. Closest
absolute distance wins; ties always select one winner randomly among the closest entries.
This rule is announced on the participant page and the presentation.

Results contain `{ prompt, totalParticipants, entries: [{ name, number }], draw }`; `draw`
is null until extraction, then `{ number, distance, closest, winners, drawnAt }` with one
winner. Only submitted display names/guesses are exposed, not account identifiers.
The outcome persists in SQLite and through SSE; retries and refreshes cannot reroll it.
Reset deletes the answers and the outcome, allowing a new round. Reopening after a draw
is rejected until reset. `LiveAudience.draw(slug)` wraps the draw endpoint.

**Wheel of fortune** (`type: "wheel"`) collects one display name per signed-in participant.
Its config is `{ prompt }`, its response is `{ name }` (1–80 characters after whitespace
normalization), and its results are `{ prompt, totalParticipants, names: string[] }`.
The names are explicitly submitted for display on the presentation; account IDs and account
names are not exported. Two people with the same display name retain two separate chances.
Use the existing audience response, stage, reset and results/SSE endpoints. Close entries
before reading the final names and spinning, so late entries cannot change the draw.
The slide draws the winner; the API does not persist winners or remove them automatically.

Each type lives in `src/activities/<type>/` and has two halves:

1. **`definition.ts`**: data and pure functions, used by the server and the browser.

   ```ts
   export const wordCloud = defineActivity<Config, Response, Results>({
     type: "word-cloud",            // stored in the DB: never rename
     label: "Word cloud",
     description: "Everyone sends up to three words.",
     configSchema,                  // zod: what the admin saves
     defaultConfig: () => ({ prompt: "", maxWords: 3 }),
     responseSchema: (config) => …, // zod: one person's answer, checked against the config
     aggregate: (config, responses) => …, // results for presentations; avoid personal data
     audienceConfig: (config) => …, // optional: hide parts of the config from the audience
   })
   ```

2. **`ui.tsx`**: React components.

   ```tsx
   export const wordCloudUI = defineActivityUI({
     definition: wordCloud,
     Editor,    // ({ config, onChange }) for the admin page
     Audience,  // ({ config, response, open, submit }) for phones
     Results,   // optional preview on the admin page (JSON otherwise)
   })
   ```

3. Register them in `src/activities/registry.ts` and `src/activities/ui-registry.ts`.

Storage, validation, one-answer-per-person, stage control, the API and live updates come for free. `src/activities/poll/` is the reference implementation.
