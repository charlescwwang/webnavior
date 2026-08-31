/** A local observation derived from the kiosk camera. No image or biometric data is retained here. */
export interface AttentionObservation {
  /** Monotonic timestamp supplied by the browser, normally `performance.now()`. */
  observedAtMs: number
  /** Number of people currently meeting the module's attention predicate. */
  attendingPeople: number
}

/** Per-kiosk settings that control when an anonymous interaction window earns one greeting. */
export interface ProactiveInteractionSettings {
  /** Whether the kiosk may begin new proactive interaction windows. @default false */
  enabled: boolean
  /** Continuous attention needed before a greeting is eligible. @default 2500 */
  dwellMs: number
  /** Continuous absence required before the current anonymous window is reset. @default 1500 */
  emptyResetMs: number
  /** Minimum people satisfying the attention predicate. @default 1 */
  minAttendingPeople: number
}

/** State visible to diagnostics and future remote telemetry; it contains no identity. */
export type InteractionPhase = 'idle' | 'observing' | 'greeted'

/** The decision produced for each local observation. */
export interface ProactiveInteractionDecision {
  phase: InteractionPhase
  /** True exactly once per anonymous interaction window after the dwell threshold is met. */
  shouldGreet: boolean
  /** Explains the decision without requiring callers to reconstruct the state machine. */
  reason: 'disabled' | 'no-attention' | 'observing' | 'dwell-met' | 'already-greeted' | 'window-reset'
  attendingPeople: number
}
