import { poll } from "./poll/definition.ts"
import type { AnyActivityDefinition } from "./types.ts"

/** Every activity type the app knows. Add new ones here (and in `ui-registry.ts`). */
export const activityDefinitions: Record<string, AnyActivityDefinition> = {
  [poll.type]: poll,
}

export function getActivityDefinition(type: string): AnyActivityDefinition | undefined {
  return activityDefinitions[type]
}
