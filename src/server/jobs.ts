import type { SecretSantaMail, SecretSantaReassignMail, Store } from "./store.ts"

/** What a draw email needs, plus the link to the page where the golden letter opens. */
export type SecretSantaMailWithLink = SecretSantaMail & { url: string }
export type SecretSantaReassignMailWithLink = SecretSantaReassignMail & { url: string }

/**
 * Sends the Secret Santa draw emails. The template and the noreply sender live in the PoliNetwork
 * backend (`src/emails/templates/secret-santa.tsx`); until live-audience can call it, the default
 * mailer only logs what it would send.
 */
export interface Mailer {
  sendSecretSanta(mail: SecretSantaMailWithLink): Promise<void>
  /** Someone withdrew after the draw and this person was giving them a gift. */
  sendSecretSantaReassigned(mail: SecretSantaReassignMailWithLink): Promise<void>
}

export const logMailer: Mailer = {
  async sendSecretSanta(mail) {
    console.log(`[mail] Secret Santa draw email to ${mail.to} (${mail.name}): ${mail.url}`)
  },
  async sendSecretSantaReassigned(mail) {
    console.log(
      `[mail] Secret Santa reassignment email to ${mail.to} (${mail.name}): ${mail.withdrawnName} withdrew, new match: ${mail.hasNewMatch} ${mail.url}`,
    )
  },
}

/**
 * Every `intervalMs`: runs the gift draws that are due, then sends the draw emails not sent yet and
 * the "your person withdrew" emails.
 * Failed emails stay pending and are retried on the next tick. Runs once right away.
 */
export function startSecretSantaJobs({
  store,
  mailer,
  publicUrl,
  intervalMs = 30_000,
}: {
  store: Store
  mailer: Mailer
  publicUrl: string
  intervalMs?: number
}) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runSecretSantaJobs(store, mailer, publicUrl)
    } catch (error) {
      console.error("[secret-santa] job failed", error)
    } finally {
      running = false
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), intervalMs)
  return () => clearInterval(timer)
}

export async function runSecretSantaJobs(store: Store, mailer: Mailer, publicUrl: string) {
  for (const id of store.runSecretSantaSchedule()) console.log(`[secret-santa] automatic draw for ${id}`)
  const url = new URL("/secret-santa", publicUrl).href
  for (const mail of store.pendingSecretSantaMails()) {
    try {
      await mailer.sendSecretSanta({ ...mail, url })
      store.markSecretSantaMailSent(mail.activityId, mail.userId)
    } catch (error) {
      console.error(`[secret-santa] could not email ${mail.to}, will retry`, error)
    }
  }
  for (const mail of store.pendingSecretSantaReassignMails()) {
    try {
      await mailer.sendSecretSantaReassigned({ ...mail, url })
      store.markSecretSantaReassignSent(mail.activityId, mail.userId, mail.at)
    } catch (error) {
      console.error(`[secret-santa] could not email ${mail.to} about a withdrawal, will retry`, error)
    }
  }
}
