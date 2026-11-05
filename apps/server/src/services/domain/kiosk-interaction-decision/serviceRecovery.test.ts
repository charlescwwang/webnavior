import { expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

// Report: this chat, 2026-10-21; attachment ea689695 records recipient confidence masking weak speech meaning.
it.each(['BACKGROUND', 'REQUEST'])('checks service relevance after weak unfinished-speech recovery: %s', async (choice) => {
  const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: {
    ...(questions.route ? { route: { choice: 'INCOMPLETE', confidence: 0.2323 } } : {}),
    ...(questions.service ? { service: { choice: 'REQUEST', confidence: 0.9336 } } : {}),
    ...(questions.speech ? { speech: { choice: 'REQUEST', confidence: 0.2382 } } : {}),
    ...(questions.serviceRequest ? { serviceRequest: { choice, confidence: 0.95 } } : {}),
  } }))
  const result = await decideInteraction({ transcript: choice === 'BACKGROUND' ? '你有看過流星嗎' : '你幫我確認剛才的訂單', candidates: [], decisionState: { phase: 'ordering' }, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
  expect(result.kind).toBe(choice === 'BACKGROUND' ? 'IGNORE' : 'NEEDS_ASSISTANT')
  expect(invoke.mock.calls.map(([, questions]) => Object.keys(questions))).toEqual([['route'], ['service'], ['speech'], ['serviceRequest']])
  expect(result).not.toHaveProperty('actionId')
})

// Reports: this chat, 2026-10-21; two recorded weak IGNORE routes escalated movie chatter to Main.
it.each([
  { transcript: '哈哈哈 你昨天看了什麼？', confidence: 0.4215, recipientConfidence: 0.9931 },
  { transcript: '你昨天有看那部電影嗎', confidence: 0.4658, recipientConfidence: 0.9941 },
])('requires service relevance before escalating $transcript', async ({ transcript, confidence, recipientConfidence }) => {
  const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: questions.route
    ? { route: { choice: 'IGNORE', confidence } }
    : { recipient: { choice: 'KIOSK', confidence: recipientConfidence }, serviceRequest: { choice: 'BACKGROUND', confidence: 0.95 } } }))
  const result = await decideInteraction({ transcript, candidates: [], decisionState: { phase: 'ordering', references: [], interactionState: { screen: 'menu', matchingCartLines: 0 } }, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
  expect(result.kind).toBe('IGNORE')
  expect(invoke.mock.calls.map(([, questions]) => Object.keys(questions))).toEqual([['route'], ['serviceRequest']])
  expect(result).not.toHaveProperty('actionId')
})

it('retains Main recovery for a genuine complete service request despite a weak IGNORE', async () => {
  const result = await decideInteraction({ transcript: '你幫我看看有什麼適合吃的', candidates: [], decisionState: { phase: 'ordering' }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async () => ({ answers: { route: { choice: 'IGNORE', confidence: 0.42 }, serviceRequest: { choice: 'REQUEST', confidence: 0.95 } } }) })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  expect(result).not.toHaveProperty('actionId')
})

it.each([
  { choice: 'REQUEST', confidence: 0.4 },
  { choice: 'UNCERTAIN', confidence: 0.95 },
  { choice: 'REQUEST', confidence: Number.NaN },
  { choice: 'invented', confidence: 0.95 },
])('keeps unconfirmed service scope silent: $choice/$confidence', async (serviceRequest) => {
  const result = await decideInteraction({ transcript: '你昨天看了什麼', candidates: [], policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async () => ({ answers: { route: { choice: 'IGNORE', confidence: 0.42 }, serviceRequest } }) })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })
  expect(result).not.toHaveProperty('actionId')
})

it.each([false, true])('provides only an unexpired question as service-answer context (expired=%s)', async (expired) => {
  const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: questions.route
    ? { route: { choice: 'IGNORE', confidence: 0.42 } }
    : { serviceRequest: { choice: expired ? 'BACKGROUND' : 'REQUEST', confidence: 0.95 } } }))
  const result = await decideInteraction({ transcript: '好啊', candidates: [], decisionState: { phase: 'ordering', waitingFor: { questionId: 'q', purpose: 'fulfillment', question: '請問要內用還是自取？', choices: [], expiresAt: Date.now() + (expired ? -30000 : 30000) } }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
  const state = JSON.parse(invoke.mock.calls[1]![0])
  expect(state.phase).toBe('ordering')
  expect(state.waitingFor).toEqual(expired ? null : { purpose: 'fulfillment', question: '請問要內用還是自取？', choices: [] })
  expect(result.kind).toBe(expired ? 'IGNORE' : 'NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('answeredQuestionId')
})

it('preserves phone-page context when confirming a short skip request', async () => {
  const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: questions.service
    ? { service: { choice: 'REQUEST', confidence: 0.95 } }
    : { phone: { choice: 'SKIP', confidence: 0.49 }, serviceRequest: { choice: 'REQUEST', confidence: 0.95 } } }))
  expect(await decideInteraction({ transcript: '略過', candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話' }], decisionState: { phase: 'customer_entry' }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  expect(JSON.parse(invoke.mock.calls.at(-1)![0])).toMatchObject({ customerUtterance: '略過', phase: 'customer_entry' })
})
