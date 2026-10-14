import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { serve } from "@hono/node-server"
import { createServer } from "vite"
import { expect, it } from "vitest"
import { createApp } from "../src/server/app.ts"
import { openDatabase } from "../src/server/db.ts"
import { Store } from "../src/server/store.ts"
import config from "../vite.config.ts"

it("lets HTML presentations preflight the API through the dev proxy", async () => {
  const db = openDatabase(":memory:")
  const app = createApp({ store: new Store(db), session: async (_c, next) => next() })
  const backend = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 })
  if (!backend.listening) await once(backend, "listening")
  const cacheDir = await mkdtemp(join(tmpdir(), "live-proxy-test-"))
  const vite = await createServer({
    ...config,
    configFile: false,
    plugins: [],
    cacheDir,
    server: {
      ...config.server,
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      ws: false,
      watch: null,
      proxy: { "/api": `http://127.0.0.1:${(backend.address() as AddressInfo).port}` },
    },
  })
  try {
    await vite.listen()
    if (!vite.httpServer) throw new Error("Vite did not create an HTTP server")
    const url = `http://127.0.0.1:${(vite.httpServer.address() as AddressInfo).port}`
    for (const origin of ["null", "https://slides.example.org"]) {
      const response = await fetch(`${url}/api/v1/activities`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      })
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization")
      // The actual API response still requires a key, and remains readable cross-origin.
      const unauthorized = await fetch(`${url}/api/v1/activities`, { headers: { Origin: origin } })
      expect(unauthorized.status).toBe(401)
      expect(unauthorized.headers.get("access-control-allow-origin")).toBe("*")
      // Do not open the Vite application's source files to arbitrary origins.
      const source = await fetch(`${url}/src/client/main.tsx`, { headers: { Origin: origin } })
      expect(source.headers.get("access-control-allow-origin")).toBeNull()
    }
  } finally {
    await vite.close()
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    )
    db.close()
    await rm(cacheDir, { recursive: true, force: true })
  }
})
