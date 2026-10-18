/** Diagnostic outcomes are not execution authority or proof of a completed operation. */
export const decisionRoutes = ['fast_path', 'execution_failed', 'unavailable'] as const

/** Screen context supplied for a proactive opening, never ordering authority. */
export type GreetingPhase = 'customer_entry' | 'ordering'

/** Shared limits keep draft validation and the admin editor in agreement. */
export const greetingPhraseLimits = { count: 50, characters: 500 } as const

/** Device-written interaction metadata; keep producer and validating route in sync. */
export interface InteractionMetadata {
  decisionRoute?: typeof decisionRoutes[number]
  name?: string
  questionId?: string
  source?: string
  utteranceId?: number
}
