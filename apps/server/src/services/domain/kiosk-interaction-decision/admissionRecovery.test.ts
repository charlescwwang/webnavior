import type { KioskInteractionDecision } from './contracts'

import { afterEach, expect, it, vi } from 'vitest'

import { recoverServiceRequest } from './serviceRecovery'
import { resolveServiceHandoff } from './serviceResolution'
import { createDecisionStages } from './stages'

const eligible: KioskInteractionDecision = { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', recovery: { status: 'eligible' } }
const context = { transcript: '對', state: { phase: 'ordering' }, conversation: { messages: [{ role: 'user' as const, content: '牛肉麵一碗，還要一個排骨便當' }, { role: 'assistant' as const, content: '您指的是哪一道？' }, { role: 'user' as const, content: '對' }] } }
// Mock review replies name the kiosk recipient explicitly; recipient controls override it.
const response = (args: unknown, name = 'resolve_service_request') => Response.json({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args && typeof args === 'object' && ('admission' in args || name === 'resolve_service_scope') ? { recipient: 'kiosk', ...args } : args) } }] } }] })
afterEach(() => vi.useRealTimers())

it('recovers admitted service without replaying an operation or inventing Jev confidence', async () => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'REQUEST' }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', stage: 'adjudication' } })
  expect(result).not.toHaveProperty('actionId')
  expect(result).not.toHaveProperty('confidence')
  expect(complete).toHaveBeenCalledTimes(1)
})

it('uses richer context once after a valid uncertain adjudication', async () => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockResolvedValueOnce(response({ admission: 'service', disposition: 'clarify', question: '請問您要查詢餐點資訊，還是調整訂單？' }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete })
  expect(result).toMatchObject({ kind: 'SERVICE_CLARIFICATION', question: { question: '請問您要查詢餐點資訊，還是調整訂單？' }, recovery: { admission: 'service' } })
  expect(JSON.stringify(complete.mock.calls[1]![0])).toContain('牛肉麵一碗，還要一個排骨便當')
  expect(JSON.stringify(complete.mock.calls[0]![0])).not.toContain('牛肉麵一碗，還要一個排骨便當')
  expect(complete).toHaveBeenCalledTimes(2)
})

it.each([{ kind: 'IGNORE' }, { kind: 'INCOMPLETE' }, { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' }, { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' }] as const)('does not recover an ineligible decision: %j', async (decision) => {
  const complete = vi.fn()
  expect(await recoverServiceRequest(decision, { backgroundSpeechMode: 'enforce', ...context, complete })).toEqual(decision)
  expect(complete).not.toHaveBeenCalled()
})

it('does not treat invalid output as semantic uncertainty or retry it', async () => {
  const complete = vi.fn(async () => response({ choice: 'invented' }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'invalid' } })
  expect(complete).toHaveBeenCalledTimes(1)
})

it('enforces the 8-second cap even when a provider ignores cancellation', async () => {
  vi.useFakeTimers()
  const signal = new AbortController()
  const complete = vi.fn((_body: Record<string, unknown>, _signal: AbortSignal) => new Promise<Response>(() => {}))
  const pending = recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete, signal: signal.signal })
  await vi.advanceTimersByTimeAsync(8000)
  expect(await pending).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'timeout' } })
  expect(complete.mock.calls[0]?.[1]?.aborted).toBe(true)
})

it('publishes recovery start before waiting for a slow model, without counting another Jev question', async () => {
  const stages = createDecisionStages()
  const owner = { deviceId: 'timely', visitorSessionId: 'visitor' }
  let finish!: (response: Response) => void
  const complete = vi.fn(() => new Promise<Response>(resolve => finish = resolve))
  const first = await stages.start(owner, (_checkpoint, progress, signal) => recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete, progress, signal }))
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
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, state: { phase: 'ordering', serviceClarification: { questionId: 'service', question: '查詢還是操作？', sourceUtterance: '幫我處理', contextKey: 'key', expiresAt: Date.now() + 30000 } }, complete })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', recovery: { stage: 'review', readOnly: requestKind !== 'new-request' } })
  expect(complete).toHaveBeenCalledTimes(1)
})

it.each([{ admission: 'service', disposition: 'ignore' }, { admission: 'uncertain', disposition: 'assistant' }, { admission: 'background', disposition: 'clarify', question: '要點餐嗎？' }])('rejects an invalid review disposition: %j', async (review) => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockResolvedValueOnce(response(review))
  expect(await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete })).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'invalid' } })
  expect(complete).toHaveBeenCalledTimes(2)
})

it('cancels an active provider call and discards its late reply', async () => {
  const controller = new AbortController()
  let finish!: (response: Response) => void
  const pending = recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, signal: controller.signal, complete: () => new Promise<Response>(resolve => finish = resolve) })
  controller.abort()
  expect(await pending).toMatchObject({ kind: 'UNAVAILABLE', recovery: { failure: 'cancelled' } })
  finish(response({ choice: 'REQUEST' }))
})

it('limits the richer review to twelve seconds without another retry', async () => {
  vi.useFakeTimers()
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockImplementationOnce(() => new Promise<Response>(() => {}))
  const pending = recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete })
  await vi.advanceTimersByTimeAsync(12000)
  expect(await pending).toMatchObject({ kind: 'UNAVAILABLE', recovery: { stage: 'review', status: 'failed', failure: 'timeout' } })
  expect(complete).toHaveBeenCalledTimes(2)
})

it('includes slow progress acknowledgements in the combined twenty-second recovery budget', async () => {
  vi.useFakeTimers()
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockImplementationOnce(() => new Promise<Response>(() => {}))
  const pending = recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete, progress: async () => await new Promise(resolve => setTimeout(resolve, 5000)) })
  await vi.advanceTimersByTimeAsync(20000)
  expect(await pending).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'timeout', stage: 'review' } })
  expect(complete).toHaveBeenCalledTimes(2)
})

// Report: Oct28 attached weak scroll/service decision; service admission is not understood meaning.
it.each(['是 是 帶刀刀', '我想請你幫忙，那個，我還沒說清楚。'])('qualifies admitted speech before assigning an operation or old menu topic: %s', async (transcript) => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'REQUEST' })).mockResolvedValueOnce(response({ choice: 'CLARIFY_SERVICE' }, 'resolve_service_scope'))
  const admitted = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, transcript, complete })
  expect(admitted.kind).toBe('NEEDS_ASSISTANT')
  expect(admitted).not.toHaveProperty('actionId')
  const result = await resolveServiceHandoff(admitted, transcript, context.state, complete, undefined, 'enforce')
  expect(result.kind).toBe('SERVICE_CLARIFICATION')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(2)
  expect(complete.mock.calls[1]![0]).toMatchObject({ messages: expect.arrayContaining([{ role: 'user', content: transcript }]) })
})

// Field report: Oct30 repeated 「請問您想點什麼餐點？」 after 好、對、飯、吃飯.
it.each(['好', '對', '飯', '吃飯'])('keeps an uninterpreted service-answer fragment silent instead of promoting it to Main: %s', async (transcript) => {
  const serviceClarification = { questionId: 'field-ordering', question: '請問您想點什麼餐點？', sourceUtterance: '我想吃飯', contextKey: 'field-context', expiresAt: Date.now() + 30000 }
  const complete = vi.fn(async (_body: Record<string, unknown>) => response({ admission: 'service', disposition: 'clarify', question: '請問您想點什麼餐點？', requestKind: 'clarification-answer' }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, transcript, state: { phase: 'ordering', serviceClarification }, complete })
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result.reason).toBe('UNCERTAIN_OPERATION')
  expect(result.recovery).toMatchObject({ status: 'completed', admission: 'service', disposition: 'clarify', readOnly: true })
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(1)
  const payload = complete.mock.calls[0]![0]
  expect(JSON.stringify(payload)).toContain(transcript)
  expect(JSON.stringify(payload)).toContain('我想吃飯')
})

it.each([
  { admission: 'background', disposition: 'ignore', expected: 'IGNORE' },
  { admission: 'uncertain', disposition: 'abstain', expected: 'UNAVAILABLE' },
])('keeps unadmitted answers non-operational: $admission', async ({ admission, disposition, expected }) => {
  const complete = vi.fn(async () => response({ admission, disposition, requestKind: 'clarification-answer' }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, state: { phase: 'ordering', serviceClarification: { questionId: 'service', question: '需要什麼協助？', sourceUtterance: '幫我', contextKey: 'key', expiresAt: Date.now() + 30000 } }, complete })
  expect(result.kind).toBe(expected)
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(1)
})

// Report: configured C01-F2 Nov3: understood route question was discarded for question:"".
it('accepts an empty inactive question while rejecting an empty actual clarification', async () => {
  const complete = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockResolvedValueOnce(response({ admission: 'service', disposition: 'assistant', question: '' }))
  expect(await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete })).toMatchObject({ kind: 'NEEDS_ASSISTANT', recovery: { status: 'completed', admission: 'service' } })
  const emptyClarification = vi.fn().mockResolvedValueOnce(response({ choice: 'UNCERTAIN' })).mockResolvedValueOnce(response({ admission: 'service', disposition: 'clarify', question: '' }))
  expect(await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, complete: emptyClarification })).toMatchObject({ kind: 'UNAVAILABLE', recovery: { status: 'failed', failure: 'invalid' } })
})

// Report: Nov3 B01-J-L1, final3 attempt103; background was called a new vague request.
it('does not renew an open service question when review labels a fragment a new vague request', async () => {
  const complete = vi.fn(async () => response({ admission: 'service', disposition: 'clarify', requestKind: 'new-request', question: '需要什麼協助？' }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, transcript: '判斷的話就是回答出來的東西', state: { phase: 'ordering', serviceClarification: { questionId: 'original', question: '需要什麼協助？', sourceUtterance: '請幫忙', contextKey: 'key', expiresAt: Date.now() + 30000 } }, complete })
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(1)
})

// Report: full outcome2 C06-F1; unavailable-data follow-ups are not unresolved target loops.
it('permits a directed refinement after an unsupported-condition answer without renewing its lifetime', async () => {
  const serviceClarification = { questionId: 'condition', question: '無法保證不辣，您還想了解什麼？', sourceUtterance: '不要辣的餐點', contextKey: 'key', expiresAt: Date.now() + 20000, unavailableConditions: [{ id: 'spice', label: '不辣保證' }] }
  const complete = vi.fn(async () => response({ admission: 'service', disposition: 'clarify', question: '要改查其他餐點，還是調整原本條件？', requestKind: 'clarification-answer' }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, transcript: '有其他的嗎', state: { phase: 'ordering', serviceClarification }, complete })
  expect(result.kind).toBe('SERVICE_CLARIFICATION')
  if (result.kind !== 'SERVICE_CLARIFICATION')
    throw new Error('Expected bounded condition refinement')
  expect(result.question.expiresAt).toBe(serviceClarification.expiresAt)
  expect(result.question.question).toBe('要改查其他餐點，還是調整原本條件？')
  expect(result).not.toHaveProperty('actionId')
})

// Report: Nov4 C03-A1; Jev's unknown purpose must not become unknown recipient.
it('independently reviews unknown service meaning without a second generic admission stage', async () => {
  const complete = vi.fn(async () => response({ admission: 'service', disposition: 'assistant' }))
  const result = await recoverServiceRequest({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'eligible' } }, { backgroundSpeechMode: 'enforce', ...context, transcript: '先只問價錢，不要加入訂單', complete })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.recovery).toMatchObject({ stage: 'review', admission: 'service', disposition: 'assistant' })
  expect(complete).toHaveBeenCalledTimes(1)
})

// Report: Nov4 same-phrase counterpart; an explicit other recipient wins over menu history.
it.each(['other', 'uncertain'] as const)('does not adopt a proposed service request addressed to %s', async (recipient) => {
  const complete = vi.fn(async () => response({ recipient, admission: 'service', disposition: 'assistant', requestKind: 'new-request' }))
  const result = await recoverServiceRequest({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'eligible' } }, { backgroundSpeechMode: 'enforce', ...context, transcript: '小王，有其他的嗎', state: { phase: 'ordering', serviceClarification: { questionId: 'cue', question: '要哪種餐點？', sourceUtterance: '有其他的嗎', contextKey: 'key', expiresAt: Date.now() + 30000 } }, complete })
  expect(result.kind).toBe(recipient === 'other' ? 'IGNORE' : 'UNAVAILABLE')
  expect(result.recovery?.admission).toBe(recipient === 'other' ? 'background' : 'uncertain')
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
})

// Report: semantic1 B01-J-L1; the relation schema must allow non-service speech.
it('does not force a background comment into new-request or clarification-answer', async () => {
  const complete = vi.fn(async () => response({ recipient: 'kiosk', admission: 'service', disposition: 'assistant', requestKind: 'unrelated' }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'enforce', ...context, transcript: '判斷的話就是回答出來的東西', state: { phase: 'ordering', serviceClarification: { questionId: 'cue', question: '需要什麼？', sourceUtterance: '幫我', contextKey: 'key', expiresAt: Date.now() + 30000 } }, complete })
  expect(result.kind).toBe('IGNORE')
  expect(result.recovery?.admission).toBe('background')
})

// Report: this chat, 2026-11-06; assistant/question conflict silently discarded two BOGO requests.
it('constrains review questions in the provider contract and identifies a conflicting answer', async () => {
  const complete = vi.fn(async (_body: Record<string, unknown>) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: JSON.stringify({ admission: 'service', disposition: 'assistant', question: '目前沒有買一送一，但有優惠套餐。' }) } }] } }] }))
  const result = await recoverServiceRequest(eligible, { backgroundSpeechMode: 'off', ...context, transcript: '你有買一送一嗎？', complete })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', recovery: { failure: 'invalid', validationFailure: 'unexpected-question' } })
  const body = complete.mock.calls[0]![0] as { tools: Array<{ function: { parameters: { anyOf?: unknown[] } } }> }
  expect(body.tools[0]!.function.parameters.anyOf).toEqual([
    { properties: { admission: { enum: ['service'] }, disposition: { enum: ['assistant'] }, question: { maxLength: 0 } } },
    { properties: { admission: { enum: ['service'] }, disposition: { enum: ['clarify'] }, question: { minLength: 1, pattern: '\\S' } }, required: ['question'] },
  ])
  expect(result).not.toHaveProperty('question')
  expect(complete).toHaveBeenCalledTimes(1)
})
