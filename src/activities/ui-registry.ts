import { pollUI } from "./poll/ui.tsx"
import type { AnyActivityUI } from "./ui-types.ts"

/** Browser components for every activity type. Keep in sync with `registry.ts`. */
export const activityUIs: Record<string, AnyActivityUI> = {
  [pollUI.definition.type]: pollUI,
}
