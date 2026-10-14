import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode, useEffect, useState } from "react"
import { Icon, type IconName } from "./icons.tsx"
import { cx } from "./ui.tsx"

/** Shared pieces of the audience side of activities: phones, glass on light blue, big and friendly. */

/** The question or prompt of an activity. */
export function Question({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[1.75rem] leading-[1.15] font-medium tracking-tight text-balance text-slate-800">
      {children}
    </h2>
  )
}

/** A short line of help under or around the controls. */
export function Hint({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx("text-sm text-pretty text-slate-500", className)}>{children}</p>
}

/** Text and number inputs on phones. */
export const audienceField =
  "w-full rounded-2xl border-[1.5px] border-white bg-white/75 px-5 py-4 text-lg text-slate-900 shadow-[inset_0_1px_3px_rgb(17_86_174/0.1)] outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-400/20 disabled:opacity-60"

/** The big pill that sends an answer. */
export function SubmitButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "w-full rounded-full bg-pn px-6 py-4 font-headline text-lg font-medium text-white shadow-[0_16px_32px_-16px_rgb(17_86_174/0.8)] transition hover:bg-pn-deep active:scale-[0.98] disabled:bg-pn/35 disabled:shadow-none disabled:active:scale-100",
        className,
      )}
      {...props}
    />
  )
}

/** One of the answers of a choice: a glass row that turns solid blue when picked. */
export function ChoiceButton({
  selected,
  shape = "circle",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean; shape?: "circle" | "square" }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        "flex w-full items-center gap-4 rounded-[20px] border-[1.5px] px-5 py-4 text-left font-headline text-[1.0625rem] transition active:scale-[0.98] disabled:cursor-default disabled:active:scale-100",
        selected
          ? "border-pn bg-pn text-white shadow-[0_18px_36px_-18px_rgb(17_86_174/0.9)]"
          : "glass text-slate-800 hover:bg-white/80 disabled:opacity-55 disabled:hover:bg-transparent",
        className,
      )}
      {...props}
    >
      <span
        className={cx(
          "flex size-6 shrink-0 items-center justify-center border-[1.5px] text-sm",
          shape === "circle" ? "rounded-full" : "rounded-md",
          selected ? "border-white bg-white text-pn" : "border-slate-300 bg-white/60",
        )}
      >
        {selected && <Icon name="check" strokeWidth={3} />}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </button>
  )
}

/** Tells audience members the name results will show for them, taken from their account. */
export function ShownAs({ name }: { name: string }) {
  return (
    <p className="text-sm text-pretty text-slate-500">
      You take part as <b className="font-semibold text-slate-800">{name}</b>, the name on your PoliNetwork
      account. It can be shown on the presentation.
    </p>
  )
}

/** One of `options`, picked once per mount so the message does not change on every render. */
export function useOneOf<T>(options: readonly T[]): T {
  return useState(() => options[Math.floor(Math.random() * options.length)] as T)[0]
}

const tones = {
  win: { card: "glass-tint", badge: "bg-pn text-white shadow-[0_0_0_8px_rgb(81_162_255/0.18)]" },
  lose: { card: "glass", badge: "bg-rose-600/10 text-rose-600" },
  info: { card: "glass", badge: "bg-white/80 text-sky-700 ring-[1.5px] ring-white" },
}

/**
 * The big end-of-round card: a win throws confetti and buzzes the phone, a loss wobbles.
 * The animations restart whenever the verdict changes.
 */
export function Verdict({
  tone,
  icon,
  title,
  points,
  children,
}: {
  tone: keyof typeof tones
  icon: IconName
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
      className={cx("animate-pop-in px-7 py-8 text-center", tones[tone].card)}
    >
      <div
        aria-hidden
        className={cx(
          "mx-auto mb-5 flex size-14 items-center justify-center rounded-full text-[1.75rem]",
          tones[tone].badge,
          tone === "win" ? "animate-tada" : tone === "lose" ? "animate-wobble" : "animate-float",
        )}
      >
        <Icon name={icon} />
      </div>
      <p className="font-display text-2xl font-medium tracking-tight text-balance text-slate-800">{title}</p>
      {children && <div className="mt-3 text-pretty text-slate-600 [&_b]:text-slate-800">{children}</div>}
      {points != null && (
        <p
          className={cx(
            "mt-5 inline-block rounded-full px-4 py-1 font-display text-sm font-semibold tabular-nums",
            points > 0
              ? "bg-pn text-white"
              : "bg-white/70 text-slate-500 ring-[1.5px] ring-slate-300 ring-inset",
          )}
        >
          +{points.toLocaleString("en")} points
        </p>
      )}
      {tone === "win" && <Confetti />}
    </div>
  )
}

// The palette of the slides: blues, sky, a touch of emerald and amber.
const confettiColors = ["#1156ae", "#51a2ff", "#74d4ff", "#0069a8", "#00d492", "#ffb900", "#ffffff"]

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
            "animate-confetti absolute -top-4 block h-3 w-2 rounded-[2px] shadow-sm",
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
    <p
      key={JSON.stringify(id)}
      className="animate-pop-in flex items-center justify-center gap-2 text-center text-sm font-medium text-emerald-700"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">
        <Icon name="check" strokeWidth={3} />
      </span>
      <span className="text-pretty">{children}</span>
    </p>
  )
}

export interface LeaderboardView {
  title: string
  top: { rank: number; name: string; points: number }[]
  me: { rank: number; points: number } | null
  players: number
}

/** A rank in a rounded square, as the numbers of the agenda on the slides; first place is filled. */
export function Rank({ rank }: { rank: number }) {
  return (
    <span
      className={cx(
        "flex size-9 shrink-0 items-center justify-center rounded-xl font-display text-base font-medium tabular-nums",
        rank === 1 ? "bg-pn text-white" : "bg-blue-400/15 text-blue-700",
      )}
    >
      {rank}
    </span>
  )
}

/** The current presentation's top 3 and the viewer's own place. */
export function Leaderboard({ board }: { board: LeaderboardView }) {
  return (
    <div className="glass animate-pop-in space-y-5 p-6 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="kicker">Leaderboard</h2>
        <span className="truncate text-xs text-slate-500">{board.title}</span>
      </div>
      {board.top.length === 0 ? (
        <p className="text-sm text-slate-600">No points yet: the first game is coming up.</p>
      ) : (
        <ol className="divide-y-[1.5px] divide-white/85">
          {board.top.map((entry, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: names can repeat
              key={index}
              style={{ animationDelay: `${index * 80}ms` }}
              className="animate-pop-in flex items-center gap-3.5 py-3 first:pt-0 last:pb-0"
            >
              <Rank rank={entry.rank} />
              <span className="min-w-0 flex-1 truncate font-headline text-slate-800">{entry.name}</span>
              <span className="font-display text-lg font-medium text-pn tabular-nums">
                {entry.points.toLocaleString("en")}
              </span>
            </li>
          ))}
        </ol>
      )}
      <MyPlace board={board} className="border-t-[1.5px] border-white/85 pt-5" />
    </div>
  )
}

/** One line: where the viewer stands. */
export function MyPlace({ board, className }: { board: LeaderboardView; className?: string }) {
  const { me, players } = board
  return (
    <p className={cx("text-center text-sm text-slate-600", className)}>
      {me ? (
        <>
          You're <b className="font-semibold text-slate-800">#{me.rank}</b> of {players} with{" "}
          <b className="font-display font-semibold text-pn tabular-nums">{me.points.toLocaleString("en")}</b>{" "}
          points{me.rank === 1 && " 👑"}
        </>
      ) : (
        "Play the next game to get on the board."
      )}
    </p>
  )
}
