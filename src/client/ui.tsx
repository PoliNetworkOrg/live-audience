import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { Icon } from "./icons.tsx"

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

export interface SelectOption {
  value: string
  label: string
  /** A second, smaller line in the menu. */
  description?: string
}

/**
 * A dropdown in the theme instead of the browser's: a field-like button and a glass menu.
 * Focus stays on the button, which drives the menu from the keyboard like a native select.
 */
export function Select({
  value,
  options,
  onChange,
  className,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
}) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const selected = options.find((option) => option.value === value)

  const show = () => {
    setActive(Math.max(0, options.indexOf(selected as SelectOption)))
    setPosition(null)
    setOpen(true)
  }
  const choose = (option: SelectOption | undefined) => {
    setOpen(false)
    button.current?.focus()
    if (option && option.value !== value) onChange(option.value)
  }

  // Lives in a portal, so no card can clip or cover it: follow the button, close on clicks elsewhere.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!button.current || !menu.current) return
      const anchor = button.current.getBoundingClientRect()
      const gap = 6
      const margin = 8
      const width = Math.max(menu.current.offsetWidth, anchor.width)
      const below = window.innerHeight - anchor.bottom - gap - margin
      const above = anchor.top - gap - margin
      const up = menu.current.scrollHeight > below && above > below
      setPosition({
        left: Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)),
        minWidth: anchor.width,
        maxHeight: Math.min(320, up ? above : below),
        ...(up ? { bottom: window.innerHeight - anchor.top + gap } : { top: anchor.bottom + gap }),
      })
    }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!button.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    document.addEventListener("pointerdown", outside)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
      document.removeEventListener("pointerdown", outside)
    }
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" })
  }, [open, active, id])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1
    const move = (index: number) => {
      event.preventDefault()
      if (open) setActive(Math.max(0, Math.min(last, index)))
      else show()
    }
    if (event.key === "ArrowDown") move(active + 1)
    else if (event.key === "ArrowUp") move(active - 1)
    else if (event.key === "Home") move(0)
    else if (event.key === "End") move(last)
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      if (open) choose(options[active])
      else show()
    } else if (event.key === "Escape" && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    } else if (event.key === "Tab") setOpen(false)
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      // Type-ahead: jump to the next option starting with that letter.
      const key = event.key.toLowerCase()
      const order = options.map((_, i) => (active + 1 + i) % options.length)
      const match = order.find((i) => options[i]?.label.toLowerCase().startsWith(key))
      if (match === undefined) return
      if (open) setActive(match)
      else onChange(options[match]?.value ?? value)
    }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className={cx(
          fieldClass,
          "flex min-w-0 items-center justify-between gap-2 text-left",
          open && "border-blue-400 bg-white ring-4 ring-blue-400/20",
          className,
        )}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={cx("truncate", !selected && "text-slate-400")}>{selected?.label ?? "—"}</span>
        <Icon
          name="chevron-down"
          className={cx("size-4 shrink-0 text-sky-700 transition", open && "rotate-180")}
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            role="listbox"
            className="glass-solid animate-menu-in fixed z-50 w-max max-w-sm overflow-auto p-1.5"
            style={position ?? { visibility: "hidden", top: 0, left: 0 }}
            // Keep the focus on the button.
            onMouseDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the button handles the keyboard (aria-activedescendant)
                <div
                  key={option.value}
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  className={cx(
                    "flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                    index === active ? "bg-blue-400/15" : "",
                    isSelected ? "text-pn" : "text-slate-800",
                  )}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className={cx("block", isSelected && "font-medium")}>{option.label}</span>
                    {option.description && (
                      <span className="block text-xs text-pretty text-slate-500">{option.description}</span>
                    )}
                  </span>
                  <Icon name="check" className={cx("mt-0.5 size-4 shrink-0", !isSelected && "invisible")} />
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
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
