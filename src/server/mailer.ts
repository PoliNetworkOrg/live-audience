import type { Env } from "./env.ts"
import {
  logMailer,
  type Mailer,
  type SecretSantaMailWithLink,
  type SecretSantaReassignMailWithLink,
  type SecretSantaStatusMailWithLink,
} from "./jobs.ts"

/** Transport to the backend's existing transactional mailer; no email is rendered in Live. */
export function createMailer(
  env: Pick<Env, "NODE_ENV" | "MAILER_URL" | "MAILER_TOKEN">,
  send = fetch,
): Mailer {
  const { MAILER_URL: endpoint, MAILER_TOKEN: token } = env
  if (!endpoint || !token) {
    if (env.NODE_ENV !== "production") return logMailer
    const unavailable = async () => {
      throw new Error("Secret Santa mail transport is not configured")
    }
    return {
      sendSecretSanta: unavailable,
      sendSecretSantaReassigned: unavailable,
      sendSecretSantaStatus: unavailable,
    }
  }
  const sendMail = async (
    kind: string,
    id: string,
    mail: SecretSantaMailWithLink | SecretSantaReassignMailWithLink | SecretSantaStatusMailWithLink,
  ) => {
    const response = await send(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind, id, ...mail }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Secret Santa mail transport returned ${response.status}`)
  }
  return {
    sendSecretSanta: (mail) =>
      sendMail("draw", `${mail.activityId}:draw:${mail.userId}:${mail.drawnAt}`, mail),
    sendSecretSantaReassigned: (mail) =>
      sendMail("reassigned", `${mail.activityId}:reassigned:${mail.userId}:${mail.at}`, mail),
    sendSecretSantaStatus: (mail) =>
      sendMail(mail.kind, `${mail.activityId}:${mail.kind}:${mail.userId}:${mail.deadline}`, mail),
  }
}
