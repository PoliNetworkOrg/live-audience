import logo from "./assets/logo.svg"
import wire from "./assets/wire.svg"
import { cx } from "./ui.tsx"

/** PoliNetwork's look, from the slides: shapes in the background, the logo and its wordmark. */

/** Soft blue shapes and white curves behind everything. `calm` tones them down. */
export function Backdrop({ calm = false }: { calm?: boolean }) {
  return (
    <div aria-hidden className={cx("pn-bg", calm && "calm")}>
      <div className="shape s-looper" />
      <div className="shape s-teal" />
      <div className="shape s-blue" />
      <div className="shape s-small" />
      <img className="wire" src={wire} alt="" />
    </div>
  )
}

/** Logo and "PoliNetwork", as in the header of the website, plus what this app is. */
export function Wordmark({ suffix, className }: { suffix?: string; className?: string }) {
  return (
    <span className={cx("flex items-center gap-2.5", className)}>
      <img src={logo} alt="" className="size-8" />
      <span className="font-headline text-lg leading-none text-pn">PoliNetwork</span>
      {suffix && (
        <span className="kicker border-l border-sky-700/25 pl-2.5 leading-none tracking-[0.18em]">
          {suffix}
        </span>
      )}
    </span>
  )
}

/** The logo inside slowly turning glass rings, like on the cover of the slides. */
export function Orbit({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx("orbit", className)}>
      <span className="ring r1" />
      <span className="ring r2" />
      <span className="ring r3" />
      <img src={logo} alt="" />
    </div>
  )
}
