import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react"

/** A handful of plain primitives shared by the admin page and the activity editors. */

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}

const buttonVariants = {
  primary:
    "bg-pn text-white shadow-[0_10px_24px_-12px_rgb(17_86_174/0.7)] hover:bg-pn-deep disabled:bg-pn/40 disabled:shadow-none",
  secondary:
    "bg-white/70 text-slate-700 ring-[1.5px] ring-slate-300/80 ring-inset hover:bg-white disabled:text-slate-400",
  danger:
    "bg-white/70 text-rose-600 ring-[1.5px] ring-rose-300 ring-inset hover:bg-rose-50 disabled:text-rose-300",
  ghost: "text-pn hover:bg-white/80 disabled:text-slate-400 disabled:hover:bg-transparent",
  success:
    "bg-emerald-600 text-white shadow-[0_10px_24px_-12px_rgb(5_150_105/0.7)] hover:bg-emerald-700 disabled:bg-emerald-600/40 disabled:shadow-none",
}

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition disabled:cursor-not-allowed [&>svg]:size-4",
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  )
}

const fieldClass =
  "w-full rounded-xl border-[1.5px] border-white bg-white/75 px-3 py-2 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgb(17_86_174/0.08)] outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-400/20"

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldClass, className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldClass, "min-h-20", className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(fieldClass, "pr-8", className)} {...props} />
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="block space-y-2">
      <span className="label-caps block">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("glass-solid p-6", className)}>{children}</div>
}

/** A small rounded tag: what an activity is, whether it is on stage… */
export function Tag({
  tone = "plain",
  className,
  children,
}: {
  tone?: "plain" | "blue" | "live" | "warn"
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5",
        tone === "plain" && "bg-white/70 text-slate-600 ring-[1.5px] ring-slate-300/70 ring-inset",
        tone === "blue" && "bg-sky-700 text-white",
        tone === "live" && "bg-emerald-600 text-white",
        tone === "warn" && "bg-amber-400 text-amber-950",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A horizontal bar from 0 to `max`, like the ones on the slides. */
export function Bar({ value, max = 100, className }: { value: number; max?: number; className?: string }) {
  return (
    <div className={cx("bar-track h-2.5", className)}>
      <div className="bar-fill" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
    </div>
  )
}

/** Generates short ids for things like poll options, so labels can change without losing votes. */
export function shortId() {
  return Math.random().toString(36).slice(2, 8)
}
