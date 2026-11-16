import { describe, expect, it } from "vitest"
import { loadEnv } from "../src/server/env.ts"

describe("mailer endpoint configuration", () => {
  it.each([
    "http://backend:3000/internal/secret-santa/emails",
    "http://192.168.1.20:3000/internal/secret-santa/emails",
    "http://localhost:3000/internal/secret-santa/emails",
    "https://backend.example/internal/secret-santa/emails",
  ])("accepts %s, including internal HTTP in production", (MAILER_URL) => {
    const env = loadEnv({
      NODE_ENV: "production",
      PUBLIC_URL: "https://live.example",
      OIDC_ISSUER: "https://auth.example",
      OIDC_CLIENT_ID: "live",
      OIDC_CLIENT_SECRET: "test-client-secret",
      MAILER_URL,
      MAILER_TOKEN: "test-mail-token-with-at-least-32-characters",
    })
    expect(env.MAILER_URL).toBe(MAILER_URL)
  })
})
