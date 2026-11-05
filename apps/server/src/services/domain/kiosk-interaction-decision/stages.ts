import type { ServiceRecoveryProgress } from '@proj-airi/stage-shared/kiosk-conversation'

import type { KioskDecisionTrace } from '.'
import type { SystemOneQuestion, SystemOneResponse } from '../kiosk-system-one'
import type { DecisionStageResult, KioskInteractionDecision } from './contracts'

import { serviceRecoveryLimits } from '@proj-airi/stage-shared/kiosk-conversation'

import { decisionQuestionBudget } from './contracts'

type Invoke = (state: string, questions: Record<string, SystemOneQuestion>) => Promise<SystemOneResponse>
type RecoveryProgress = Omit<ServiceRecoveryProgress, 'continuationId' | 'expiresAt'>
interface Owner { deviceId: string, visitorSessionId?: string }
interface Checkpoint {
  owner: Owner
  expiresAt: number
  resume: () => Promise<DecisionStageResult>
  cancel: () => void
}

/**
 * One device generation owns its provider work and one-use checkpoints. HTTP
 * waits may change between stages; aborting the active wait cancels that job.
 * Recovery progress is independent of Jev's question count and never an answer.
 */
export function createDecisionStages() {
  const pending = new Map<string, Checkpoint>()
  const active = new Map<string, AbortController>()
  const sameOwner = (left: Owner, right: Owner) => left.deviceId === right.deviceId && left.visitorSessionId === right.visitorSessionId

  async function waitForRequest(promise: Promise<DecisionStageResult>, cancel: () => void, signal?: AbortSignal) {
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted)
      cancel()
    try {
      return await promise
    }
    finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  return {
    async start(owner: Owner, run: (checkpoint: (invoke: Invoke) => Invoke, progress: (event: RecoveryProgress) => Promise<void>, signal: AbortSignal) => Promise<KioskInteractionDecision>, options: { signal?: AbortSignal, timeoutMs?: number } = {}): Promise<DecisionStageResult> {
      active.get(owner.deviceId)?.abort()
      if (active.size >= 128 && !active.has(owner.deviceId))
        return { kind: 'UNAVAILABLE', reason: 'CANDIDATE_BUDGET' }
      const controller = new AbortController()
      active.set(owner.deviceId, controller)
      const deadline = setTimeout(() => controller.abort(), Math.min(serviceRecoveryLimits.turnMs, Math.max(1, options.timeoutMs ?? serviceRecoveryLimits.turnMs)))
      const signal = controller.signal
      let publish!: (result: DecisionStageResult) => void
      const first = new Promise<DecisionStageResult>(resolve => publish = resolve)
      let calls = 0
      let events = 0
      const exchanges: NonNullable<KioskDecisionTrace['exchanges']> = []
      const assertCurrent = () => {
        signal.throwIfAborted()
        if (active.get(owner.deviceId) !== controller)
          throw new Error('Decision replaced')
      }
      const pause = async (event: Omit<Extract<DecisionStageResult, { kind: 'DECISION_PROGRESS' }>, 'continuationId' | 'expiresAt'> | RecoveryProgress) => {
        assertCurrent()
        if (++events > decisionQuestionBudget + serviceRecoveryLimits.progressEvents)
          throw new Error('Decision progress budget exhausted')
        const continuationId = crypto.randomUUID()
        const expiresAt = Math.min(Date.now() + serviceRecoveryLimits.checkpointMs, event.kind === 'SERVICE_RECOVERY_PROGRESS' ? event.deadlineAt ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY)
        const resumed = new Promise<void>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout>
          let abort!: () => void
          const cleanup = () => {
            pending.delete(continuationId)
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
          }
          abort = () => {
            cleanup()
            reject(new Error('Decision cancelled'))
          }
          timer = setTimeout(() => controller.abort(), Math.max(1, expiresAt - Date.now()))
          signal.addEventListener('abort', abort, { once: true })
          pending.set(continuationId, {
            owner,
            expiresAt,
            cancel: () => controller.abort(),
            resume: () => {
              cleanup()
              const next = new Promise<DecisionStageResult>(resolveResult => publish = resolveResult)
              resolve()
              return next
            },
          })
        })
        publish({ ...event, continuationId, expiresAt })
        await resumed
        assertCurrent()
      }
      const checkpoint = (invoke: Invoke): Invoke => async (state, questions) => {
        const answers: Record<string, unknown> = {}
        let selectionMode: SystemOneResponse['selectionMode']
        for (const [question, value] of Object.entries(questions)) {
          assertCurrent()
          if (calls >= decisionQuestionBudget)
            throw new Error('Decision question budget exhausted')
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
          assertCurrent()
          Object.assign(answers, result.answers)
          // This is adapter-owned evidence, not a client continuation answer.
          // Preserve it across the checkpoint or a valid SLM label would be
          // mistaken for a malformed Jev answer missing confidence.
          selectionMode = result.selectionMode
          const answer = result.answers?.[question] as { choice?: unknown, confidence?: unknown } | undefined
          await pause({ kind: 'DECISION_PROGRESS', question, durationMs: performance.now() - startedAt, ...(result.selectionMode ? { selectionMode: result.selectionMode } : {}), ...(typeof answer?.choice === 'string' ? { choice: answer.choice } : {}), ...(typeof answer?.confidence === 'number' ? { confidence: answer.confidence } : {}) })
        }
        return { answers, ...(selectionMode ? { selectionMode } : {}) }
      }
      // The job promise settles every current HTTP wait. An aborted provider
      // that ignores its signal cannot retain a client wait beyond the deadline.
      const aborted = new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Decision cancelled')), { once: true }))
      void Promise.race([run(checkpoint, pause, signal), aborted]).then(result => publish({ ...result, modelCalls: calls, modelQuestions: calls, ...(result.trace && typeof result.trace === 'object' ? { trace: { ...result.trace, exchanges } } : {}) }), () => publish({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE', modelCalls: calls, modelQuestions: calls })).finally(() => {
        clearTimeout(deadline)
        if (active.get(owner.deviceId) === controller)
          active.delete(owner.deviceId)
      })
      return await waitForRequest(first, () => controller.abort(), options.signal)
    },
    async next(owner: Owner, id: string, signal?: AbortSignal): Promise<DecisionStageResult> {
      const entry = pending.get(id)
      if (!entry || !sameOwner(entry.owner, owner))
        throw new Error('Decision checkpoint unavailable')
      if (Date.now() >= entry.expiresAt) {
        entry.cancel()
        throw new Error('Decision checkpoint expired')
      }
      return await waitForRequest(entry.resume(), entry.cancel, signal)
    },
    cancel(owner: Owner, id: string) {
      const entry = pending.get(id)
      if (entry && sameOwner(entry.owner, owner))
        entry.cancel()
    },
  }
}
