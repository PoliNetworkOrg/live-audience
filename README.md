# PoliNetwork Live

Live audience interaction (polls now, more types later) for PoliNetwork presentations.

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

```sh
docker build -t live-audience .
docker run -p 8787:8787 -v live-audience-data:/data \
  -e PUBLIC_URL=https://live.polinetwork.org \
  -e OIDC_ISSUER=https://auth.polinetwork.org/api/auth \
  -e OIDC_CLIENT_ID=... -e OIDC_CLIENT_SECRET=... \
  live-audience
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
| `GET /api/v1/events[?activity=<slug>]` | SSE: `stage` events, and `results` for what is on stage (or for that activity) |

Poll results look like `{ question, totalVoters, options: [{ id, label, votes, percent }] }`. Results never include who answered.

The key is the only protection of this API: keep it out of public repositories and regenerate it (Admin → API) if it leaks. Old keys stop working immediately.

## Adding an activity type

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
