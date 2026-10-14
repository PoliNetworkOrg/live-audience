import { type CSSProperties, type ReactNode, useEffect, useState } from "react"
import { cx } from "./ui.tsx"

/** Shared pieces of the audience side of activities: phones, dark background, big and friendly. */

/** Tells audience members the name results will show for them, taken from their account. */
export function ShownAs({ name }: { name: string }) {
  return (
    <p className="text-sm text-sky-100">
      You take part as <span className="font-semibold text-white">{name}</span>, the name on your PoliNetwork
      account. It can be shown on the presentation.
    </p>
  )
}

/** One of `options`, picked once per mount so the message does not change on every render. */
export function useOneOf<T>(options: readonly T[]): T {
  return useState(() => options[Math.floor(Math.random() * options.length)] as T)[0]
}

const tones = {
  win: "border-amber-300/60 bg-gradient-to-br from-amber-300/25 to-pink-400/20",
  lose: "border-rose-300/30 bg-rose-400/10",
  info: "border-white/15 bg-white/8",
}

/**
 * The big end-of-round card: a win throws confetti and buzzes the phone, a loss wobbles.
 * The animations restart whenever the verdict changes.
 */
export function Verdict({
  tone,
  emoji,
  title,
  points,
  children,
}: {
  tone: keyof typeof tones
  emoji: string
  title: string
  /** Points scored in this activity, shown as a badge. */
  points?: number | null
  children?: ReactNode
}) {
  useEffect(() => {
    // Browsers refuse (and complain) until the person has touched the page.
    if (!navigator.userActivation?.hasBeenActive) return
    if (tone === "win") navigator.vibrate?.([80, 60, 80, 60, 200])
    else if (tone === "lose") navigator.vibrate?.(150)
  }, [tone])
  return (
    <div
      key={`${tone}-${title}`}
      role="status"
      className={cx("animate-pop-in rounded-3xl border px-5 py-6 text-center", tones[tone])}
    >
      <div
        aria-hidden
        className={cx(
          "mb-2 text-6xl",
          tone === "win" ? "animate-tada" : tone === "lose" ? "animate-wobble" : "animate-float",
        )}
      >
        {emoji}
      </div>
      <p className="text-2xl font-bold tracking-tight text-white">{title}</p>
      {children && <div className="mt-2 text-pretty text-sky-100/85">{children}</div>}
      {points != null && (
        <p
          className={cx(
            "mt-3 inline-block rounded-full px-3 py-1 text-sm font-bold tabular-nums",
            points > 0 ? "bg-amber-300 text-brand-950" : "bg-white/10 text-white/70",
          )}
        >
          +{points.toLocaleString("en")} points
        </p>
      )}
      {tone === "win" && <Confetti />}
    </div>
  )
}

const confettiColors = ["#fcd34d", "#f472b6", "#7dd3fc", "#86efac", "#c4b5fd", "#ffffff"]

function Confetti() {
  const [pieces] = useState(() =>
    Array.from({ length: 80 }, (_, index) => ({
      id: index,
      left: Math.random() * 100,
      delay: Math.random() * 0.8,
      duration: 2.4 + Math.random() * 1.8,
      drift: (Math.random() - 0.5) * 160,
      spin: (Math.random() - 0.5) * 1440,
      color: confettiColors[index % confettiColors.length],
      round: index % 3 === 0,
    })),
  )
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className={cx(
            "animate-confetti absolute -top-4 block h-3 w-2",
            piece.round && "size-2.5 rounded-full",
          )}
          style={
            {
              left: `${piece.left}%`,
              backgroundColor: piece.color,
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
              "--drift": `${piece.drift}px`,
              "--spin": `${piece.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** A little "saved" line that pops every time `id` changes. */
export function Saved({ id, children }: { id: unknown; children: ReactNode }) {
  return (
    <p key={JSON.stringify(id)} className="animate-pop-in text-center text-sm font-medium text-emerald-300">
      {children}
    </p>
  )
}

export interface LeaderboardView {
  title: string
  top: { rank: number; name: string; points: number }[]
  me: { rank: number; points: number } | null
  players: number
}

const medals: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

/** The current presentation's top 3 and the viewer's own place. */
export function Leaderboard({ board }: { board: LeaderboardView }) {
  return (
    <div className="animate-pop-in space-y-3 rounded-3xl border border-white/15 bg-white/8 p-5 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-white">Leaderboard</h2>
        <span className="truncate text-xs text-sky-100/60">{board.title}</span>
      </div>
      {board.top.length === 0 ? (
        <p className="text-sm text-sky-100/75">No points yet: the first game is coming up!</p>
      ) : (
        <ol className="space-y-2">
          {board.top.map((entry, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: names can repeat
              key={index}
              style={{ animationDelay: `${index * 80}ms` }}
              className="animate-pop-in flex items-center gap-3 rounded-2xl bg-white/8 px-4 py-3"
            >
              <span className="w-7 text-center text-2xl">{medals[entry.rank] ?? `#${entry.rank}`}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-white">{entry.name}</span>
              <span className="font-semibold text-amber-200 tabular-nums">
                {entry.points.toLocaleString("en")}
              </span>
            </li>
          ))}
        </ol>
      )}
      <MyPlace board={board} />
    </div>
  )
}

/** One line: where the viewer stands. */
export function MyPlace({ board, className }: { board: LeaderboardView; className?: string }) {
  const { me, players } = board
  return (
    <p className={cx("text-center text-sm text-sky-100", className)}>
      {me ? (
        <>
          You're <b className="text-white">#{me.rank}</b> of {players} with{" "}
          <b className="text-amber-200 tabular-nums">{me.points.toLocaleString("en")}</b> points
          {me.rank === 1 ? " 👑" : me.rank <= 3 ? " 🔥" : ""}
        </>
      ) : (
        "Play the next game to get on the board!"
      )}
    </p>
  )
}
