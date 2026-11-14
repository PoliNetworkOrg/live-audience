import type { CSSProperties } from "react"

/**
 * Hand-drawn Christmas decorations for the Secret Santa page. Purely decorative: every one is
 * aria-hidden, and every animation stops for people who ask for reduced motion (see styles.css).
 */

export const XMAS = {
  night: "oklch(17% 0.045 255)",
  pine: "oklch(30% 0.075 160)",
  pineLight: "oklch(62% 0.13 155)",
  red: "oklch(60% 0.2 25)",
  redDark: "oklch(48% 0.17 25)",
  gold: "oklch(86% 0.14 88)",
  goldDark: "oklch(74% 0.14 75)",
  snow: "oklch(96% 0.012 240)",
  snowShade: "oklch(86% 0.03 245)",
  sky: "oklch(78% 0.1 230)",
}

/** Deterministic pseudo-random numbers, so decorations look scattered but never jump on re-render. */
function scatter(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

const STARS = Array.from({ length: 46 }, (_, i) => ({
  left: scatter(i, 1) * 100,
  top: scatter(i, 2) * 60,
  size: 1 + Math.round(scatter(i, 3) * 2),
  delay: -scatter(i, 4) * 4,
  duration: 2.5 + scatter(i, 5) * 3,
}))

export function StarrySky() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0">
      {STARS.map((star, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
          key={i}
          className="xmas-twinkle absolute rounded-full bg-white"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            animationDelay: `${star.delay}s`,
            animationDuration: `${star.duration}s`,
          }}
        />
      ))}
    </div>
  )
}

export function Moon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <mask id="xmas-moon">
          <rect width="40" height="40" fill="white" />
          <circle cx="27" cy="15" r="14" fill="black" />
        </mask>
        <radialGradient id="xmas-moon-glow">
          <stop offset="0.45" stopColor={XMAS.gold} stopOpacity="0.35" />
          <stop offset="1" stopColor={XMAS.gold} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill="url(#xmas-moon-glow)" />
      <circle cx="20" cy="20" r="12" fill={XMAS.gold} mask="url(#xmas-moon)" />
    </svg>
  )
}

/** Three layers of snow: small and slow far away, bigger and faster up close. */
const FLAKES = Array.from({ length: 42 }, (_, i) => {
  const layer = i % 3
  return {
    left: scatter(i, 6) * 100,
    size: [2, 4, 6][layer] as number,
    opacity: [0.35, 0.6, 0.85][layer] as number,
    duration: ([22, 15, 10][layer] as number) + scatter(i, 7) * 6,
    delay: -scatter(i, 8) * 24,
    drift: (scatter(i, 9) - 0.5) * 80,
    blur: layer === 2 && i % 2 === 0,
  }
})

export function Snowfall({ fixed = true }: { fixed?: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none inset-0 overflow-hidden ${fixed ? "fixed" : "absolute"}`}
    >
      {FLAKES.map((flake, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
          key={i}
          className="xmas-snow absolute -top-4 rounded-full bg-white"
          style={
            {
              left: `${flake.left}%`,
              width: flake.size,
              height: flake.size,
              opacity: flake.opacity,
              filter: flake.blur ? "blur(1px)" : undefined,
              animationDuration: `${flake.duration}s`,
              animationDelay: `${flake.delay}s`,
              "--drift": `${flake.drift}px`,
              "--fall": fixed ? "110vh" : "60rem",
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

const BULB_COLORS = [XMAS.red, XMAS.gold, XMAS.pineLight, XMAS.sky]

/** A garland of lights draped across the top of the page. */
export function StringLights() {
  const wireY = (x: number) => 14 + Math.sin((x / 400) * Math.PI * 12 - Math.PI / 2) * 6
  const bulbs = Array.from({ length: 24 }, (_, i) => {
    const x = 8 + i * (384 / 23)
    return { x, y: wireY(x) + 5, color: BULB_COLORS[i % BULB_COLORS.length] as string, delay: -(i % 5) * 0.6 }
  })
  const wire = Array.from(
    { length: 81 },
    (_, i) => `${i ? "L" : "M"}${i * 5} ${wireY(i * 5).toFixed(1)}`,
  ).join(" ")
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 44"
      preserveAspectRatio="xMidYMin slice"
      className="pointer-events-none absolute inset-x-0 top-0 h-11 w-full"
    >
      <path d={wire} fill="none" stroke="oklch(30% 0.03 160)" strokeWidth="1.5" />
      {bulbs.map((bulb, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
        <g key={i} transform={`translate(${bulb.x} ${bulb.y})`}>
          <circle
            r="7"
            fill={bulb.color}
            opacity="0.25"
            className="xmas-bulb"
            style={{ animationDelay: `${bulb.delay}s` }}
          />
          <rect x="-1.6" y="-5" width="3.2" height="3" rx="0.8" fill="oklch(40% 0.02 160)" />
          <ellipse
            cy="1.5"
            rx="2.8"
            ry="4"
            fill={bulb.color}
            className="xmas-bulb"
            style={{ animationDelay: `${bulb.delay}s` }}
          />
        </g>
      ))}
    </svg>
  )
}

function Pine({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 -26 L9 -10 H5 L12 2 H-12 L-5 -10 H-9 Z" fill={XMAS.pine} />
      <path d="M0 -26 L5 -17 H-5 Z" fill={XMAS.snow} />
      <path d="M-12 2 H12 L9 -1 H-9 Z" fill={XMAS.snow} opacity="0.8" />
      <rect x="-1.5" y="2" width="3" height="4" fill="oklch(40% 0.06 55)" />
    </g>
  )
}

/** Snowy hills with pines and a little cottage, at the very bottom of the page. */
export function SnowyHills() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 110"
      preserveAspectRatio="xMidYMax slice"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[24vh] max-h-56 min-h-32 w-full"
    >
      <path d="M0 62 Q70 30 150 52 T300 44 T400 50 V110 H0 Z" fill={XMAS.snowShade} opacity="0.55" />
      <Pine x={40} y={52} scale={0.8} />
      <Pine x={58} y={50} scale={1} />
      <Pine x={350} y={48} scale={0.9} />
      <Pine x={372} y={52} scale={0.7} />
      <g transform="translate(250 50)">
        <rect x="-16" y="-14" width="32" height="20" fill="oklch(45% 0.09 35)" />
        <path d="M-20 -13 L0 -30 L20 -13 Z" fill={XMAS.snow} />
        <rect x="8" y="-30" width="5" height="10" fill="oklch(40% 0.07 35)" />
        <rect x="-10" y="-8" width="7" height="7" rx="1" fill={XMAS.gold} className="xmas-window" />
        <rect x="3" y="-6" width="7" height="12" rx="1" fill="oklch(32% 0.06 35)" />
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx="10.5"
            cy="-33"
            r="2.4"
            fill={XMAS.snow}
            className="xmas-smoke"
            style={{ animationDelay: `${i * 1.1}s` }}
          />
        ))}
      </g>
      <path d="M0 80 Q90 54 200 72 T400 66 V110 H0 Z" fill={XMAS.snow} />
      <Pine x={120} y={74} scale={1.2} />
      <Pine x={142} y={76} scale={0.9} />
      <Pine x={320} y={72} scale={1.1} />
    </svg>
  )
}

export function TreeIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 80" className={className} aria-hidden>
      <path d="M32 12 L50 38 H40 L56 60 H8 L24 38 H14 Z" fill={XMAS.pineLight} />
      <path d="M32 12 L41 25 H23 Z" fill="oklch(70% 0.13 150)" />
      <rect x="27" y="60" width="10" height="10" rx="2" fill="oklch(48% 0.07 55)" />
      <path
        d="M32 2 l2.4 4.9 5.4.8-3.9 3.8.9 5.4L32 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"
        fill={XMAS.gold}
        className="xmas-star"
      />
      {[
        [26, 32, XMAS.red],
        [38, 44, XMAS.gold],
        [20, 52, XMAS.red],
        [44, 54, XMAS.sky],
        [33, 50, XMAS.gold],
      ].map(([cx, cy, fill], i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
          key={i}
          cx={cx}
          cy={cy}
          r="2.4"
          fill={fill as string}
          className="xmas-bulb"
          style={{ animationDelay: `${-i * 0.7}s` }}
        />
      ))}
      <path d="M22 40 Q32 46 44 38" stroke={XMAS.snow} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/** A wrapped present whose lid is a separate group, so it can fly off when opened. */
export function GiftBox({ className, lidClassName }: { className?: string; lidClassName?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <ellipse cx="60" cy="112" rx="40" ry="5" fill="black" opacity="0.25" />
      <rect x="18" y="50" width="84" height="60" rx="6" fill={XMAS.redDark} />
      <rect x="18" y="50" width="84" height="10" fill="black" opacity="0.12" />
      <rect x="53" y="50" width="14" height="60" fill={XMAS.gold} />
      <circle cx="34" cy="80" r="2.5" fill={XMAS.snow} opacity="0.6" />
      <circle cx="84" cy="92" r="2.5" fill={XMAS.snow} opacity="0.6" />
      <circle cx="38" cy="100" r="2" fill={XMAS.snow} opacity="0.6" />
      <circle cx="82" cy="68" r="2" fill={XMAS.snow} opacity="0.6" />
      <g className={lidClassName}>
        <rect x="12" y="36" width="96" height="18" rx="5" fill={XMAS.red} />
        <rect x="53" y="36" width="14" height="18" fill={XMAS.gold} />
        <path d="M60 36 C46 14 22 22 34 32 C39 36 52 37 60 36 Z" fill={XMAS.gold} />
        <path d="M60 36 C74 14 98 22 86 32 C81 36 68 37 60 36 Z" fill={XMAS.goldDark} />
        <circle cx="60" cy="35" r="6" fill={XMAS.goldDark} />
      </g>
    </svg>
  )
}

const BURST = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + scatter(i, 10) * 0.4
  const distance = 90 + scatter(i, 11) * 70
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance - 30,
    rotate: (scatter(i, 12) - 0.5) * 360,
    color: [XMAS.gold, XMAS.red, XMAS.pineLight, XMAS.snow][i % 4] as string,
    star: i % 3 === 0,
    delay: scatter(i, 13) * 0.12,
  }
})

/** Stars and confetti flying out from the center, once. */
export function Burst() {
  return (
    <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2">
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
              animationDelay: `${piece.delay}s`,
              color: piece.color,
            } as CSSProperties
          }
        >
          {piece.star ? (
            <svg viewBox="0 0 20 20" className="size-4 -translate-1/2" fill="currentColor" aria-hidden>
              <path d="M10 0 l2.9 6.6 7.1.7-5.4 4.8 1.6 7L10 15.4 3.8 19.1l1.6-7L0 7.3l7.1-.7z" />
            </svg>
          ) : (
            <span className="block h-2 w-1.5 -translate-1/2 rounded-sm" style={{ background: piece.color }} />
          )}
        </span>
      ))}
    </div>
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
      <rect width="48" height="56" fill={XMAS.snow} />
      {holes.map(([cx, cy], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
        <circle key={i} cx={cx} cy={cy} r="2.2" fill={paper} />
      ))}
      <rect x="6" y="6" width="36" height="44" rx="1.5" fill={XMAS.pine} />
      <path d="M24 13 L33 27 H29 L36 38 H12 L19 27 H15 Z" fill={XMAS.pineLight} />
      <circle cx="24" cy="12" r="2" fill={XMAS.gold} />
      <text x="24" y="47" textAnchor="middle" fontSize="6" fontWeight="700" fill={XMAS.gold}>
        {year}
      </text>
    </svg>
  )
}
