import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { Icon, type IconName } from "./icons.tsx"
import { cx } from "./ui.tsx"

/**
 * Shared pieces of the audience side of activities: phones, glass on light blue, big and friendly.
 * Everything of an activity should fit one phone screen without scrolling: keep it compact, and
 * put long explanations behind a button (see `Verdict`).
 */

/** Whether the points of the activity on stage go to the leaderboard. */
export const CountsToLeaderboard = createContext(true)

/** The question or prompt of an activity. */
export function Question({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-[1.5rem] leading-[1.15] font-medium tracking-tight text-balance text-slate-800 tall:text-[1.75rem]">
      {children}
    </h2>
  )
}

/** A short line of help under or around the controls. */
export function Hint({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cx("text-[0.8125rem] leading-snug text-pretty text-slate-500", className)}>{children}</p>
  )
}

/** Text and number inputs on phones. */
export const audienceField =
  "w-full rounded-2xl border-[1.5px] border-white bg-white/75 px-5 py-3.5 text-lg text-slate-900 shadow-[inset_0_1px_3px_rgb(17_86_174/0.1)] outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-400/20 disabled:opacity-60"

/** The big pill that sends an answer. */
export function SubmitButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "w-full rounded-full bg-pn px-6 py-3.5 font-headline text-lg font-medium text-white shadow-[0_16px_32px_-16px_rgb(17_86_174/0.8)] transition hover:bg-pn-deep active:scale-[0.98] disabled:bg-pn/35 disabled:shadow-none disabled:active:scale-100",
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
        "flex w-full items-center gap-4 rounded-[20px] border-[1.5px] px-5 py-3.5 text-left font-headline text-[1.0625rem] transition active:scale-[0.98] disabled:cursor-default disabled:active:scale-100",
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

interface Drag {
  index: number
  pointerId: number
  startY: number
  offset: number
  /** Where every row sat when the drag started: rows do not move in the DOM until the drop. */
  tops: number[]
  heights: number[]
  gap: number
}

/** Where the dragged row would land, given how far it moved. */
function dropIndex({ index, offset, tops, heights }: Drag) {
  const center = (tops[index] ?? 0) + offset + (heights[index] ?? 0) / 2
  let target = index
  tops.forEach((top, other) => {
    const middle = top + (heights[other] ?? 0) / 2
    if (other < index && center < middle) target--
    if (other > index && center > middle) target++
  })
  return target
}

/**
 * Items to put in order: drag a row with a finger (or the mouse), or focus it and use the arrow
 * keys. Rows slide out of the way while dragging; the new order is committed on release.
 */
export function SortableList({
  items,
  onChange,
  disabled,
}: {
  items: string[]
  onChange: (items: string[]) => void
  disabled?: boolean
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const target = drag ? dropIndex(drag) : null

  const moveItem = (from: number, to: number) => {
    if (to < 0 || to >= items.length || to === from) return
    const reordered = [...items]
    const [item] = reordered.splice(from, 1)
    reordered.splice(to, 0, item as string)
    onChange(reordered)
  }

  const start = (index: number, event: PointerEvent<HTMLLIElement>) => {
    if (disabled || drag || (event.pointerType === "mouse" && event.button !== 0)) return
    const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[]
    const tops = rows.map((row) => row.offsetTop)
    const heights = rows.map((row) => row.offsetHeight)
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      index,
      pointerId: event.pointerId,
      startY: event.clientY,
      offset: 0,
      tops,
      heights,
      gap: rows.length > 1 ? (tops[1] ?? 0) - (tops[0] ?? 0) - (heights[0] ?? 0) : 0,
    })
  }
  const move = (event: PointerEvent<HTMLLIElement>) => {
    if (drag?.pointerId !== event.pointerId) return
    // Keep the row on the list, a little past its ends at most.
    const first = drag.tops[0] ?? 0
    const last = (drag.tops.at(-1) ?? 0) + (drag.heights.at(-1) ?? 0)
    const top = drag.tops[drag.index] ?? 0
    const height = drag.heights[drag.index] ?? 0
    const offset = Math.min(
      Math.max(event.clientY - drag.startY, first - top - height / 2),
      last - top - height / 2,
    )
    setDrag({ ...drag, offset })
  }
  const end = (event: PointerEvent<HTMLLIElement>) => {
    if (drag?.pointerId !== event.pointerId) return
    if (event.type === "pointerup") moveItem(drag.index, dropIndex(drag))
    setDrag(null)
  }
  const keys = (index: number, event: KeyboardEvent<HTMLLIElement>) => {
    if (disabled) return
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null
    if (to === null) return
    event.preventDefault()
    moveItem(index, to)
  }

  /** How far a row slides to make room for the dragged one. */
  const shift = (index: number) => {
    if (!drag || target === null || index === drag.index) return 0
    const room = (drag.heights[drag.index] ?? 0) + drag.gap
    if (index > drag.index && index <= target) return -room
    if (index < drag.index && index >= target) return room
    return 0
  }

  return (
    <ol
      ref={listRef}
      className="relative space-y-1.5 tall:space-y-2"
      aria-label="Drag the items, or use the arrow keys"
    >
      {items.map((item, index) => {
        const dragged = drag?.index === index
        // The number each row will have once dropped.
        const position = dragged && target !== null ? target : index + Math.sign(shift(index))
        return (
          <li
            key={item}
            tabIndex={disabled ? -1 : 0}
            aria-label={`${item}, position ${index + 1} of ${items.length}`}
            onPointerDown={(event) => start(index, event)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(event) => keys(index, event)}
            style={{
              transform: `translateY(${dragged ? (drag?.offset ?? 0) : shift(index)}px)`,
              touchAction: disabled ? undefined : "none",
            }}
            className={cx(
              "glass relative flex items-center gap-3 py-1.5 pr-3 pl-2 outline-none tall:py-2 select-none focus-visible:ring-4 focus-visible:ring-blue-400/40",
              !disabled && "cursor-grab",
              dragged
                ? "z-10 scale-[1.03] cursor-grabbing bg-white/95! shadow-[0_18px_36px_-16px_rgb(17_86_174/0.6)] transition-[scale,box-shadow]"
                : "transition-transform duration-200",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-blue-400/15 font-display text-sm font-medium text-blue-700 tabular-nums">
              {position + 1}
            </span>
            <span className="min-w-0 flex-1 font-headline leading-snug break-words text-slate-800">
              {item}
            </span>
            {!disabled && <Icon name="grip" className="size-5 shrink-0 text-slate-400" />}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Something secondary behind a "Show …" button, e.g. a person's own answer once answers are
 * closed: the verdict is what matters then, and it must stay on screen.
 */
export function ShowHide({ label, children }: { label: string; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setShown(!shown)}
        className="flex w-full items-center justify-center gap-1.5 rounded-full py-1.5 text-sm font-medium text-pn transition hover:bg-white/70 [&>svg]:size-4"
      >
        {shown ? "Hide" : "Show"} {label}
        <Icon name="chevron-down" className={cx("transition-transform", shown && "rotate-180")} />
      </button>
      {shown && <div className="animate-pop-in">{children}</div>}
    </div>
  )
}

/** Tells audience members the name results will show for them, taken from their account. */
export function ShownAs({ name }: { name: string }) {
  return (
    <p className="truncate text-xs text-slate-500" title="The name on your PoliNetwork account">
      Playing as <b className="font-semibold text-slate-800">{name}</b> · it can appear on the screen
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
 * The end-of-round card: a win throws confetti and buzzes the phone, a loss wobbles. The
 * animations restart whenever the verdict changes. With `solution`, the explanation (usually the
 * right answer) waits behind a button, so the round still fits the screen.
 */
export function Verdict({
  tone,
  icon,
  title,
  points,
  solution,
  children,
}: {
  tone: keyof typeof tones
  icon: IconName
  title: string
  /** Points scored in this activity, shown as a badge. */
  points?: number | null
  /** Hide `children` until asked: they give the answer away and take room. */
  solution?: boolean
  children?: ReactNode
}) {
  const counts = useContext(CountsToLeaderboard)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    // Browsers refuse (and complain) until the person has touched the page.
    if (!navigator.userActivation?.hasBeenActive) return
    if (tone === "win") navigator.vibrate?.([80, 60, 80, 60, 200])
    else if (tone === "lose") navigator.vibrate?.(150)
  }, [tone])
  return (
    <div key={`${tone}-${title}`} role="status" className={cx("animate-pop-in px-5 py-4", tones[tone].card)}>
      <div className="flex items-center gap-4">
        <div
          aria-hidden
          className={cx(
            "flex size-12 shrink-0 items-center justify-center rounded-full text-2xl",
            tones[tone].badge,
            tone === "win" ? "animate-tada" : tone === "lose" ? "animate-wobble" : "animate-float",
          )}
        >
          <Icon name={icon} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-display text-xl leading-tight font-medium tracking-tight text-balance text-slate-800">
            {title}
          </p>
          {points != null && (
            <p
              className={cx(
                "inline-block rounded-full px-3 py-0.5 font-display text-xs font-semibold tabular-nums",
                points > 0
                  ? "bg-pn text-white"
                  : "bg-white/70 text-slate-500 ring-[1.5px] ring-slate-300 ring-inset",
              )}
              title={counts ? undefined : "This game does not count towards the leaderboard"}
            >
              +{points.toLocaleString("en")} points{!counts && " · just for fun"}
            </p>
          )}
        </div>
      </div>
      {children &&
        (solution && !shown ? (
          <button
            type="button"
            onClick={() => setShown(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full py-1.5 text-sm font-medium text-pn transition hover:bg-white/70 [&>svg]:size-4"
          >
            <Icon name="eye" /> Show the answer
          </button>
        ) : (
          <div className="animate-pop-in mt-3 text-sm text-pretty text-slate-600 [&_b]:text-slate-800">
            {children}
            {solution && (
              <button
                type="button"
                onClick={() => setShown(false)}
                className="ml-1.5 font-medium text-pn underline underline-offset-2"
              >
                Hide
              </button>
            )}
          </div>
        ))}
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
