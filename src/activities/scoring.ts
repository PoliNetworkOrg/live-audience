/**
 * Points shared by every scored activity type, so a presentation's leaderboard adds up fairly.
 * An answer is worth up to `MAX_POINTS` times its accuracy (0–1), and loses up to half of that
 * over the first `SPEED_WINDOW_MS` after answers open: being right matters most, being quick helps.
 */
export const MAX_POINTS = 1000
export const SPEED_WINDOW_MS = 30_000

export function scorePoints(accuracy: number, elapsedMs: number): number {
  const speed = 1 - 0.5 * Math.min(Math.max(elapsedMs, 0) / SPEED_WINDOW_MS, 1)
  return Math.round(MAX_POINTS * Math.min(Math.max(accuracy, 0), 1) * speed)
}
