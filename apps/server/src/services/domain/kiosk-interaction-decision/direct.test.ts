import type { DecisionInput } from '.'

import { expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const policy = { decisionInstruction: '', storeInstruction: '' }
const candidates = [{ id: 'start', description: '使用畫面目前選擇B3開始點餐，不重選桌號。' }]

// Report: this chat; ANSWER/SINGLE disagreement previously blocked a valid Start.
it('selects a complete current action in one call without intermediate classifications', async () => {
  const invoke = vi.fn<DecisionInput['invoke']>(async () => ({ answers: { action: { choice: 'start', confidence: 0.95 } } }))
  const result = await decideInteraction({ routing: 'direct', policy, transcript: '開始點餐', candidates, includeTrace: true, invoke })
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'start', modelCalls: 1 })
  expect(invoke).toHaveBeenCalledOnce()
  expect(invoke.mock.calls[0][1]).toHaveProperty('action')
  expect(invoke.mock.calls[0][1]).not.toHaveProperty('purpose')
})

it('offers all current actions instead of truncating them to five', async () => {
  const actions = Array.from({ length: 11 }, (_, i) => ({ id: `table-${i}`, description: `選第${i}桌` }))
  const invoke = vi.fn<DecisionInput['invoke']>(async () => ({ answers: { action: { choice: 'table-10', confidence: 0.95 } } }))
  expect(await decideInteraction({ routing: 'direct', policy, transcript: '第十桌', candidates: actions, invoke })).toMatchObject({ kind: 'FAST_ACTION', actionId: 'table-10' })
  expect(Object.keys(invoke.mock.calls[0][1].action.criteria ?? {})).toContain('table-10')
})

it('hands an uncertain action to Main without executing its best guess', async () => {
  const result = await decideInteraction({ routing: 'direct', policy, transcript: '開始', candidates, invoke: async () => ({ answers: { action: { choice: 'start', confidence: 0.4 } } }) })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
})

it('keeps the independent recipient check when enabled', async () => {
  const invoke = vi.fn<DecisionInput['invoke']>(async () => ({ answers: { recipient: { choice: 'OTHER', confidence: 0.95 } } }))
  const result = await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'enforce', policy, transcript: '小王，你要開始嗎', candidates, invoke })
  expect(result.kind).toBe('IGNORE')
  expect(invoke).toHaveBeenCalledOnce()
})

it('does not restore the recipient gate when it is disabled', async () => {
  const invoke = vi.fn<DecisionInput['invoke']>(async () => ({ answers: { action: { choice: 'start', confidence: 0.95 } } }))
  expect(await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'off', policy, transcript: '開始', candidates, invoke })).toMatchObject({ kind: 'FAST_ACTION' })
  expect(Object.keys(invoke.mock.calls[0][1])).toEqual(['action'])
})

it('binds a selected question answer to the live question only', async () => {
  const question = { questionId: 'quantity', purpose: 'browser-order-quantity', question: '雞腿飯幾份？', choices: [{ id: 'answer:current', description: '以本句份數完成雞腿飯訂購' }], expiresAt: Date.now() + 30000 }
  const result = await decideInteraction({ routing: 'direct', policy, transcript: '兩份', candidates: question.choices, decisionState: { phase: 'ordering', waitingFor: question }, invoke: async () => ({ answers: { action: { choice: 'answer:current', confidence: 0.95 } } }) })
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'answer:current', answeredQuestionId: 'quantity' })
})

it('cannot revive an expired question answer', async () => {
  const result = await decideInteraction({ routing: 'direct', policy, transcript: '好', candidates: [{ id: 'answer:current', description: '回答舊問題' }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'old', purpose: 'browser-confirm-add', question: '要加入嗎', choices: [{ id: 'answer:current', description: '加入' }], expiresAt: 1 } }, invoke: async () => ({ answers: { action: { choice: 'answer:current', confidence: 0.95 } } }) })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
})

it('rejects invented choice evidence without authorizing an action', async () => {
  const result = await decideInteraction({ routing: 'direct', policy, transcript: '開始', candidates, invoke: async () => ({ answers: { action: { choice: 'invented', confidence: 0.99 } } }) })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
})

it('keeps transport failures distinct from invalid choices', async () => {
  const result = await decideInteraction({ routing: 'direct', policy, transcript: '開始', candidates, includeTrace: true, invoke: async () => {
    throw new Error('Disconnected')
  } })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE', trace: { exchanges: [{ status: 'failed' }] } })
  expect(result).not.toHaveProperty('actionId')
})

it('records recipient observations without vetoing an action', async () => {
  const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => ({ answers: questions.recipient ? { recipient: { choice: 'OTHER', confidence: 0.95 } } : { action: { choice: 'start', confidence: 0.95 } } }))
  const result = await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'observe', policy, transcript: '開始', candidates, includeTrace: true, invoke })
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'start', modelCalls: 2 })
  expect(invoke.mock.calls[0][1]).toHaveProperty('recipient')
  expect(invoke.mock.calls[1][1]).toHaveProperty('action')
})

// Report: this chat; observe records recipient diagnostics, never an admission gate.
it('continues the action decision when the observation-only recipient call fails', async () => {
  const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => {
    if (questions.recipient)
      throw new Error('Observation timed out')
    return { answers: { action: { choice: 'start', confidence: 0.95 } } }
  })
  const result = await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'observe', policy, transcript: '開始', candidates, includeTrace: true, invoke })
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'start', trace: { exchanges: [{ status: 'failed' }, { status: 'answered' }] } })
  expect(invoke).toHaveBeenCalledTimes(2)
})

// Report: this chat; disabled speech filtering still offered an IGNORE action.
it.each(['off', 'observe'] as const)('does not offer IGNORE when background mode is %s', async (backgroundSpeechMode) => {
  const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => ({ answers: questions.recipient ? { recipient: { choice: 'OTHER', confidence: 0.95 } } : { action: { choice: 'start', confidence: 0.95 } } }))
  const result = await decideInteraction({ routing: 'direct', backgroundSpeechMode, policy, transcript: '開始點餐', candidates, invoke })
  expect(result.kind).toBe('FAST_ACTION')
  const action = invoke.mock.calls.find(([, questions]) => questions.action)![1].action
  expect(action.criteria).not.toHaveProperty('IGNORE')
  expect(action.instructions).toContain('不判斷本句是否對點餐員說話')
})

it('retains background filtering only when enforcement is enabled', async () => {
  const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => ({ answers: questions.recipient ? { recipient: { choice: 'KIOSK', confidence: 0.95 } } : { action: { choice: 'IGNORE', confidence: 0.95 } } }))
  const result = await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'enforce', policy, transcript: '嗯', candidates, invoke })
  expect(result.kind).toBe('IGNORE')
  expect(invoke.mock.calls[1][1].action.criteria).toHaveProperty('IGNORE')
})

it('offers a locally resolved answer and handoff without unrelated fallback choices', async () => {
  const waitingFor = { questionId: 'quantity', purpose: 'browser-order-quantity', question: '雞腿飯幾份？', choices: [{ id: 'answer:current', description: '以本句份數完成雞腿飯訂購' }], expiresAt: Date.now() + 30000 }
  const invoke = vi.fn<DecisionInput['invoke']>(async () => ({ answers: { action: { choice: 'answer:current', confidence: 0.95 } } }))
  expect(await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'off', policy, transcript: '兩份', candidates: waitingFor.choices, decisionState: { phase: 'ordering', waitingFor }, invoke })).toMatchObject({ kind: 'FAST_ACTION', answeredQuestionId: 'quantity' })
  expect(Object.keys(invoke.mock.calls[0][1].action.criteria ?? {})).toEqual(['answer:current', 'HANDOFF'])
})

it('does not reintroduce speech admission while a direct request is in progress', async () => {
  const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: key === 'requestRelation' ? 'FOLLOW_UP' : 'BACKGROUND', confidence: 0.95 }])) }))
  const result = await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'off', policy, transcript: '改成兩份', candidates, decisionState: { phase: 'ordering', activeRequest: { stage: 'thinking', text: '雞腿飯一份' } }, invoke })
  expect(result.kind).toBe('FOLLOW_UP_ACTIVE')
  expect(invoke).toHaveBeenCalledOnce()
  expect(invoke.mock.calls[0][1]).toHaveProperty('requestRelation')
})

it.each(['OTHER', 'failure'])('keeps delegated recipient observation non-blocking on %s', async (observation) => {
  const invoke = vi.fn<DecisionInput['invoke']>(async (_state, questions) => {
    if (questions.recipient && observation === 'failure')
      throw new Error('Observation timed out')
    return { answers: questions.recipient ? { recipient: { choice: observation, confidence: 0.95 } } : { requestRelation: { choice: 'FOLLOW_UP', confidence: 0.95 } } }
  })
  const result = await decideInteraction({ routing: 'direct', backgroundSpeechMode: 'observe', policy, transcript: '改成兩份', candidates, decisionState: { phase: 'ordering', activeRequest: { stage: 'thinking', text: '雞腿飯一份' } }, invoke })
  expect(result.kind).toBe('FOLLOW_UP_ACTIVE')
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(invoke.mock.calls[1][1]).toHaveProperty('requestRelation')
})
