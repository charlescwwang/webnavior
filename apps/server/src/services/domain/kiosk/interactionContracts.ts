/** Diagnostic outcomes are not execution authority or proof of a completed operation. */
export const decisionRoutes = ['fast_path', 'execution_failed', 'unavailable'] as const

/** Device-written interaction metadata; keep producer and validating route in sync. */
export interface InteractionMetadata {
  decisionRoute?: typeof decisionRoutes[number]
  name?: string
  questionId?: string
  source?: string
  utteranceId?: number
}
