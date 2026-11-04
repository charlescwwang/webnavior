import type { ConversationQuestion, IntentRecovery } from '@proj-airi/stage-shared/kiosk-conversation'

import type { DecisionInput } from '../kiosk-interaction-decision'
import type { KioskDecisionState, KioskInteractionDecision } from '../kiosk-interaction-decision/contracts'

import { expect, it, vi } from 'vitest'

import { resolveOrderingIntent } from '.'

const admitted: KioskInteractionDecision = { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', confidence: 0.2025, modelCalls: 3, modelQuestions: 3 }
const input: Pick<DecisionInput, 'transcript' | 'decisionState' | 'candidates' | 'conversation'> = {
  transcript: '我要水餃',
  decisionState: { phase: 'ordering', intentRecovery: { kind: 'request', candidateIds: ['intent:search-menu', 'intent:add-item'] }, productResolution: { status: 'exact', count: 1, references: [{ label: '水餃', refId: 'item:dumplings' }] } },
  candidates: [{ id: 'intent:search-menu', description: '只查詢，不訂購' }, { id: 'intent:add-item', description: '新增；缺份數交Menu提問' }, { id: 'intent:start-checkout', description: '開始結帳' }],
}
// Fixtures explicitly describe Menu-issued scopes; eligibility itself is tested
// through Menu's public runtime, not reimplemented by the Server.
const answerScope = (question: ConversationQuestion): IntentRecovery => ({ kind: 'answer', questionId: question.questionId, ...(question.requestId ? { requestId: question.requestId } : {}), candidateIds: question.choices.map(choice => choice.id) })
const answer = (choice: string) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_ordering_intent', arguments: JSON.stringify({ recipient: 'kiosk', choice }) } }] } }] })

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 core-cart.
function modelAnswer(body: Record<string, unknown>, choice: string) {
  const tools = body.tools as Array<{ function: { name: string } }>
  if (tools[0]?.function.name === 'verify_ordering_answer')
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'verify_ordering_answer', arguments: '{"choice":"COMPLETE"}' } }] } }] })
  return answer(choice)
}

it.each(['intent:add-item', 'intent:search-menu'])('uses a real issued effect without turning Main selection into a JEV score: %s', async (choice) => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async (body: Record<string, unknown>) => modelAnswer(body, choice))
  const result = await resolveOrderingIntent(admitted, input, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: choice, resolvedBy: 'main-skill', modelCalls: 3, modelQuestions: 3, trace: { mainSkill: { id: 'ordering', version: 2, selected: choice, calls: 1 } } })
  expect(result).not.toHaveProperty('confidence')
  expect(result).not.toHaveProperty('reason')
  expect(complete).toHaveBeenCalledOnce()
  const body = complete.mock.calls[0]![0] as Record<string, unknown>
  expect(JSON.stringify(body)).toContain('ordering@2')
  expect(body).toMatchObject({ tools: [{ function: { parameters: { properties: { choice: { enum: ['intent:search-menu', 'intent:add-item', 'UNCERTAIN'] } } } } }] })
})

it.each([
  { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' },
  { kind: 'NEEDS_ASSISTANT', reason: 'PROVIDER_FAILURE' },
  { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' },
  { kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'completed', admission: 'service', readOnly: true } },
] as const)('does not promote $kind/$reason into an operation', async (decision) => {
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, 'intent:add-item'))
  expect(await resolveOrderingIntent(decision, input, complete)).toBe(decision)
  expect(complete).not.toHaveBeenCalled()
})

it.each([
  { phase: 'customer_entry' },
  { phase: 'checkout_invoice' },
  { phase: 'ordering', readOnly: true },
  { phase: 'ordering', productResolution: { status: 'possible', count: 1, references: [] } },
  { phase: 'ordering', productResolution: { status: 'exact', count: 2, references: [] } },
  { phase: 'ordering', priceEvidence: { amounts: [], choices: [] } },
  { phase: 'ordering', constraints: { exclude: [], unresolvedPrice: true } },
] satisfies KioskDecisionState[])('keeps the original restrictions for $phase', async (state) => {
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, 'intent:add-item'))
  expect(await resolveOrderingIntent(admitted, { ...input, decisionState: { ...input.decisionState, ...state, intentRecovery: undefined } }, complete)).toBe(admitted)
  expect(complete).not.toHaveBeenCalled()
})

it.each(['UNCERTAIN', 'intent:start-checkout', 'invented'])('keeps the handoff when Main cannot select an eligible complete effect: %s', async (choice) => {
  const result = await resolveOrderingIntent(admitted, input, async (body: Record<string, unknown>) => modelAnswer(body, choice))
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  expect(result).not.toHaveProperty('actionId')
})

it.each([
  [{ function: { name: 'order_add_item', arguments: '{"choice":"intent:add-item"}' } }],
  [{ function: { name: 'resolve_ordering_intent', arguments: '{"choice":"intent:add-item","quantity":2}' } }],
  [{ function: { name: 'resolve_ordering_intent', arguments: '{"choice":"intent:add-item"}' } }, { function: { name: 'resolve_ordering_intent', arguments: '{"choice":"intent:search-menu"}' } }],
  [{ function: { name: 'resolve_ordering_intent', arguments: 'invalid' } }],
].map(calls => ({ calls })))('rejects malformed or partial executable proposals', async ({ calls }) => {
  const result = await resolveOrderingIntent(admitted, input, async () => Response.json({ choices: [{ message: { tool_calls: calls } }] }))
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
})

it('does not retry or release a task after provider failure', async () => {
  const complete = vi.fn(async () => {
    throw new Error('offline')
  })
  const result = await resolveOrderingIntent(admitted, input, complete)
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledOnce()
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, full six-turn acceptance.
it('selects only a current meal-slot answer and preserves its browser question correlation', async () => {
  const candidate = { id: 'configure:current:quantity:2', description: '目前水餃兩份' }
  const waitingFor = { questionId: 'current', purpose: 'item-configuration', question: '水餃要幾份？', expiresAt: Date.now() + 30000, choices: [candidate] }
  const state = { phase: 'configuration', waitingFor, intentRecovery: answerScope(waitingFor) }
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async (body: Record<string, unknown>) => modelAnswer(body, candidate.id))
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '兩份', decisionState: state, candidates: [candidate, { id: 'configure:other:quantity:2', description: '另一個問題' }] }, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: candidate.id, answeredQuestionId: 'current', resolvedBy: 'main-skill' })
  expect(complete.mock.calls[0]![0]).toMatchObject({ tools: [{ function: { parameters: { properties: { choice: { enum: [candidate.id, 'UNCERTAIN'] } } } } }] })
  expect(result).not.toHaveProperty('confidence')
})

it.each(['expired', 'other-purpose', 'unissued', 'readonly'])('does not revive an invalid meal question: %s', async (scenario) => {
  const candidate = { id: 'configure:current:quantity:2', description: '目前水餃兩份' }
  const waitingFor = { questionId: 'current', purpose: scenario === 'other-purpose' ? 'payment-method' : 'item-configuration', question: '要幾份？', expiresAt: scenario === 'expired' ? Date.now() - 1 : Date.now() + 30000, choices: scenario === 'unissued' ? [] : [candidate] }
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, candidate.id))
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '兩份', decisionState: { phase: 'configuration', readOnly: scenario === 'readonly', waitingFor, ...(scenario !== 'other-purpose' && scenario !== 'unissued' ? { intentRecovery: answerScope(waitingFor) } : {}) }, candidates: [candidate] }, complete)
  expect(result).toBe(admitted)
  expect(complete).not.toHaveBeenCalled()
})

// Report: user field report, Oct31: answering dine-in unexpectedly recommends food.
it.each(['dine-in', 'takeout'])('resumes the owned fulfillment answer: %s', async (mode) => {
  const candidate = { id: `intent:set-fulfillment:${mode}`, description: mode === 'dine-in' ? '設為內用' : '設為自取' }
  const waitingFor = { questionId: 'fulfillment-current', purpose: 'fulfillment', question: '請問要內用還是自取？', expiresAt: Date.now() + 30000, choices: [candidate] }
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async (body: Record<string, unknown>) => modelAnswer(body, candidate.id))
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: mode === 'dine-in' ? '內用' : '自取', decisionState: { phase: 'ordering', waitingFor, intentRecovery: answerScope(waitingFor) }, candidates: [candidate, { id: 'intent:search-menu', description: '推薦餐點' }] }, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: candidate.id, answeredQuestionId: waitingFor.questionId, resolvedBy: 'main-skill' })
  expect(complete).toHaveBeenCalledTimes(2)
  expect(complete.mock.calls[0]?.[0]).toMatchObject({ tools: [{ function: { parameters: { properties: { choice: { enum: [candidate.id, 'UNCERTAIN'] } } } } }] })
})

// Fulfillment recovery must not expand into checkout or revive an old question.
it.each(['expired', 'unissued', 'readonly', 'checkout'])('keeps fulfillment recovery bounded: %s', async (scenario) => {
  const candidate = { id: 'intent:set-fulfillment:dine-in', description: '內用' }
  const waitingFor = { questionId: 'current', purpose: scenario === 'checkout' ? 'checkout-entry' : 'fulfillment', question: '內用還是自取？', expiresAt: Date.now() + (scenario === 'expired' ? -1 : 30000), choices: scenario === 'unissued' ? [] : [candidate] }
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, candidate.id))
  const result = await resolveOrderingIntent(admitted, { ...input, decisionState: { phase: 'ordering', readOnly: scenario === 'readonly', waitingFor, ...(!['checkout', 'unissued', 'payment'].includes(scenario) ? { intentRecovery: answerScope(waitingFor) } : {}) }, candidates: [candidate] }, complete)
  expect(result).toBe(admitted)
  expect(complete).not.toHaveBeenCalled()
})

it('preserves a new exact meal request while fulfillment remains unanswered', async () => {
  const waitingFor = { questionId: 'fulfillment', purpose: 'fulfillment', question: '內用還是自取？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:set-fulfillment:dine-in', description: '內用' }] }
  const result = await resolveOrderingIntent(admitted, { ...input, decisionState: { ...input.decisionState, phase: 'ordering', waitingFor } }, async (body: Record<string, unknown>) => modelAnswer(body, 'intent:add-item'))
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item' })
  expect(result).not.toHaveProperty('answeredQuestionId')
})

// Report: Oct31 field conversation: checkout invitation -> 好 -> generic acknowledgement.
it('resumes only entry to checkout from its current owned question', async () => {
  const candidate = { id: 'intent:start-checkout', description: '同意進入結帳，接著選發票，尚未付款' }
  const waitingFor = { questionId: 'checkout-entry-current', purpose: 'checkout-entry', question: '要進入結帳流程嗎？', expiresAt: Date.now() + 30000, choices: [candidate] }
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async (body: Record<string, unknown>) => modelAnswer(body, candidate.id))
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '好', decisionState: { phase: 'ordering', waitingFor, intentRecovery: answerScope(waitingFor) }, candidates: [candidate, { id: 'intent:select-payment:jkopay', description: '付款' }, { id: 'intent:recommend', description: '推薦餐點' }] }, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: candidate.id, answeredQuestionId: waitingFor.questionId, resolvedBy: 'main-skill' })
  expect(complete.mock.calls[0]?.[0]).toMatchObject({ tools: [{ function: { parameters: { properties: { choice: { enum: [candidate.id, 'UNCERTAIN'] } } } } }] })
})

// An owned question may independently establish service/answer semantics through Main.
it.each(['UNCERTAIN_SERVICE_REQUEST', 'UNCERTAIN_RECIPIENT'] as const)('independently resolves a current checkout answer after %s', async (reason) => {
  const candidate = { id: 'intent:start-checkout', description: '進入結帳，尚未付款' }
  const decision: KioskInteractionDecision = { kind: 'UNAVAILABLE', reason, recovery: { status: 'eligible' } }
  const waitingFor = { questionId: 'checkout-current', purpose: 'checkout-entry', question: '要進入結帳流程嗎？', expiresAt: Date.now() + 30000, choices: [candidate] }
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async (body: Record<string, unknown>) => modelAnswer(body, candidate.id))
  const result = await resolveOrderingIntent(decision, { ...input, transcript: '好', decisionState: { phase: 'ordering', waitingFor, intentRecovery: answerScope(waitingFor) }, candidates: [candidate] }, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: candidate.id, answeredQuestionId: waitingFor.questionId, resolvedBy: 'main-skill' })
  expect(result).not.toHaveProperty('recovery')
  expect(result).not.toHaveProperty('confidence')
  expect(JSON.stringify(complete.mock.calls[0]?.[0])).toContain('未能確認服務回答')
})

it.each(['expired', 'readonly', 'unissued', 'payment', 'failed-recovery', 'unrelated'] as const)('does not infer checkout consent from an invalid or unrelated answer: %s', async (scenario) => {
  const candidate = { id: 'intent:start-checkout', description: '進入結帳' }
  const decision: KioskInteractionDecision = { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST', ...(scenario === 'failed-recovery' ? { recovery: { status: 'failed', failure: 'invalid' } } : {}) }
  const waitingFor = { questionId: 'Q1', purpose: scenario === 'payment' ? 'payment-method' : 'checkout-entry', question: '要進入結帳流程嗎？', expiresAt: Date.now() + (scenario === 'expired' ? -1 : 30000), choices: scenario === 'unissued' ? [] : [candidate] }
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, 'UNCERTAIN'))
  const result = await resolveOrderingIntent(decision, { ...input, transcript: '小王，好', decisionState: { phase: 'ordering', readOnly: scenario === 'readonly', waitingFor, ...(!['checkout', 'unissued', 'payment'].includes(scenario) ? { intentRecovery: answerScope(waitingFor) } : {}) }, candidates: [candidate] }, complete)
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result).not.toHaveProperty('actionId')
  if (scenario === 'unrelated')
    expect(complete).toHaveBeenCalledOnce()
  else
    expect(complete).not.toHaveBeenCalled()
})

// Report: Oct31 field: 那我要一份 lost the one dish just shown by the browser.
it('lets Main understand an issued meal effect with one current contextual reference', async () => {
  const state: KioskDecisionState = { phase: 'ordering', intentRecovery: { kind: 'request', candidateIds: ['intent:add-item'] }, productResolution: { status: 'none', count: 0, references: [] }, references: [{ refId: 'ITEM_1', label: '剛展示的炸排骨便當' }], catalogEvidence: { products: [], categories: [] } }
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '那我要一份', decisionState: state }, async (body: Record<string, unknown>) => modelAnswer(body, 'intent:add-item'))
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item', resolvedBy: 'main-skill' })
})

// A single shown dish supplies context, not a blanket authorization to buy it.
it.each(['multiple', 'none', 'category', 'unissued', 'readonly', 'weak-service'] as const)('keeps contextual meal recovery bounded: %s', async (scenario) => {
  const references = scenario === 'none' ? [] : scenario === 'multiple' ? [{ refId: 'ITEM_1', label: '水餃' }, { refId: 'ITEM_2', label: '牛肉麵' }] : [{ refId: 'ITEM_1', label: '水餃' }]
  const state: KioskDecisionState = { phase: 'ordering', readOnly: scenario === 'readonly', productResolution: { status: 'none', count: 0, references: [] }, references, catalogEvidence: { products: [], categories: scenario === 'category' ? [{ label: '點心', matchedText: '點心', itemCount: 1 }] : [] } }
  const decision: KioskInteractionDecision = scenario === 'weak-service' ? { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' } : admitted
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, 'intent:add-item'))
  const result = await resolveOrderingIntent(decision, { ...input, transcript: '那我要一份', decisionState: state, candidates: scenario === 'unissued' ? [] : input.candidates }, complete)
  expect(result).toBe(decision)
  expect(complete).not.toHaveBeenCalled()
})

it('does not turn acknowledgement of a shown dish into purchase when Main abstains', async () => {
  const state: KioskDecisionState = { phase: 'ordering', intentRecovery: { kind: 'request', candidateIds: ['intent:add-item'] }, productResolution: { status: 'none', count: 0, references: [] }, references: [{ refId: 'ITEM_1', label: '水餃' }] }
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '好，知道了', decisionState: state }, async (body: Record<string, unknown>) => modelAnswer(body, 'UNCERTAIN'))
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
})

// Report: Nov1 field: owned meal confirmation with 對，一份 became a price/category question.
it('resolves the current meal confirmation rather than starting a menu query', async () => {
  const choice = { id: 'confirm-meal:current:yes', description: '確認要點炸排骨便當' }
  const waitingFor = { questionId: 'current', purpose: 'confirm-meal', question: '您是要點炸排骨便當嗎？', expiresAt: Date.now() + 30000, choices: [choice, { id: 'confirm-meal:current:no', description: '不是' }] }
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '對，一份', decisionState: { phase: 'meal_confirmation', waitingFor, intentRecovery: answerScope(waitingFor) }, candidates: waitingFor.choices }, async (body: Record<string, unknown>) => modelAnswer(body, choice.id))
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: choice.id, answeredQuestionId: waitingFor.questionId })
})

it('uses Menu-issued recovery scope without a second phase/purpose vocabulary', async () => {
  const choice = { id: 'configure:current:option:large', description: '目前草稿選大份' }
  const waitingFor = { questionId: 'current', requestId: 'draft', purpose: 'item-configuration', question: '要大份嗎？', expiresAt: Date.now() + 30000, choices: [choice] }
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '大份', decisionState: { phase: 'configuration', waitingFor, intentRecovery: answerScope(waitingFor) }, candidates: [choice] }, async (body: Record<string, unknown>) => modelAnswer(body, choice.id))
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: choice.id, answeredQuestionId: 'current' })
})

it.each(['question', 'request', 'candidate'] as const)('rejects mismatched Menu recovery correlation: %s', async (mismatch) => {
  const candidate = { id: 'configure:current:quantity:2', description: '兩份' }
  const waitingFor = { questionId: 'current', requestId: 'draft', purpose: 'item-configuration', question: '幾份？', expiresAt: Date.now() + 30000, choices: [candidate] }
  const scope: IntentRecovery = { kind: 'answer', questionId: mismatch === 'question' ? 'old' : 'current', requestId: mismatch === 'request' ? 'other-draft' : 'draft', candidateIds: mismatch === 'candidate' ? ['configure:old:quantity:2'] : [candidate.id] }
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, candidate.id))
  expect(await resolveOrderingIntent(admitted, { ...input, decisionState: { phase: 'configuration', waitingFor, intentRecovery: scope }, candidates: [candidate] }, complete)).toBe(admitted)
  expect(complete).not.toHaveBeenCalled()
})

// Report: live112 D03: an explicit named order answering a generic service
// clarification stayed read-only despite a fresh Menu-issued request scope.
it.each([false, true])('qualifies the currently named request without releasing explicit read-only authority (%s)', async (readOnly) => {
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, 'intent:add-item'))
  const decision = { ...admitted, recovery: { status: 'completed' as const, admission: 'service' as const, readOnly: true } }
  const result = await resolveOrderingIntent(decision, { ...input, transcript: '我現在說清楚：我要水餃一份', decisionState: { ...input.decisionState, phase: 'ordering', readOnly, catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } } }, complete)
  if (readOnly) {
    expect(result).toBe(decision)
    expect(complete).not.toHaveBeenCalled()
  }
  else {
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item', resolvedBy: 'main-skill' })
    expect(result).not.toHaveProperty('recovery')
    expect(complete).toHaveBeenCalledOnce()
  }
})

// Report: live112 H08; the refusal prefix cannot replace the hearing question.
it.each(['OTHER_REQUEST', 'invalid'] as const)('does not consume a partial or unverified answer: %s', async (coverage) => {
  const candidate = { id: 'intent:defer-question', description: '只延後目前問題，沒有其他需求。' }
  const waitingFor = { questionId: 'fulfillment', purpose: 'fulfillment', question: '內用還是自取？', expiresAt: Date.now() + 30000, choices: [candidate] }
  const complete = vi.fn().mockResolvedValueOnce(answer(candidate.id)).mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'verify_ordering_answer', arguments: JSON.stringify({ choice: coverage }) } }] } }] }))
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '不要動訂單，我只想確認這句話有收到嗎？', decisionState: { phase: 'ordering', waitingFor, intentRecovery: { kind: 'answer', questionId: 'fulfillment', candidateIds: [candidate.id] } }, candidates: [candidate] }, complete)
  expect(result.kind).toBe(coverage === 'OTHER_REQUEST' ? 'NEEDS_ASSISTANT' : 'UNAVAILABLE')
  expect(result).not.toHaveProperty('actionId')
  expect(result).not.toHaveProperty('resolvedBy')
  expect(complete).toHaveBeenCalledTimes(2)
})

// Report: B01-J-L1 configured background chain, turn7: named recovery skipped Menu quantity.
it('qualifies a new named meal after service recovery using the existing slot flow', async () => {
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, 'intent:add-item'))
  const result = await resolveOrderingIntent({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', recovery: { status: 'completed', admission: 'service', readOnly: false } }, { ...input, decisionState: { ...input.decisionState, phase: 'ordering', catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } } }, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item', resolvedBy: 'main-skill' })
  expect(complete).toHaveBeenCalledOnce()
  expect(result).not.toHaveProperty('quantity')
})

// Report: B04 same-phrase counterpart; an owned Menu scope does not establish recipient.
it('rejects a finite operation proposed for another speaker recipient', async () => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_ordering_intent', arguments: JSON.stringify({ recipient: 'other', choice: 'intent:add-item' }) } }] } }] }))
  const result = await resolveOrderingIntent(admitted, { ...input, transcript: '小王，給我水餃一份' }, complete)
  expect(result.kind).toBe('IGNORE')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledOnce()
})

// Report: frozen112 C15-F3, semantic4: price lookup followed by purchase became recommendation.
it.each(['intent:add-item', 'intent:search-menu'])('independently qualifies an exact-meal information proposal before making it read-only: %s', async (choice) => {
  const complete = vi.fn(async (body: Record<string, unknown>) => modelAnswer(body, choice))
  const result = await resolveOrderingIntent({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' }, {
    ...input,
    transcript: '我要一份水餃',
    decisionState: { ...input.decisionState, phase: 'ordering', catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } },
    conversation: { messages: [{ role: 'user', content: '水餃一份多少錢' }, { role: 'assistant', content: '水餃，單份基本售價 NT$80。' }] },
  }, complete)
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: choice, resolvedBy: 'main-skill' })
  expect(complete).toHaveBeenCalledOnce()
})
