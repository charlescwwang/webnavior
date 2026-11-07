import { afterEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useKioskDecisionProgress } from './useKioskDecisionProgress'

afterEach(() => vi.useRealTimers())
it('shows text receipt immediately, extends after five seconds, and settles uncertainty', async () => {
  vi.useFakeTimers()
  const scope = effectScope()
  const progress = scope.run(useKioskDecisionProgress)!
  progress.start(1, 'simulation')
  expect(progress.state.value).toMatchObject({ pending: true, messageKey: 'confirming', elapsedMs: 0 })
  await vi.advanceTimersByTimeAsync(5000)
  expect(progress.state.value).toMatchObject({ messageKey: 'still-confirming', elapsedMs: 5000 })
  progress.finish(1, { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })
  expect(progress.state.value).toMatchObject({ pending: false, messageKey: 'uncertain', retryable: false })
  await vi.advanceTimersByTimeAsync(1000)
  expect(progress.state.value?.elapsedMs).toBe(5000)
  scope.stop()
})
it('keeps voice silent until service is established and ignores obsolete completion', () => {
  const scope = effectScope()
  const progress = scope.run(useKioskDecisionProgress)!
  progress.start(1, 'asr')
  progress.recovery(1, { kind: 'SERVICE_RECOVERY_PROGRESS', stage: 'adjudication', status: 'started', continuationId: '1', expiresAt: 1 })
  expect(progress.state.value).toBeUndefined()
  progress.finish(1, { kind: 'IGNORE' })
  expect(progress.state.value).toBeUndefined()
  progress.start(2, 'simulation')
  progress.cancel(1)
  expect(progress.state.value?.pending).toBe(true)
  progress.recovery(2, { kind: 'SERVICE_RECOVERY_PROGRESS', stage: 'review', status: 'completed', admission: 'service', continuationId: '2', expiresAt: 1 })
  expect(progress.state.value?.messageKey).toBe('processing')
  progress.finish(2, { kind: 'NEEDS_ASSISTANT' })
  expect(progress.state.value).toBeUndefined()
  scope.stop()
})

it('never offers an automatic retry for a possibly accepted browser operation', () => {
  const scope = effectScope()
  const progress = scope.run(useKioskDecisionProgress)!
  progress.start(1, 'simulation')
  progress.finish(1, { kind: 'EXECUTION_FAILED' })
  expect(progress.state.value).toBeUndefined()
  scope.stop()
})

// Report: this chat, 2026-11-06; a rejected review before admission vanished without feedback.
it('shows technical review failure before voice admission without accepting an operation', () => {
  const scope = effectScope()
  const progress = scope.run(useKioskDecisionProgress)!
  progress.start(11, 'asr')
  progress.finish(11, { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'failed', failure: 'invalid' } })
  expect(progress.state.value).toMatchObject({ utteranceId: 11, pending: false, messageKey: 'failed', retryable: true })
  scope.stop()
})
