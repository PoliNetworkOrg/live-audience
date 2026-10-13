import { randomBytes } from "node:crypto"
import type { Context, MiddlewareHandler } from "hono"
import { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import * as oidc from "openid-client"
import type { Database } from "./db.ts"
import type { Env } from "./env.ts"

/**
 * Login through the PoliNetwork IdP as a confidential "backend for frontend" client:
 * authorization code + PKCE, tokens stay on the server, the browser only gets a session cookie.
 */

export interface SessionUser {
  id: string
  name: string
  picture?: string
  /** May answer activities (has the audience role, Socio by default). */
  canParticipate: boolean
  /** May use the admin page (has the admin permission). */
  isAdmin: boolean
}

export type AuthVariables = { user: SessionUser | null }

const SESSION_COOKIE = "la_session"
const FLOW_COOKIE = "la_oidc"
const SCOPES = "openid profile polinetwork:identity"

interface Session {
  user: SessionUser
  idToken: string | null
}

export function createAuth(env: Env, db: Database) {
  const secure = new URL(env.PUBLIC_URL).protocol === "https:"
  const redirectUri = new URL("/auth/callback", env.PUBLIC_URL).href
  const sessionMaxAge = Math.round(env.SESSION_DAYS * 24 * 60 * 60)

  let configPromise: Promise<oidc.Configuration> | undefined
  function getConfig() {
    if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
      throw new Error("OIDC is not configured")
    }
    const issuer = new URL(env.OIDC_ISSUER)
    configPromise ??= oidc
      .discovery(
        issuer,
        env.OIDC_CLIENT_ID,
        undefined,
        oidc.ClientSecretBasic(env.OIDC_CLIENT_SECRET),
        issuer.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((error) => {
        // Retry discovery on the next login instead of caching the failure forever.
        configPromise = undefined
        throw error
      })
    return configPromise
  }

  function userFromClaims(claims: oidc.IDToken | oidc.UserInfoResponse): SessionUser {
    const words = (value: unknown) => (typeof value === "string" ? value.split(" ").filter(Boolean) : [])
    const roles = words(claims.polinetwork_roles)
    const permissions = words(claims.polinetwork_permissions)
    return {
      id: claims.sub,
      name: typeof claims.name === "string" && claims.name ? claims.name : "Anonymous",
      picture: typeof claims.picture === "string" ? claims.picture : undefined,
      canParticipate: roles.includes(env.AUDIENCE_ROLE),
      isAdmin: permissions.includes(env.ADMIN_PERMISSION),
    }
  }

  // ---- sessions ----------------------------------------------------------------------------

  function createSession(c: Context, session: Session) {
    const id = randomBytes(32).toString("base64url")
    db.prepare("INSERT INTO sessions (id, user, id_token, expires_at) VALUES (?, ?, ?, ?)").run(
      id,
      JSON.stringify(session.user),
      session.idToken,
      Date.now() + sessionMaxAge * 1000,
    )
    setCookie(c, SESSION_COOKIE, id, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: sessionMaxAge,
    })
  }

  function readSession(c: Context): Session | null {
    const id = getCookie(c, SESSION_COOKIE)
    if (!id) return null
    const row = db.prepare("SELECT user, id_token, expires_at FROM sessions WHERE id = ?").get(id) as
      | { user: string; id_token: string | null; expires_at: number }
      | undefined
    if (!row || row.expires_at < Date.now()) return null
    return { user: JSON.parse(row.user), idToken: row.id_token }
  }

  function destroySession(c: Context) {
    const id = getCookie(c, SESSION_COOKIE)
    if (id) db.prepare("DELETE FROM sessions WHERE id = ? OR expires_at < ?").run(id, Date.now())
    deleteCookie(c, SESSION_COOKIE, { path: "/" })
  }

  /** Puts the signed-in user (or null) on `c.var.user` for every request. */
  const session: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
    c.set("user", readSession(c)?.user ?? null)
    await next()
  }

  // ---- routes ------------------------------------------------------------------------------

  const routes = new Hono()

  routes.get("/login", async (c) => {
    const returnTo = safeReturnTo(c.req.query("returnTo"))
    if (env.DEV_LOGIN && !env.OIDC_ISSUER)
      return c.redirect(`/auth/dev-login?returnTo=${encodeURIComponent(returnTo)}`)
    const config = await getConfig()
    const verifier = oidc.randomPKCECodeVerifier()
    const flow = { verifier, state: oidc.randomState(), nonce: oidc.randomNonce(), returnTo }
    setCookie(c, FLOW_COOKIE, Buffer.from(JSON.stringify(flow)).toString("base64url"), {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/auth",
      maxAge: 600,
    })
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state: flow.state,
      nonce: flow.nonce,
    })
    return c.redirect(url.href)
  })

  routes.get("/callback", async (c) => {
    const raw = getCookie(c, FLOW_COOKIE)
    deleteCookie(c, FLOW_COOKIE, { path: "/auth" })
    if (!raw) return c.redirect("/auth/login")
    const flow = JSON.parse(Buffer.from(raw, "base64url").toString()) as {
      verifier: string
      state: string
      nonce: string
      returnTo: string
    }
    // Behind a proxy the request URL is internal: rebuild what the IdP actually redirected to.
    const currentUrl = new URL(new URL(c.req.url).pathname + new URL(c.req.url).search, env.PUBLIC_URL)
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>
    try {
      tokens = await oidc.authorizationCodeGrant(await getConfig(), currentUrl, {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
      })
    } catch (error) {
      console.error("OIDC callback failed", error)
      return c.text("Sign-in failed. Go back and try again.", 400)
    }
    const claims = tokens.claims()
    if (!claims) return c.text("The identity provider sent no ID token.", 400)
    createSession(c, { user: userFromClaims(claims), idToken: tokens.id_token ?? null })
    return c.redirect(flow.returnTo)
  })

  routes.post("/logout", async (c) => {
    const current = readSession(c)
    destroySession(c)
    if (current?.idToken && env.OIDC_ISSUER) {
      const config = await getConfig()
      if (config.serverMetadata().end_session_endpoint) {
        const url = oidc.buildEndSessionUrl(config, {
          id_token_hint: current.idToken,
          post_logout_redirect_uri: new URL("/", env.PUBLIC_URL).href,
        })
        return c.json({ redirect: url.href })
      }
    }
    return c.json({ redirect: "/" })
  })

  if (env.DEV_LOGIN) {
    const personas: Record<string, SessionUser> = {
      admin: { id: "dev-admin", name: "Ada Admin", canParticipate: true, isAdmin: true },
      socio: { id: "dev-socio", name: "Sara Socia", canParticipate: true, isAdmin: false },
      guest: { id: "dev-guest", name: "Nico Newcomer", canParticipate: false, isAdmin: false },
    }
    routes.get("/dev-login", (c) => {
      const returnTo = safeReturnTo(c.req.query("returnTo"))
      const persona = personas[c.req.query("as") ?? ""]
      if (!persona) {
        const links = Object.entries(personas)
          .map(
            ([key, p]) =>
              `<li><a href="?as=${key}&returnTo=${encodeURIComponent(returnTo)}">${p.name}</a></li>`,
          )
          .join("")
        return c.html(
          `<h1>Dev sign-in</h1><ul>${links}</ul><p><a href="/auth/login?returnTo=${encodeURIComponent(returnTo)}">Real IdP</a></p>`,
        )
      }
      // Each tab can be a different person: append ?n=2 to get a distinct "Sara Socia 2".
      const n = c.req.query("n")
      createSession(c, {
        user: n ? { ...persona, id: `${persona.id}-${n}`, name: `${persona.name} ${n}` } : persona,
        idToken: null,
      })
      return c.redirect(returnTo)
    })
  }

  return { session, routes }
}

/** Only same-site paths, so the login flow cannot be used as an open redirect. */
function safeReturnTo(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/"
}
