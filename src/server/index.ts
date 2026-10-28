import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { createApp } from "./app.ts"
import { createAuth } from "./auth.ts"
import { openDatabase } from "./db.ts"
import { loadEnv } from "./env.ts"
import { Store } from "./store.ts"

const env = loadEnv()
const db = openDatabase(env.DATABASE_PATH)
const store = new Store(db)
const auth = createAuth(env, db, {
  guestAccessOpen: () => store.guestAccessOpen(),
  namesInPlay: () => store.namesInPlay(),
})

const server = new Hono()
server.route("/auth", auth.routes)
server.route("/", createApp({ store, session: auth.session }))

if (env.NODE_ENV === "production") {
  // The built client. Unknown paths fall back to index.html so client-side routes work.
  server.use("/*", serveStatic({ root: "dist/client" }))
  server.get("*", serveStatic({ path: "dist/client/index.html" }))
}

serve({ fetch: server.fetch, port: env.PORT }, ({ port }) => {
  console.log(`live-audience listening on http://localhost:${port} (public URL ${env.PUBLIC_URL})`)
})
