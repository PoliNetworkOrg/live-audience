import type { CSSProperties, ReactNode } from "react"

/**
 * Hand-drawn Christmas decorations for the Secret Santa page. Purely decorative: every one is
 * aria-hidden, and every animation stops for people who ask for reduced motion (see styles.css).
 *
 * Nothing here is scaled to the viewport: garland and hills are built from fixed-size pieces, so
 * they look the same on a phone and on a 4K screen instead of being cropped.
 */

export const XMAS = {
  // PoliNetwork blues (the website's palette) and ice white are the base…
  navy: "oklch(20% 0.055 252)",
  brand800: "oklch(35.13% 0.062 249.28)",
  blue: "oklch(52% 0.18 257)",
  brand500: "oklch(62% 0.17 255)",
  sky: "oklch(80% 0.09 235)",
  frost: "oklch(90% 0.04 240)",
  ice: "oklch(97% 0.015 240)",
  white: "oklch(100% 0 0)",
  muted: "oklch(46% 0.04 252)",
  // …and Christmas gold, red and green are the accents.
  gold: "oklch(83% 0.14 85)",
  goldDark: "oklch(70% 0.14 75)",
  red: "oklch(58% 0.2 25)",
  redDark: "oklch(47% 0.17 25)",
  pine: "oklch(48% 0.11 158)",
  pineLight: "oklch(62% 0.13 155)",
}

/** Deterministic pseudo-random numbers, so decorations look scattered but never jump on re-render. */
function scatter(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

// ---- snow ------------------------------------------------------------------------------------

function Flake({ size }: { size: number }) {
  return (
    <svg viewBox="-10 -10 20 20" width={size} height={size} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none">
        {[0, 60, 120].map((angle) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <path d="M0 -9 V9" />
            <path d="M-2.5 -6.5 L0 -4 L2.5 -6.5 M-2.5 6.5 L0 4 L2.5 6.5" />
          </g>
        ))}
      </g>
    </svg>
  )
}

const FLAKES = Array.from({ length: 30 }, (_, i) => {
  const layer = i % 3
  return {
    left: scatter(i, 6) * 100,
    size: [12, 19, 28][layer] as number,
    opacity: [0.35, 0.55, 0.75][layer] as number,
    duration: ([24, 17, 12][layer] as number) + scatter(i, 7) * 6,
    delay: -scatter(i, 8) * 26,
    drift: (scatter(i, 9) - 0.5) * 90,
  }
})

const SNOW_LOGOS = Array.from({ length: 6 }, (_, i) => {
  const layer = i % 3
  return {
    left: ((i + 0.5) / 6) * 100 + (scatter(i, 30) - 0.5) * 6,
    size: [22, 30, 38][layer] as number,
    opacity: [0.2, 0.3, 0.4][layer] as number,
    duration: 22 + scatter(i, 31) * 12,
    delay: -scatter(i, 32) * 34,
    drift: (scatter(i, 33) - 0.5) * 70,
    sway: 9 + scatter(i, 34) * 6,
  }
})

/** Three layers of flakes, with a few icy logos mixed into the full-page snowfall. */
export function Snowfall({ fixed = true }: { fixed?: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none inset-0 overflow-hidden ${fixed ? "fixed" : "absolute"}`}
      style={{ color: XMAS.sky }}
    >
      {FLAKES.map((flake, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
          key={i}
          className="xmas-snow absolute -top-5 block"
          style={
            {
              left: `${flake.left}%`,
              opacity: flake.opacity,
              animationDuration: `${flake.duration}s`,
              animationDelay: `${flake.delay}s`,
              "--drift": `${flake.drift}px`,
              "--fall": fixed ? "110lvh" : "16rem",
            } as CSSProperties
          }
        >
          <Flake size={flake.size} />
        </span>
      ))}
      {fixed &&
        SNOW_LOGOS.map((logo, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
            key={i}
            className="xmas-snow absolute -top-12 block"
            style={
              {
                left: `${logo.left}%`,
                opacity: logo.opacity,
                animationDuration: `${logo.duration}s`,
                animationDelay: `${logo.delay}s`,
                "--drift": `${logo.drift}px`,
                "--fall": "calc(100lvh + 6rem)",
              } as CSSProperties
            }
          >
            <img
              src="/secret-santa-snow.webp"
              alt=""
              width={logo.size}
              height={logo.size}
              className="xmas-snow-logo block"
              style={{ animationDuration: `${logo.sway}s`, animationDelay: `${logo.delay}s` }}
              draggable={false}
            />
          </span>
        ))}
    </div>
  )
}

// ---- garland -----------------------------------------------------------------------------------

const BULB_COLORS = [XMAS.gold, XMAS.brand500, XMAS.white, XMAS.red, XMAS.sky, XMAS.gold, XMAS.pineLight]
const TILE = 120
/** Points on the wire's curve, and where the bulbs hang. */
const BULB_SPOTS = [
  { x: 20, y: 14 },
  { x: 60, y: 19 },
  { x: 100, y: 14 },
]

/** A garland of lights across the top: identical 120 px pieces repeated, so it never stretches. */
export function StringLights({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none flex h-10 overflow-hidden ${className}`}>
      {Array.from({ length: 36 }, (_, tile) => (
        <svg
          aria-hidden
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
          key={tile}
          width={TILE}
          height={40}
          viewBox={`0 0 ${TILE} 40`}
          className="shrink-0"
        >
          <path
            d={`M0 8 Q${TILE / 2} 30 ${TILE} 8`}
            fill="none"
            stroke={XMAS.brand800}
            strokeOpacity="0.55"
            strokeWidth="1.5"
          />
          {BULB_SPOTS.map((spot, i) => {
            const color = BULB_COLORS[(tile * 3 + i) % BULB_COLORS.length] as string
            const delay = `${-((tile * 3 + i) % 5) * 0.55}s`
            return (
              <g key={spot.x} transform={`translate(${spot.x} ${spot.y})`}>
                <circle
                  cy="9"
                  r="9"
                  fill={color}
                  opacity="0.25"
                  className="xmas-bulb"
                  style={{ animationDelay: delay }}
                />
                <rect x="-2" y="-1" width="4" height="4" rx="1" fill={XMAS.brand800} />
                <path
                  d="M0 3 C4.5 3 5 9 0 14 C-5 9 -4.5 3 0 3 Z"
                  fill={color}
                  stroke={XMAS.navy}
                  strokeOpacity="0.15"
                  className="xmas-bulb"
                  style={{ animationDelay: delay }}
                />
                <ellipse cx="-1.5" cy="7" rx="1" ry="2" fill="white" opacity="0.6" />
              </g>
            )
          })}
        </svg>
      ))}
    </div>
  )
}

// ---- landscape -----------------------------------------------------------------------------

/** A snowman with a PoliNetwork-blue scarf and beanie. */
function Snowman({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 110" className={className} aria-hidden>
      <ellipse cx="40" cy="104" rx="30" ry="5" fill={XMAS.frost} />
      {/* Stick arms */}
      <g stroke="oklch(42% 0.06 55)" strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d="M24 58 L6 46 M11 49 L6 43" />
        <path d="M56 58 L74 44 M69 47 L74 41" />
      </g>
      {/* Body, with a soft blue shade on the right */}
      <circle cx="40" cy="80" r="24" fill={XMAS.white} />
      <path d="M52 60 A24 24 0 0 1 40 104 A30 30 0 0 0 52 60 Z" fill={XMAS.frost} />
      <circle cx="40" cy="48" r="16" fill={XMAS.white} />
      <path d="M48 35 A16 16 0 0 1 40 64 A20 20 0 0 0 48 35 Z" fill={XMAS.frost} />
      <circle cx="40" cy="74" r="2.2" fill={XMAS.navy} />
      <circle cx="40" cy="84" r="2.2" fill={XMAS.navy} />
      <circle cx="40" cy="94" r="2.2" fill={XMAS.navy} />
      {/* Face */}
      <circle cx="34.5" cy="45" r="1.9" fill={XMAS.navy} />
      <circle cx="45.5" cy="45" r="1.9" fill={XMAS.navy} />
      <path d="M40 49 L52 52 L40 52.5 Z" fill="oklch(70% 0.17 50)" />
      <path d="M34 55 Q40 59 46 55" stroke={XMAS.navy} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="31" cy="51" r="2.4" fill={XMAS.red} opacity="0.25" />
      <circle cx="49" cy="51" r="2.4" fill={XMAS.red} opacity="0.25" />
      {/* Scarf */}
      <path d="M25 60 Q40 68 55 60 L55 66 Q40 74 25 66 Z" fill={XMAS.blue} />
      <path d="M48 64 L52 82 L45 82 L43 65 Z" fill={XMAS.blue} />
      <path d="M45 78 H52 M44.5 74 H51.5" stroke={XMAS.white} strokeWidth="1.4" opacity="0.7" />
      {/* Beanie */}
      <path d="M25 40 Q26 22 40 21 Q54 22 55 40 Z" fill={XMAS.blue} />
      <rect x="23" y="36" width="34" height="7" rx="3.5" fill={XMAS.brand800} />
      <circle cx="40" cy="19" r="5" fill={XMAS.white} stroke={XMAS.frost} strokeWidth="1.2" />
    </svg>
  )
}

/** Where the decorated trees stand: left/right edge in %, how high up the snow (% of the scene), size. */
const TREES = [
  { side: "left", at: 3, bottom: 30, size: "h-40 w-32 sm:h-56 sm:w-44" },
  // Hidden on phones: next to the big tree it would overlap it and the snowman.
  { side: "left", at: 13, bottom: 24, size: "hidden sm:block sm:h-40 sm:w-32" },
  { side: "left", at: 26, bottom: 44, size: "hidden sm:block sm:h-24 sm:w-20" },
  { side: "right", at: 4, bottom: 34, size: "h-36 w-28 sm:h-52 sm:w-40" },
  { side: "right", at: 15, bottom: 26, size: "hidden sm:block sm:h-36 sm:w-28" },
  { side: "right", at: 25, bottom: 46, size: "hidden sm:block sm:h-28 sm:w-22" },
] as const

/**
 * Snowy hills with decorated trees and snowmen, fixed behind the whole page. The hill shapes may
 * stretch (they are just curves); trees and snowmen are fixed-size pieces placed on top, so nothing
 * is ever cut off. The page content scrolls over it on white cards.
 */
export function SnowyHills() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 h-[46lvh] min-h-72 overflow-hidden"
    >
      <svg
        aria-hidden
        viewBox="0 0 1600 400"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <path d="M0 150 C220 70 480 90 760 140 S1320 70 1600 120 V400 H0 Z" fill="oklch(91% 0.035 240)" />
        <path d="M0 230 C320 150 620 180 900 220 S1400 160 1600 200 V400 H0 Z" fill="oklch(95% 0.022 240)" />
      </svg>
      <Snowman className="absolute right-[20%] bottom-[48%] hidden h-20 w-15 lg:block" />
      <svg
        aria-hidden
        viewBox="0 0 1600 400"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <path d="M0 300 C300 230 640 250 940 290 S1420 240 1600 270 V400 H0 Z" fill={XMAS.white} />
      </svg>
      <Snowman className="absolute bottom-[12%] left-[44%] h-24 w-17 sm:bottom-[14%] sm:left-[22%] sm:h-36 sm:w-26" />
      {TREES.map((tree) => (
        <span
          key={`${tree.side}-${tree.at}`}
          className={`absolute block ${tree.size}`}
          style={{ [tree.side]: `${tree.at}%`, bottom: `${tree.bottom}%` }}
        >
          <TreeIllustration className="h-full w-full" />
        </span>
      ))}
    </div>
  )
}

/** Santa on his sleigh with three reindeer, as a silhouette in PoliNetwork blue (and a red hat). */
function Sleigh({ className }: { className?: string }) {
  const reindeer = (x: number, phase: number) => (
    <g transform={`translate(${x} ${phase})`}>
      <ellipse cx="28" cy="20" rx="14" ry="6.5" />
      <path d="M37 17 L45 7 L50 9 L43 21 Z" />
      <ellipse cx="50" cy="7.5" rx="5.5" ry="3.2" />
      <path d="M12 18 L7 14 L10 19 Z" />
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M17 24 L10 33 M22 25 L19 35 M34 24 L41 31 M38 22 L47 27" />
        <path d="M47 5 L43 -3 M44 0 L39 -2 M51 4 L53 -4 M52.5 0 L57 -2" strokeWidth="1.6" />
      </g>
    </g>
  )
  return (
    <svg viewBox="-4 -16 312 66" className={className} aria-hidden style={{ color: XMAS.brand800 }}>
      <g fill="currentColor">
        {/* Reins */}
        <path
          d="M54 6 C 90 -2, 120 10, 148 14 M54 6 C 120 0, 180 12, 206 14 M54 6 C 160 -4, 230 10, 262 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.6"
        />
        {reindeer(100, 2)}
        {reindeer(156, -1)}
        {reindeer(212, 1)}
        {/* Sleigh */}
        <path d="M6 10 L10 30 L60 30 C70 30 74 22 72 14 L62 14 L58 22 L22 22 L18 10 Z" />
        <path
          d="M0 38 H66 C78 38 82 30 78 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path d="M18 30 V38 M54 30 V38" stroke="currentColor" strokeWidth="2" />
        {/* Sack and Santa */}
        <circle cx="20" cy="8" r="8" />
        <circle cx="42" cy="10" r="10" />
        <circle cx="46" cy="-3" r="5" />
        <path d="M41 -6 L49 -14 L51 -5 Z" fill={XMAS.red} />
        <circle cx="49" cy="-14" r="2" fill={XMAS.white} />
      </g>
    </svg>
  )
}

/** Santa crossing the sky now and then, behind everything. Hidden for reduced motion. */
export function FlyingSleigh() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-[14lvh] h-24 overflow-hidden">
      <div className="xmas-sleigh absolute top-0 left-0">
        <div className="xmas-sleigh-bob relative">
          <span className="absolute top-1/2 -left-24 h-px w-28 bg-gradient-to-r from-transparent to-amber-300/70" />
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="xmas-twinkle absolute size-1 rounded-full bg-amber-300"
              style={{
                left: `${-18 - i * 16}px`,
                top: `${46 + (i % 2) * 8}%`,
                animationDelay: `${-i * 0.4}s`,
              }}
            />
          ))}
          <Sleigh className="h-14 w-64 opacity-70 sm:h-16 sm:w-72" />
        </div>
      </div>
    </div>
  )
}

// ---- illustrations -----------------------------------------------------------------------

export function TreeIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 80" className={className} aria-hidden>
      <path d="M32 12 L50 38 H40 L56 60 H8 L24 38 H14 Z" fill={XMAS.pine} />
      <path d="M32 12 L41 25 H23 Z" fill={XMAS.pineLight} />
      <path
        d="M22 40 Q32 46 44 38 M17 54 Q32 60 48 52"
        stroke={XMAS.white}
        strokeOpacity="0.85"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="27" y="60" width="10" height="10" rx="2" fill="oklch(42% 0.06 55)" />
      <path
        d="M32 2 l2.4 4.9 5.4.8-3.9 3.8.9 5.4L32 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"
        fill={XMAS.gold}
        className="xmas-star"
      />
      {[
        [26, 32, XMAS.gold],
        [38, 44, XMAS.white],
        [20, 52, XMAS.sky],
        [44, 54, XMAS.gold],
        [33, 50, XMAS.red],
      ].map(([cx, cy, fill], i) => (
        <g
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
          key={i}
          transform={`translate(${cx} ${cy})`}
        >
          {i === 0 || i === 3 ? (
            <>
              <path d="M0 -7 V-4" stroke={XMAS.goldDark} strokeWidth="0.7" />
              <rect x="-1.2" y="-5" width="2.4" height="1.5" rx="0.4" fill={XMAS.gold} />
              <circle r="4.3" fill={XMAS.white} />
              <image href="/logo.png" x="-4" y="-4" width="8" height="8" />
            </>
          ) : (
            <circle
              r="2.6"
              fill={fill as string}
              className="xmas-bulb"
              style={{ animationDelay: `${-i * 0.7}s` }}
            />
          )}
        </g>
      ))}
    </svg>
  )
}

/**
 * How a GiftBox is wrapped: `tied` is the finished present; `open` has the lid ajar, tissue paper
 * showing and the ribbon lying loose; `tying` is `tied` playing the wrap once (lid settles, ribbon
 * runs down, bow pops). Under reduced motion `tying` simply shows the finished present.
 */
export type GiftWrap = "tied" | "open" | "tying"

/** The lid's pose while the present is still open; xmas-gift-lid starts from the same pose. */
const LID_AJAR: CSSProperties = {
  transformBox: "view-box",
  transformOrigin: "12px 54px",
  transform: "translate(2px, -14px) rotate(-12deg)",
}
const LID_ORIGIN: CSSProperties = { transformBox: "view-box", transformOrigin: "12px 54px" }

/** A present in PoliNetwork blue with a gold ribbon, optionally with a check badge on its corner. */
export function GiftBox({
  className,
  color = XMAS.blue,
  wrap = "tied",
  checked = false,
}: {
  className?: string
  color?: string
  wrap?: GiftWrap
  checked?: boolean
}) {
  const open = wrap === "open"
  const tying = wrap === "tying"
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden overflow="visible">
      <ellipse cx="60" cy="112" rx="40" ry="5" fill={XMAS.navy} opacity="0.12" />
      <rect x="18" y="50" width="84" height="60" rx="6" fill={color} />
      <rect x="18" y="50" width="84" height="10" fill={XMAS.navy} opacity="0.15" />
      {open ? (
        <>
          {/* Tissue paper peeking out, and the ribbon lying loose beside the box */}
          <path
            d="M24 52 L32 40 L42 50 L54 37 L64 49 L76 38 L86 50 L96 42 L98 52 Z"
            fill={XMAS.white}
            stroke={XMAS.sky}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M84 113 C94 104 104 118 112 108 C116 102 110 96 104 101"
            stroke={XMAS.gold}
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M8 112 C14 104 24 116 34 110"
            stroke={XMAS.goldDark}
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
          />
        </>
      ) : (
        <rect
          x="53"
          y="50"
          width="14"
          height="60"
          fill={XMAS.gold}
          className={tying ? "xmas-gift-ribbon" : undefined}
          style={tying ? { animationDelay: "380ms" } : undefined}
        />
      )}
      <g className={tying ? "xmas-gift-lid" : undefined} style={open ? LID_AJAR : LID_ORIGIN}>
        <rect x="12" y="36" width="96" height="18" rx="5" fill={color} />
        <rect x="12" y="36" width="96" height="18" rx="5" fill="white" opacity="0.15" />
        {!open && (
          <rect
            x="53"
            y="36"
            width="14"
            height="18"
            fill={XMAS.gold}
            className={tying ? "xmas-gift-ribbon" : undefined}
          />
        )}
      </g>
      {!open && (
        <g className={tying ? "xmas-gift-bow" : undefined}>
          <path d="M60 36 C46 14 22 22 34 32 C39 36 52 37 60 36 Z" fill={XMAS.gold} />
          <path d="M60 36 C74 14 98 22 86 32 C81 36 68 37 60 36 Z" fill={XMAS.goldDark} />
          <circle cx="60" cy="35" r="6" fill={XMAS.goldDark} />
        </g>
      )}
      {checked && (
        <g className={tying ? "xmas-gift-check" : undefined}>
          <circle cx="104" cy="50" r="13" fill={XMAS.pine} stroke={XMAS.white} strokeWidth="3" />
          <path
            d="M98 50.5 L102.5 55 L110.5 46"
            stroke={XMAS.white}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      )}
    </svg>
  )
}

/** A small present with a big question mark: the secret gadget, never drawn as anything real. */
export function MysteryGift({ className, muted = false }: { className?: string; muted?: boolean }) {
  const box = muted ? XMAS.sky : XMAS.blue
  return (
    <svg viewBox="0 0 48 52" className={className} aria-hidden>
      <ellipse cx="24" cy="49" rx="16" ry="2.5" fill={XMAS.navy} opacity="0.1" />
      <rect x="7" y="21" width="34" height="27" rx="3.5" fill={box} />
      <rect x="7" y="21" width="34" height="4" fill={XMAS.navy} opacity="0.12" />
      <rect x="4" y="14" width="40" height="9" rx="3" fill={box} />
      <rect x="4" y="14" width="40" height="9" rx="3" fill="white" opacity="0.15" />
      <rect x="21" y="14" width="6" height="9" fill={muted ? XMAS.white : XMAS.gold} />
      <path
        d="M24 14 C18 4 8 8 13 12.5 C15 14 20 14.5 24 14 Z M24 14 C30 4 40 8 35 12.5 C33 14 28 14.5 24 14 Z"
        fill={muted ? XMAS.white : XMAS.gold}
      />
      <circle cx="24" cy="13.5" r="2.6" fill={muted ? XMAS.frost : XMAS.goldDark} />
      <path
        d="M19.5 31 C19.5 27.5 22 26 24.2 26 C26.8 26 28.8 27.8 28.8 30.2 C28.8 33.6 24.3 33.4 24.3 37"
        stroke={XMAS.white}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="24.3" cy="42" r="1.9" fill={XMAS.white} />
    </svg>
  )
}

/** A four-point Christmas star (viewBox 0 0 20 20), shared by every sparkle on the page. */
export const SPARKLE_PATH = "M10 0 C11 6 14 9 20 10 C14 11 11 14 10 20 C9 14 6 11 0 10 C6 9 9 6 10 0 Z"

const BURST = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * Math.PI * 2 + scatter(i, 10) * 0.4
  const distance = 100 + scatter(i, 11) * 80
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance - 40,
    rotate: (scatter(i, 12) - 0.5) * 360,
    color: [XMAS.gold, XMAS.brand500, XMAS.sky, XMAS.goldDark][i % 4] as string,
    star: i % 3 !== 1,
    delay: scatter(i, 13) * 0.12,
  }
})

/** Stars and gold confetti flying out from the center, once, `delay` seconds after it mounts. */
export function Burst({ delay = 0 }: { delay?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-50">
      {BURST.map((piece, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
          key={i}
          className="xmas-burst absolute block"
          style={
            {
              "--x": `${piece.x}px`,
              "--y": `${piece.y}px`,
              "--r": `${piece.rotate}deg`,
              animationDelay: `${delay + piece.delay}s`,
              color: piece.color,
            } as CSSProperties
          }
        >
          {piece.star ? (
            <svg viewBox="0 0 20 20" className="size-4 -translate-1/2" fill="currentColor" aria-hidden>
              <path d={SPARKLE_PATH} />
            </svg>
          ) : (
            <span className="block h-2 w-1.5 -translate-1/2 rounded-sm" style={{ background: piece.color }} />
          )}
        </span>
      ))}
    </div>
  )
}

/** One four-point star. A white one gets a gold outline, so it shows on ice and on gold. */
export function Sparkle({
  className,
  color,
  style,
}: {
  className?: string
  color: string
  style?: CSSProperties
}) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={className} style={style}>
      <path
        d={SPARKLE_PATH}
        fill={color}
        {...(color === XMAS.white ? { stroke: XMAS.goldDark, strokeWidth: 1.2 } : {})}
      />
    </svg>
  )
}

const SPARKS = Array.from({ length: 6 }, (_, i) => {
  const angle = (i / 6) * Math.PI * 2 + scatter(i, 20) * 0.5
  const distance = 30 + scatter(i, 21) * 20
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    rotate: (scatter(i, 22) - 0.5) * 180,
    color: [XMAS.gold, XMAS.white, XMAS.sky, XMAS.goldDark, XMAS.gold, XMAS.white][i] as string,
    size: i % 2 ? "size-3" : "size-4",
    delay: scatter(i, 23) * 0.04,
  }
})

/** Six little stars jumping off the wax seal when the elf's candy cane hits it. */
export function Sparks() {
  return (
    <div aria-hidden className="pointer-events-none absolute top-[58%] left-1/2 z-[45]">
      {SPARKS.map((spark, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
          key={i}
          className="xmas-spark absolute block"
          style={
            {
              "--x": `${spark.x}px`,
              "--y": `${spark.y}px`,
              "--r": `${spark.rotate}deg`,
              animationDelay: `calc(var(--open) * 0.28 + ${spark.delay}s)`,
            } as CSSProperties
          }
        >
          <Sparkle className={`${spark.size} -translate-1/2`} color={spark.color} />
        </span>
      ))}
    </div>
  )
}

// ---- elves ---------------------------------------------------------------------------------

const SKIN = "oklch(88% 0.05 60)"
const SKIN_SHADE = "oklch(80% 0.06 55)"
const EAR_INNER = "oklch(78% 0.08 25)"

/**
 * A little elf in a PoliNetwork-blue tunic, drawn facing right (mirror it with `-scale-x-100`).
 * Arms rotate about the shoulders (22,46 and 42,46 in the 64x84 viewBox): 0 hangs down, -90 points
 * forward, -170 straight up, positive swings back. The rest angles apply when no animation runs.
 */
export function Elf({
  hat,
  holding,
  className,
  style,
  frontArmRest = 0,
  backArmRest = 0,
  frontArmClassName,
  backArmClassName,
  eyesClassName,
}: {
  hat: string
  holding?: "cane" | "gift"
  className?: string
  style?: CSSProperties
  frontArmRest?: number
  backArmRest?: number
  frontArmClassName?: string
  backArmClassName?: string
  eyesClassName?: string
}) {
  return (
    <svg viewBox="0 0 64 84" aria-hidden className={className} style={style}>
      <ellipse cx="32" cy="81" rx="16" ry="3" fill={XMAS.navy} opacity="0.12" />
      <g
        className={backArmClassName}
        style={{
          transformBox: "view-box",
          transformOrigin: "22px 46px",
          transform: `rotate(${backArmRest}deg)`,
        }}
      >
        <rect x="19.5" y="45" width="5" height="14" rx="2.5" fill={XMAS.brand500} />
        <circle cx="22" cy="60" r="3" fill={SKIN_SHADE} />
      </g>
      <rect x="24" y="64" width="6" height="12" rx="2" fill={XMAS.brand800} />
      <rect x="34" y="64" width="6" height="12" rx="2" fill={XMAS.brand800} />
      <path d="M23 75 H31 Q35 75 37 72 Q37 78 31 79 H23 Z" fill={hat} />
      <path d="M33 75 H41 Q45 75 47 72 Q47 78 41 79 H33 Z" fill={hat} />
      <circle cx="37" cy="72" r="1.6" fill={XMAS.gold} />
      <circle cx="47" cy="72" r="1.6" fill={XMAS.gold} />
      {/* Tunic, collar, belt */}
      <path
        d="M20 44 Q32 40 44 44 L48 66 L44 62 L40 67 L36 62 L32 67 L28 62 L24 67 L20 62 L16 66 Z"
        fill={XMAS.blue}
      />
      <path d="M21 44 L25 49 L29 44 L32 49 L35 44 L39 49 L43 44 Z" fill={hat} />
      <rect x="18" y="56" width="28" height="4" fill={XMAS.navy} />
      <rect x="29.5" y="55.5" width="5" height="5" rx="1" fill="none" stroke={XMAS.gold} strokeWidth="1.4" />
      {/* Pointy ears, then the head */}
      <path d="M22 31 L11 24 L21.5 37 Z" fill={SKIN} />
      <path d="M42 31 L53 24 L42.5 37 Z" fill={SKIN} />
      <path d="M20 31 L14.5 27 L20 34 Z" fill={EAR_INNER} />
      <path d="M44 31 L49.5 27 L44 34 Z" fill={EAR_INNER} />
      <circle cx="32" cy="32" r="11" fill={SKIN} />
      <g className={eyesClassName} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        <circle cx="29.5" cy="32" r="1.6" fill={XMAS.navy} />
        <circle cx="37.5" cy="32" r="1.6" fill={XMAS.navy} />
      </g>
      <circle cx="34" cy="35" r="1.5" fill="oklch(80% 0.08 35)" />
      <circle cx="26.5" cy="36" r="2.2" fill={XMAS.red} opacity="0.25" />
      <circle cx="40" cy="36" r="2.2" fill={XMAS.red} opacity="0.25" />
      <path
        d="M30 38.5 Q33.5 41.5 37 38.5"
        stroke={XMAS.navy}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      {/* Hat */}
      <path d="M20 27 Q21 12 33 9 Q46 6 54 14 Q46 13 43 22 L44 27 Z" fill={hat} />
      <rect
        x="19"
        y="23.5"
        width="26"
        height="5"
        rx="2.5"
        fill={XMAS.white}
        stroke={XMAS.frost}
        strokeWidth="1.2"
      />
      <circle cx="55" cy="15" r="3.5" fill={XMAS.white} stroke={XMAS.frost} strokeWidth="1.2" />
      <g
        className={frontArmClassName}
        style={{
          transformBox: "view-box",
          transformOrigin: "42px 46px",
          transform: `rotate(${frontArmRest}deg)`,
        }}
      >
        <rect x="39.5" y="45" width="5" height="14" rx="2.5" fill={XMAS.blue} />
        {holding === "cane" && (
          <>
            <path
              d="M42 58 V74 a4 4 0 0 0 8 0"
              stroke={XMAS.white}
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M42 58 V74 a4 4 0 0 0 8 0"
              stroke={XMAS.red}
              strokeWidth="3"
              strokeDasharray="2.5 2.5"
              fill="none"
            />
          </>
        )}
        <circle cx="42" cy="60" r="3" fill={SKIN} />
      </g>
      {holding === "gift" && (
        <g>
          <rect x="37" y="46" width="16" height="11" rx="1.5" fill={XMAS.red} />
          <rect x="36" y="43.5" width="18" height="4" rx="1" fill={XMAS.redDark} />
          <rect x="43.5" y="43.5" width="3" height="13.5" fill={XMAS.gold} />
          <ellipse cx="42.5" cy="42.3" rx="2.5" ry="1.6" fill={XMAS.gold} />
          <ellipse cx="47.5" cy="42.3" rx="2.5" ry="1.6" fill={XMAS.gold} />
          <circle cx="45" cy="43.3" r="1.2" fill={XMAS.goldDark} />
        </g>
      )}
    </svg>
  )
}

/** A little cloud of snow kicked up where an elf pops out. */
export function SnowPuff({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 40 12" aria-hidden className={className} style={style}>
      <g fill={XMAS.white} stroke={XMAS.frost} strokeWidth="1">
        <ellipse cx="9" cy="8" rx="7" ry="3.5" />
        <ellipse cx="20" cy="7" rx="8" ry="4" />
        <ellipse cx="31" cy="8" rx="7" ry="3.5" />
      </g>
    </svg>
  )
}

/** Postage stamp for the corner of the letter. `paper` is the colour around it, for the perforations. */
export function Stamp({ className, paper, year }: { className?: string; paper: string; year: number }) {
  const holes = [
    ...Array.from({ length: 6 }, (_, i) => [4 + i * 8, 0]),
    ...Array.from({ length: 6 }, (_, i) => [4 + i * 8, 56]),
    ...Array.from({ length: 7 }, (_, i) => [0, 4 + i * 8]),
    ...Array.from({ length: 7 }, (_, i) => [48, 4 + i * 8]),
  ]
  return (
    <svg viewBox="0 0 48 56" className={className} aria-hidden>
      <rect width="48" height="56" fill={XMAS.white} />
      {holes.map(([cx, cy], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
        <circle key={i} cx={cx} cy={cy} r="2.2" fill={paper} />
      ))}
      <rect x="6" y="6" width="36" height="44" rx="1.5" fill={XMAS.blue} />
      <path d="M24 13 L33 27 H29 L36 38 H12 L19 27 H15 Z" fill={XMAS.white} opacity="0.9" />
      <circle cx="24" cy="12" r="2" fill={XMAS.gold} />
      <text x="24" y="47" textAnchor="middle" fontSize="6" fontWeight="700" fill={XMAS.white}>
        {year}
      </text>
    </svg>
  )
}

// ---- icons -------------------------------------------------------------------------------

const ICONS = {
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M8 2.5v4M16 2.5v4M3 10h18" />
    </>
  ),
  shuffle: <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </>
  ),
  coins: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.1 10.4A6 6 0 1 1 10.3 18M7 6h1v4M16.7 13.9l.7.7-2.8 2.8" />
    </>
  ),
  ticket: (
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM13 5v2M13 17v2M13 11v2" />
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2.5" />
      <path d="m22 7-10 6L2 7" />
    </>
  ),
  check: <path d="M4 12.5 9.5 18 20 6.5" />,
  heart: (
    <path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m5.3 5.3 13.4 13.4" />
    </>
  ),
  star: <path d="M12 2.5 14.9 8.6l6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8Z" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

/** Small line icons (24 px grid, drawn for this page). */
export function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  )
}
