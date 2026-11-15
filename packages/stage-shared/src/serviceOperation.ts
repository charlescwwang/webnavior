import { array, maxLength, number, optional, picklist, pipe, strictObject, string } from 'valibot'

/** A visible domain action. Targets are resolved inside the approved service, never model selectors. */
export type ServiceAction = 'search' | 'open-product' | 'close-product' | 'option' | 'quantity' | 'note' | 'add' | 'remove' | 'navigate' | 'notice' | 'submit'
export type StepState = 'planned' | 'ready' | 'locating' | 'moving' | 'executing' | 'verifying' | 'completed' | 'cancelled' | 'failed' | 'unknown'

/** Relative times use one operation clock; overlapping phases must not be summed. */
export interface ServiceStep {
  id: string
  action: ServiceAction
  label: string
  /** Observation ref or finite field/route role; never a DOM selector. */
  target?: { kind: 'product' | 'option' | 'cart_line' | 'field' | 'route', ref: string }
  state: StepState
  startedMs: number
  /** First arrival at the real target, before dwell and final IO checks. */
  arrivedMs?: number
  readyMs?: number
  dispatchMs?: number
  finishedMs?: number
  reason?: string
  effect: 'draft' | 'navigation' | 'cart' | 'order'
}

/** Document-owned execution evidence, distinct from a model's proposed plan. */
export interface ServiceOperation {
  documentId: string
  operationId: string
  durationMs: number
  steps: ServiceStep[]
}

/** Bounds execution evidence before it enters Host diagnostics. */
export const serviceOperationSchema = strictObject({
  documentId: string(),
  operationId: string(),
  durationMs: number(),
  steps: pipe(array(strictObject({ id: string(), action: picklist(['search', 'open-product', 'close-product', 'option', 'quantity', 'note', 'add', 'remove', 'navigate', 'notice', 'submit']), label: string(), target: optional(strictObject({ kind: picklist(['product', 'option', 'cart_line', 'field', 'route']), ref: string() })), state: picklist(['planned', 'ready', 'locating', 'moving', 'executing', 'verifying', 'completed', 'cancelled', 'failed', 'unknown']), startedMs: number(), arrivedMs: optional(number()), readyMs: optional(number()), reason: optional(string()), dispatchMs: optional(number()), finishedMs: optional(number()), effect: picklist(['draft', 'navigation', 'cart', 'order']) })), maxLength(100)),
})
