import { describe, expect, it, vi } from "vitest"
import { createMailer } from "../src/server/mailer.ts"

const env = {
  NODE_ENV: "production" as const,
  MAILER_URL: "https://backend.example/internal/secret-santa/emails",
  MAILER_TOKEN: "x".repeat(32),
}
const base = {
  activityId: "santa",
  userId: "person",
  to: "person@example.test",
  name: "Person",
  url: "https://live.example/secret-santa",
}

describe("Secret Santa email transport", () => {
  it("passes typed data, a stable message id and service authentication without following redirects", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const mailer = createMailer(env, send)
    await mailer.sendSecretSanta({ ...base, drawnAt: 123, exchange: "Cena", budget: "15 euro" })
    await mailer.sendSecretSantaReassigned({
      ...base,
      at: 456,
      withdrawnName: "Old",
      hasNewMatch: true,
      reason: "unconfirmed",
    })
    await mailer.sendSecretSantaStatus({
      ...base,
      kind: "confirmation-reminder",
      deadline: "2026-12-10T12:00:00Z",
      closesAt: 123456,
    })
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${env.MAILER_TOKEN}` },
    })
    expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toMatchObject({
      kind: "draw",
      id: "santa:draw:person:123",
      to: base.to,
    })
    expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body))).toMatchObject({
      kind: "reassigned",
      reason: "unconfirmed",
    })
    expect(JSON.parse(String(send.mock.calls[2]?.[1]?.body))).toMatchObject({ kind: "confirmation-reminder" })
  })
  it("propagates delivery failure for the job to retry", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 }))
    await expect(
      createMailer(env, send).sendSecretSanta({ ...base, drawnAt: 1, exchange: "", budget: "" }),
    ).rejects.toThrow("502")
  })
  it("never marks unconfigured production transport as successful", async () => {
    await expect(
      createMailer({ NODE_ENV: "production" }).sendSecretSanta({
        ...base,
        drawnAt: 1,
        exchange: "",
        budget: "",
      }),
    ).rejects.toThrow("not configured")
  })
})
