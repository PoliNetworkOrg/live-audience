/**
 * PoliNetwork Live: client for HTML presentations.
 *
 *   import { LiveAudience } from "https://live.example.org/live-audience.js"
 *   const live = new LiveAudience({ url: "https://live.example.org", key: "la_..." })
 *
 *   await live.open("dinner-poll")      // put it on stage, answers open
 *   await live.close()                  // stop accepting answers, keep it on stage
 *   await live.clear()                  // back to the idle screen
 *   live.onResults("dinner-poll", (r) => draw(r.results))   // live updates
 *
 * Slide integration: mark slides with `data-live="<slug>"` (and optionally
 * `data-live-status="closed"`), or `data-live="clear"`, then call `live.applySlide(slideElement)`
 * whenever the current slide changes. Slides without `data-live` leave the stage untouched.
 *
 * No dependencies, no build step. Works from file:// too.
 */
export class LiveAudience {
  /** @param {{ url: string, key: string }} options */
  constructor({ url, key }) {
    if (!url || !key) throw new Error("LiveAudience needs { url, key }")
    this.url = url.replace(/\/+$/, "")
    this.key = key
  }

  /** @param {string} path @param {{ method?: string, body?: unknown }} [init] */
  async request(path, init = {}) {
    const response = await fetch(`${this.url}/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${this.key}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`LiveAudience: ${data.error ?? response.statusText}`)
    return data
  }

  /** Current stage: `{ status, activity: { id, slug, type, title } | null }`. */
  stage() {
    return this.request("/stage")
  }

  /** Puts an activity on stage and opens it for answers. */
  open(slug) {
    return this.request("/stage", { body: { activity: slug, status: "open" } })
  }

  /** Puts an activity on stage, closed: people see it but cannot answer (yet, or anymore). */
  show(slug) {
    return this.request("/stage", { body: { activity: slug, status: "closed" } })
  }

  /** Closes answers on whatever is on stage. With a slug, shows that activity closed instead. */
  close(slug) {
    return slug ? this.show(slug) : this.request("/stage/close", { method: "POST" })
  }

  /** Re-opens answers on whatever is on stage. */
  reopen() {
    return this.request("/stage/open", { method: "POST" })
  }

  /** Nothing on stage: the audience sees the idle screen. */
  clear() {
    return this.request("/stage/clear", { method: "POST" })
  }

  /** Every activity, with its config (e.g. a poll's question and options). */
  activities() {
    return this.request("/activities")
  }

  /** Results right now: `{ id, slug, type, title, results }`. */
  results(slug) {
    return this.request(`/activities/${encodeURIComponent(slug)}/results`)
  }

  /** Deletes every answer to an activity. */
  reset(slug) {
    return this.request(`/activities/${encodeURIComponent(slug)}/reset`, { method: "POST" })
  }

  /**
   * Calls `callback` with the results now and whenever they change.
   * @returns {() => void} stops listening
   */
  onResults(slug, callback) {
    return this.#listen(`activity=${encodeURIComponent(slug)}`, { results: callback })
  }

  /**
   * Calls `callback` with the stage now and whenever it changes.
   * @returns {() => void} stops listening
   */
  onStage(callback) {
    return this.#listen("", { stage: callback })
  }

  /** Applies a slide's `data-live` / `data-live-status` attributes. See the top of this file. */
  applySlide(element) {
    const slug = element?.dataset?.live
    if (!slug) return Promise.resolve(null)
    if (slug === "clear") return this.clear()
    return element.dataset.liveStatus === "closed" ? this.show(slug) : this.open(slug)
  }

  #listen(query, handlers) {
    const params = new URLSearchParams(query)
    params.set("key", this.key)
    const source = new EventSource(`${this.url}/api/v1/events?${params}`)
    for (const [event, callback] of Object.entries(handlers)) {
      source.addEventListener(event, (e) => callback(JSON.parse(e.data)))
    }
    return () => source.close()
  }
}

if (typeof window !== "undefined") window.LiveAudience = LiveAudience
