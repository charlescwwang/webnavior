/** A local observation derived from the kiosk camera. No image or biometric data is retained here. */
export interface AttentionObservation {
  /** Monotonic timestamp supplied by the browser, normally `performance.now()`. */
  observedAtMs: number
  /** Number of people currently meeting the module's attention predicate. */
  attendingPeople: number
  /** Number of people inside the kiosk's configured physical detection area. */
  presencePeople: number
}

/** A normalized rectangle in the camera image, used as a locally calibrated detection area. */
export interface DetectionZone {
  /** Horizontal offset from the left edge, normalized to 0–1. */
  x: number
  /** Vertical offset from the top edge, normalized to 0–1. */
  y: number
  /** Rectangle width, normalized to 0–1. */
  width: number
  /** Rectangle height, normalized to 0–1. */
  height: number
}

/** The landmark subset required to turn a local face result into an anonymous observation. */
export interface FaceLandmarkObservation {
  /** Approximate face centre in normalized camera coordinates. */
  centre: { x: number, y: number }
  /** Whether the face is conservatively classified as pointing towards the camera. */
  facesCamera: boolean
}

/** The local condition that opens an anonymous kiosk interaction window. */
export type ProactiveTriggerMode = 'attention' | 'presence' | 'mixed'

/** The concrete anonymous signal that earned a greeting. */
export type ProactiveGreetingTrigger = Exclude<ProactiveTriggerMode, 'mixed'>

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
  /** Whether attention to the screen or simply entering the detection area triggers the window. @default 'attention' */
  triggerMode: ProactiveTriggerMode
  /** Administrator-authored, non-authoritative context reference sent to the LLM when attention earns a greeting. */
  attentionGreetingPrompt: string
  /** Administrator-authored, non-authoritative context reference sent to the LLM when presence earns a greeting. */
  presenceGreetingPrompt: string
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
  /** Number of people meeting the configured trigger condition. */
  triggeringPeople: number
  /** The signal that earned this greeting; it is set only when `shouldGreet` is true. */
  greetingTrigger?: ProactiveGreetingTrigger
}

/** Per-kiosk controls for reminders during an otherwise inactive customer session. */
export interface KioskAssistanceReminderSettings {
  /** Whether an active session may receive inactivity assistance reminders. @default true */
  enabled: boolean
  /** Time after the last effective customer activity before a reminder is eligible. @default 20000 */
  waitMs: number
  /** Maximum reminders allowed before the current Kiosk Customer Session ends. @default 2 */
  maxRemindersPerSession: number
  /** Administrator-authored, non-authoritative context reference sent to the LLM for an inactivity reminder candidate. */
  reminderText: string
}

/** Anonymous context emitted only after the reminder policy's safety limits permit an intervention. */
export interface KioskAssistanceReminderCandidate {
  /** Monotonic timestamp at which the policy made this candidate eligible. */
  observedAtMs: number
  /** Number of people currently inside the calibrated kiosk area. */
  presencePeople: number
  /** Number of completed reminders in the current customer session, including this candidate. */
  reminderNumber: number
  /** Time without an effective customer action before this candidate was emitted. */
  inactiveForMs: number
}
