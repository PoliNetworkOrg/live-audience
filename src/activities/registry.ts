import { memoryQuiz } from "./memory-quiz/definition.ts"
import { numberEstimate } from "./number-estimate/definition.ts"
import { numberLottery } from "./number-lottery/definition.ts"
import { poll } from "./poll/definition.ts"
import { purchaseInterest } from "./purchase-interest/definition.ts"
import type { AnyActivityDefinition } from "./types.ts"
import { wheel } from "./wheel/definition.ts"
import { wordCloud } from "./word-cloud/definition.ts"

/** Every activity type the app knows. Add new ones here (and in `ui-registry.ts`). */
export const activityDefinitions: Record<string, AnyActivityDefinition> = {
  [numberEstimate.type]: numberEstimate,
  [memoryQuiz.type]: memoryQuiz,
  [numberLottery.type]: numberLottery,
  [poll.type]: poll,
  [purchaseInterest.type]: purchaseInterest,
  [wheel.type]: wheel,
  [wordCloud.type]: wordCloud,
}

export function getActivityDefinition(type: string): AnyActivityDefinition | undefined {
  return activityDefinitions[type]
}
