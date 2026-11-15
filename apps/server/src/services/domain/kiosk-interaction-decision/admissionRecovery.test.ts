import type { KioskInteractionDecision } from './contracts'

import { afterEach, expect, it, vi } from 'vitest'

import { recoverServiceRequest } from './serviceRecovery'
import { createDecisionStages } from './stages'

const eligible: KioskInteractionDecision = { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', recovery: { status: 'eligible' } }
const context = { transcript: '對', state: { phase: 'ordering' }, conversation: { messages: [{ role: 'user' as const, content: '牛肉麵一碗，還要一個排骨便當' }, { role: 'assistant' as const, content: '您指的是哪一道？' }, { role: 'user' as const, content: '對' }] } }
const response = (args: unknown) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: JSON.stringify(args) } }] } }] })
afterEach(() => vi.useRealTimers())

// Report: output/playwright/pb-electron/restored-S04-partial-compact-admission.json.
it.each([
  { admission: 'service', disposition: 'assistant', question: '', kind: 'NEEDS_ASSISTANT' },
  { admission: 'background', disposition: 'ignore', question: '', kind: 'IGNORE' },
  { admission: 'service', disposition: 'clarify', question: '', kind: 'UNAVAILABLE' },
  { admission: 'service', disposition: 'assistant', question: '要改餐嗎？', kind: 'NEEDS_ASSISTANT' },
])('validates the question according to the review disposition (%j)', async ({ kind, ...review }) => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockResolvedValueOnce(response(review))
  const result = await recoverServiceRequest(eligible, { ...context, complete })
  expect(result.kind).toBe(kind)
  expect(result).not.toHaveProperty('actionId')
  if (kind === 'UNAVAILABLE')
    expect(result.recovery).toMatchObject({ status: 'failed', failure: 'invalid' })
})

it('recovers admitted service without replaying an operation or inventing Jev confidence', async () => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'REQUEST' })).mockResolvedValueOnce(response({ admission: 'service', disposition: 'assistant' }))
  const result = await recoverServiceRequest(eligible, { ...context, complete })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', stage: 'review' } })
  expect(result).not.toHaveProperty('actionId')
  expect(result).not.toHaveProperty('confidence')
  expect(complete).toHaveBeenCalledTimes(2)
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
  complete.mockResolvedValueOnce(response({ admission: 'service', disposition: 'assistant' }))
  finish(response({ choice: 'REQUEST' }))
  const completed = await next
  expect(completed).toMatchObject({ kind: 'SERVICE_RECOVERY_PROGRESS', status: 'completed', admission: 'service' })
  if (completed.kind !== 'SERVICE_RECOVERY_PROGRESS')
    throw new Error('Expected completion progress')
  let nextStage = await stages.next(owner, completed.continuationId)
  for (let remaining = 0; remaining < 4 && nextStage.kind === 'SERVICE_RECOVERY_PROGRESS'; remaining++)
    nextStage = await stages.next(owner, nextStage.continuationId)
  expect(nextStage).toMatchObject({ kind: 'NEEDS_ASSISTANT', modelCalls: 0, modelQuestions: 0 })
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

// Report: Oct28 attached weak scroll/service decision; service admission is not understood meaning.
it.each(['是 是 帶刀刀', '我想請你幫忙，那個，我還沒說清楚。'])('clarifies admitted speech without assigning an old menu topic: %s', async (transcript) => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'REQUEST' })).mockResolvedValueOnce(response({ admission: 'service', disposition: 'clarify', question: '剛才沒有理解清楚，請再說一次您的需求。' }))
  const result = await recoverServiceRequest(eligible, { ...context, transcript, complete })
  expect(result.kind).toBe('SERVICE_CLARIFICATION')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(complete.mock.calls[1]![0])).toContain('目前這句的意思清楚')
})

// Report: this chat, Nov14; local session CX4pdljsMeNnROLq_EyRU entry155,
// reproduced with selected qwen36: valid assistant disposition plus copied customer text in question.
it.each(['我不要a套餐了，幫我關閉', null, '未使用的文字'.repeat(60)])('hands a clear new service request to Main without consuming an unused question: %j', async (question) => {
  const transcript = '我不要a套餐了，幫我關閉'
  const complete = vi.fn(async () => response({ admission: 'service', disposition: 'assistant', question, requestKind: 'new-request' }))
  const result = await recoverServiceRequest(eligible, { transcript, state: { phase: 'ordering', serviceClarification: { questionId: 'service', question: '請問您是要點餐嗎？', sourceUtterance: '那我不要了', contextKey: 'key', expiresAt: Date.now() + 30000 } }, complete })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', recovery: { status: 'completed', admission: 'service' } })
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
})

it('keeps an admitted request conversational when the review format fails, without authorizing an action', async () => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'REQUEST' })).mockResolvedValueOnce(response({ admission: 'service', disposition: 'unknown' }))
  const result = await recoverServiceRequest(eligible, { ...context, complete })
  expect(result).toMatchObject({ kind: 'SERVICE_CLARIFICATION', recovery: { status: 'failed', failure: 'invalid' } })
  expect(result).toHaveProperty('question.sourceUtterance', context.transcript)
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(2)
})

// The first round admits this utterance; review IO failure must not erase it.
it('offers clarification after an admitted review provider failure, but never after cancellation', async () => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'REQUEST' })).mockRejectedValueOnce(new Error('Provider disconnected'))
  const result = await recoverServiceRequest(eligible, { ...context, complete })
  expect(result).toMatchObject({ kind: 'SERVICE_CLARIFICATION', recovery: { status: 'failed', failure: 'provider-error' } })
  expect(result).not.toHaveProperty('actionId')
})
