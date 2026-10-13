import { memoryQuizUI } from "./memory-quiz/ui.tsx"
import { numberEstimateUI } from "./number-estimate/ui.tsx"
import { numberLotteryUI } from "./number-lottery/ui.tsx"
import { pollUI } from "./poll/ui.tsx"
import { purchaseInterestUI } from "./purchase-interest/ui.tsx"
import type { AnyActivityUI } from "./ui-types.ts"
import { wheelUI } from "./wheel/ui.tsx"
import { wordCloudUI } from "./word-cloud/ui.tsx"

/** Browser components for every activity type. Keep in sync with `registry.ts`. */
export const activityUIs: Record<string, AnyActivityUI> = {
  [numberEstimateUI.definition.type]: numberEstimateUI,
  [memoryQuizUI.definition.type]: memoryQuizUI,
  [numberLotteryUI.definition.type]: numberLotteryUI,
  [pollUI.definition.type]: pollUI,
  [purchaseInterestUI.definition.type]: purchaseInterestUI,
  [wheelUI.definition.type]: wheelUI,
  [wordCloudUI.definition.type]: wordCloudUI,
}
