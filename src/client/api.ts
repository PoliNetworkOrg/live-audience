import { useCallback, useEffect, useRef, useState } from "react"

export class ApiError extends Error {
  readonly status: number
  readonly details: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, data.error ?? response.statusText, data.details)
  return data as T
}

/** Loads `path` and gives back the data, the error and a way to reload. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces a reload
  useEffect(() => {
    if (!path) return
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    api<T>(path)
      .then((data) => !cancelled && setState({ data, loading: false }))
      // A failed reload keeps what was loaded: a phone offline for a moment stays where it was.
      .catch((error) => !cancelled && setState((s) => ({ ...s, error, loading: false })))
    return () => {
      cancelled = true
    }
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload, setData: (data: T) => setState({ data, loading: false }) }
}

/**
 * Subscribes to a Server-Sent Events stream. `connected` is false while (re)connecting; the
 * browser retries on its own after network errors.
 */
export function useEventStream(url: string | null, handlers: Record<string, (data: never) => void>) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const [connected, setConnected] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt forces a new connection
  useEffect(() => {
    if (!url) return
    const source = new EventSource(url)
    let retry: ReturnType<typeof setTimeout> | undefined
    source.onopen = () => setConnected(true)
    source.onerror = () => {
      setConnected(false)
      // Browsers give up for good after an HTTP error (e.g. a restart mid-deploy): try again later.
      if (source.readyState === EventSource.CLOSED) retry = setTimeout(() => setAttempt((a) => a + 1), 3000)
    }
    for (const event of Object.keys(handlersRef.current)) {
      source.addEventListener(event, (e) =>
        handlersRef.current[event]?.(JSON.parse((e as MessageEvent).data) as never),
      )
    }
    return () => {
      clearTimeout(retry)
      source.close()
    }
  }, [url, attempt])
  return connected
}

export interface Me {
  id: string
  name: string
  picture?: string
  canParticipate: boolean
  isAdmin: boolean
  /** Joined with just a name, without a PoliNetwork account. */
  guest?: boolean
}

/** Who plays a presentation: PoliNetwork accounts, guests who typed a name, or both. */
export type Players = "accounts" | "guests" | "everyone"

/**
 * `players`: who plays the running presentation.
 * `playing`: whether `user` may answer now.
 */
export function useMe() {
  return useApi<{ user: Me | null; players: Players; playing: boolean }>("/api/me")
}

export async function joinAsGuest(name: string) {
  return api<{ user: Me }>("/auth/guest", { body: { name } })
}

export async function logout() {
  const { redirect } = await api<{ redirect: string }>("/auth/logout", { method: "POST" })
  window.location.href = redirect
}

export function loginUrl(returnTo = window.location.pathname) {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
}
