import { z } from "zod"

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().default(8787),
    /** Origin users open in the browser. In dev that is the Vite server, which proxies to this one. */
    PUBLIC_URL: z.url().default("http://localhost:5173"),
    DATABASE_PATH: z.string().default("data/live-audience.db"),

    /** Issuer of the PoliNetwork IdP, e.g. https://auth.polinetwork.org/api/auth */
    OIDC_ISSUER: z.url().optional(),
    OIDC_CLIENT_ID: z.string().optional(),
    OIDC_CLIENT_SECRET: z.string().optional(),

    /** IdP role required to take part (anyone with Socio, including roles inheriting from it). */
    AUDIENCE_ROLE: z.string().default("socio"),
    /** IdP permission required to use the admin page. Grant it through a role in the IdP. */
    ADMIN_PERMISSION: z.string().default("live-audience:admin"),
    SESSION_DAYS: z.coerce.number().positive().default(7),

    /** Local only: enables /auth/dev-login, which signs in as a fake user without the IdP. */
    DEV_LOGIN: z.stringbool().default(false),
  })
  .refine((env) => !env.DEV_LOGIN || (env.NODE_ENV !== "production" && isLocalhost(env.PUBLIC_URL)), {
    message: "DEV_LOGIN is only allowed outside production, on a localhost PUBLIC_URL",
    path: ["DEV_LOGIN"],
  })
  .refine((env) => env.DEV_LOGIN || (env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET), {
    message: "Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET (or DEV_LOGIN=1 for local development)",
    path: ["OIDC_ISSUER"],
  })

function isLocalhost(url: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
}

export type Env = z.infer<typeof schema>

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    console.error(`Invalid environment:\n${z.prettifyError(parsed.error)}`)
    process.exit(1)
  }
  return parsed.data
}
