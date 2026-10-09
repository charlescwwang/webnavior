import type { KioskDecisionTrace } from '.'
import type { SystemOneQuestion } from '../kiosk-system-one'
import type { DecisionStageResult, KioskInteractionDecision } from './contracts'

import { decisionQuestionBudget } from './contracts'

type Invoke = (state: string, questions: Record<string, SystemOneQuestion>) => Promise<{ answers?: Record<string, unknown> }>
interface Owner { deviceId: string, visitorSessionId?: string }
interface Checkpoint {
  owner: Owner
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
  resume: () => Promise<DecisionStageResult>
  cancel: () => void
}

/**
 * Suspends server-owned decisions between individual Jev questions. A random
 * checkpoint is scoped to device/session, expires after 15s, and is consumed
 * before resuming. Clients never supply answers, plans or replacement state.
 * Losing a checkpoint stops the decision; no WebMCP effects occur here.
 */
export function createDecisionStages() {
  const pending = new Map<string, Checkpoint>()
  const active = new Map<string, symbol>()
  const sameOwner = (left: Owner, right: Owner) => left.deviceId === right.deviceId && left.visitorSessionId === right.visitorSessionId

  return {
    async start(owner: Owner, run: (checkpoint: (invoke: Invoke) => Invoke) => Promise<KioskInteractionDecision>): Promise<DecisionStageResult> {
      // A fresh decision replaces only this device's suspended decision. A
      // still-running model call has no authority to mutate browser state.
      for (const [id, entry] of pending) {
        if (entry.owner.deviceId === owner.deviceId) {
          pending.delete(id)
          clearTimeout(entry.timer)
          entry.cancel()
        }
      }
      if (active.size >= 128 && !active.has(owner.deviceId))
        return { kind: 'UNAVAILABLE', reason: 'CANDIDATE_BUDGET' }
      const generation = Symbol('decision')
      active.set(owner.deviceId, generation)
      let publish!: (result: DecisionStageResult) => void
      const first = new Promise<DecisionStageResult>(resolve => publish = resolve)
      let calls = 0
      const exchanges: NonNullable<KioskDecisionTrace['exchanges']> = []
      const checkpoint = (invoke: Invoke): Invoke => async (state, questions) => {
        const answers: Record<string, unknown> = {}
        for (const [question, value] of Object.entries(questions)) {
          if (active.get(owner.deviceId) !== generation || calls >= decisionQuestionBudget)
            throw new Error('Decision cancelled or question budget exhausted')
          const startedAt = performance.now()
          calls++
          let result: Awaited<ReturnType<Invoke>>
          try {
            result = await invoke(state, { [question]: value })
            exchanges.push({ index: calls, state, questions: { [question]: value }, answers: result.answers, durationMs: performance.now() - startedAt, status: 'answered' })
          }
          catch (error) {
            exchanges.push({ index: calls, state, questions: { [question]: value }, durationMs: performance.now() - startedAt, status: 'failed' })
            throw error
          }
          if (active.get(owner.deviceId) !== generation)
            throw new Error('Decision replaced during model invocation')
          Object.assign(answers, result.answers)
          const answer = result.answers?.[question] as { choice?: unknown, confidence?: unknown } | undefined
          const continuationId = crypto.randomUUID()
          const expiresAt = Date.now() + 15_000
          const resumed = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(continuationId)
              reject(new Error('Decision checkpoint expired'))
            }, 15_000)
            pending.set(continuationId, {
              owner,
              expiresAt,
              timer,
              cancel: () => reject(new Error('Decision checkpoint cancelled')),
              resume: () => {
                const next = new Promise<DecisionStageResult>(resolveResult => publish = resolveResult)
                resolve()
                return next
              },
            })
          })
          publish({ kind: 'DECISION_PROGRESS', continuationId, expiresAt, question, durationMs: performance.now() - startedAt, ...(typeof answer?.choice === 'string' ? { choice: answer.choice } : {}), ...(typeof answer?.confidence === 'number' ? { confidence: answer.confidence } : {}) })
          await resumed
        }
        return { answers }
      }
      // Always settle the current HTTP wait, including cancellation/failure.
      void run(checkpoint).then(result => publish({ ...result, modelCalls: calls, modelQuestions: calls, ...(result.trace && typeof result.trace === 'object' ? { trace: { ...result.trace, exchanges } } : {}) }), () => publish({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE', modelCalls: calls, modelQuestions: calls })).finally(() => {
        if (active.get(owner.deviceId) === generation)
          active.delete(owner.deviceId)
      })
      return first
    },
    async next(owner: Owner, id: string): Promise<DecisionStageResult> {
      const entry = pending.get(id)
      if (!entry || !sameOwner(entry.owner, owner))
        throw new Error('Decision checkpoint unavailable')
      pending.delete(id)
      clearTimeout(entry.timer)
      // A busy event loop may delay the expiry timer; the deadline itself is
      // authoritative, not whether its cleanup callback has already run.
      if (Date.now() >= entry.expiresAt) {
        entry.cancel()
        throw new Error('Decision checkpoint expired')
      }
      return entry.resume()
    },
    cancel(owner: Owner, id: string) {
      const entry = pending.get(id)
      if (!entry || !sameOwner(entry.owner, owner))
        return
      pending.delete(id)
      clearTimeout(entry.timer)
      entry.cancel()
    },
  }
}
