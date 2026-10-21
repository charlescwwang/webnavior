import type { KioskInteractionDecision } from './contracts'

import { afterEach, expect, it, vi } from 'vitest'

import { recoverServiceRequest } from './serviceRecovery'
import { createDecisionStages } from './stages'

const eligible: KioskInteractionDecision = { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', recovery: { status: 'eligible' } }
const context = { transcript: '對', state: { phase: 'ordering' }, conversation: { messages: [{ role: 'user' as const, content: '牛肉麵一碗，還要一個排骨便當' }, { role: 'assistant' as const, content: '您指的是哪一道？' }, { role: 'user' as const, content: '對' }] } }
const response = (args: unknown) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: JSON.stringify(args) } }] } }] })
afterEach(() => vi.useRealTimers())

it('recovers admitted service without replaying an operation or inventing Jev confidence', async () => {
  const complete = vi.fn(async () => response({ choice: 'REQUEST' }))
  const result = await recoverServiceRequest(eligible, { ...context, complete })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'completed', admission: 'service', disposition: 'assistant' } })
  expect(result).not.toHaveProperty('actionId')
  expect(result).not.toHaveProperty('confidence')
  expect(complete).toHaveBeenCalledTimes(1)
})

it('uses richer context once after a valid uncertain adjudication', async () => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockResolvedValueOnce(response({ admission: 'service', disposition: 'clarify', question: '請問您要查詢餐點資訊，還是調整訂單？' }))
  const result = await recoverServiceRequest(eligible, { ...context, complete })
  expect(result).toMatchObject({ kind: 'SERVICE_CLARIFICATION', question: { question: '請問您要查詢餐點資訊，還是調整訂單？' }, recovery: { admission: 'service' } })
  expect(JSON.stringify(complete.mock.calls[1]![0])).toContain('牛肉麵一碗，還要一個排骨便當')
  expect(JSON.stringify(complete.mock.calls[0]![0])).not.toContain('牛肉麵一碗，還要一個排骨便當')
  expect(complete).toHaveBeenCalledTimes(2)
})

it.each([{ kind: 'IGNORE' }, { kind: 'INCOMPLETE' }, { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' }, { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' }] as const)('does not recover an ineligible decision: %j', async (decision) => {
  const complete = vi.fn()
  expect(await recoverServiceRequest(decision, { ...context, complete })).toEqual(decision)
  expect(complete).not.toHaveBeenCalled()
})

it('does not treat invalid output as semantic uncertainty or retry it', async () => {
  const complete = vi.fn(async () => response({ choice: 'invented' }))
  const result = await recoverServiceRequest(eligible, { ...context, complete })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'invalid' } })
  expect(complete).toHaveBeenCalledTimes(1)
})

it('enforces the 8-second cap even when a provider ignores cancellation', async () => {
  vi.useFakeTimers()
  const signal = new AbortController()
  const complete = vi.fn((_body: Record<string, unknown>, _signal: AbortSignal) => new Promise<Response>(() => {}))
  const pending = recoverServiceRequest(eligible, { ...context, complete, signal: signal.signal })
  await vi.advanceTimersByTimeAsync(8000)
  expect(await pending).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'timeout' } })
  expect(complete.mock.calls[0]?.[1]?.aborted).toBe(true)
})

it('publishes recovery start before waiting for a slow model, without counting another Jev question', async () => {
  const stages = createDecisionStages()
  const owner = { deviceId: 'timely', visitorSessionId: 'visitor' }
  let finish!: (response: Response) => void
  const complete = vi.fn(() => new Promise<Response>(resolve => finish = resolve))
  const first = await stages.start(owner, (_checkpoint, progress, signal) => recoverServiceRequest(eligible, { ...context, complete, progress, signal }))
  expect(first).toMatchObject({ kind: 'SERVICE_RECOVERY_PROGRESS', stage: 'adjudication', status: 'started' })
  expect(complete).not.toHaveBeenCalled()
  if (first.kind !== 'SERVICE_RECOVERY_PROGRESS')
    throw new Error('Expected recovery progress')
  const next = stages.next(owner, first.continuationId)
  await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
  finish(response({ choice: 'REQUEST' }))
  const completed = await next
  expect(completed).toMatchObject({ kind: 'SERVICE_RECOVERY_PROGRESS', status: 'completed', admission: 'service' })
  if (completed.kind !== 'SERVICE_RECOVERY_PROGRESS')
    throw new Error('Expected completion progress')
  expect(await stages.next(owner, completed.continuationId)).toMatchObject({ kind: 'NEEDS_ASSISTANT', modelCalls: 0, modelQuestions: 0 })
})

it.each(['new-request', 'clarification-answer'] as const)('separates a service-clarification answer from an independent request: %s', async (requestKind) => {
  const complete = vi.fn(async () => response({ admission: 'service', disposition: 'assistant', requestKind }))
  const result = await recoverServiceRequest(eligible, { ...context, state: { phase: 'ordering', serviceClarification: { questionId: 'service', question: '查詢還是操作？', sourceUtterance: '幫我處理', contextKey: 'key', expiresAt: Date.now() + 30000 } }, complete })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', recovery: { stage: 'review', readOnly: requestKind !== 'new-request' } })
  expect(complete).toHaveBeenCalledTimes(1)
})

it.each([{ admission: 'service', disposition: 'ignore' }, { admission: 'uncertain', disposition: 'assistant' }, { admission: 'background', disposition: 'clarify', question: '要點餐嗎？' }])('rejects an invalid review disposition: %j', async (review) => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockResolvedValueOnce(response(review))
  expect(await recoverServiceRequest(eligible, { ...context, complete })).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'invalid' } })
  expect(complete).toHaveBeenCalledTimes(2)
})

it('cancels an active provider call and discards its late reply', async () => {
  const controller = new AbortController()
  let finish!: (response: Response) => void
  const pending = recoverServiceRequest(eligible, { ...context, signal: controller.signal, complete: () => new Promise<Response>(resolve => finish = resolve) })
  controller.abort()
  expect(await pending).toMatchObject({ kind: 'UNAVAILABLE', recovery: { failure: 'cancelled' } })
  finish(response({ choice: 'REQUEST' }))
})

it('limits the richer review to twelve seconds without another retry', async () => {
  vi.useFakeTimers()
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockImplementationOnce(() => new Promise<Response>(() => {}))
  const pending = recoverServiceRequest(eligible, { ...context, complete })
  await vi.advanceTimersByTimeAsync(12000)
  expect(await pending).toMatchObject({ kind: 'UNAVAILABLE', recovery: { stage: 'review', status: 'failed', failure: 'timeout' } })
  expect(complete).toHaveBeenCalledTimes(2)
})

it('includes slow progress acknowledgements in the combined twenty-second recovery budget', async () => {
  vi.useFakeTimers()
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockImplementationOnce(() => new Promise<Response>(() => {}))
  const pending = recoverServiceRequest(eligible, { ...context, complete, progress: async () => await new Promise(resolve => setTimeout(resolve, 5000)) })
  await vi.advanceTimersByTimeAsync(20000)
  expect(await pending).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'timeout', stage: 'review' } })
  expect(complete).toHaveBeenCalledTimes(2)
})
