import type { Context } from "hono"
import { type SSEStreamingApi, streamSSE } from "hono/streaming"

/**
 * Opens a Server-Sent Events stream, runs `setup` to subscribe to whatever it needs and keeps the
 * connection alive (proxies such as Cloudflare drop idle ones) until the client goes away.
 */
export function sse(
  c: Context,
  setup: (send: (event: string, data: unknown) => void) => (() => void) | undefined,
) {
  return streamSSE(c, async (stream: SSEStreamingApi) => {
    const send = (event: string, data: unknown) => {
      if (!stream.aborted && !stream.closed) void stream.writeSSE({ event, data: JSON.stringify(data) })
    }
    const cleanup = setup(send)
    const ping = setInterval(() => void stream.write(": ping\n\n"), 20_000)
    await new Promise<void>((resolve) => stream.onAbort(resolve))
    clearInterval(ping)
    cleanup?.()
  })
}

/** Coalesces bursts of calls per key: `fn(key)` runs at most once every `ms`. */
export function throttleByKey(ms: number, fn: (key: string) => void) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  return {
    call(key: string) {
      if (pending.has(key)) return
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key)
          fn(key)
        }, ms),
      )
    },
    cancel() {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    },
  }
}
