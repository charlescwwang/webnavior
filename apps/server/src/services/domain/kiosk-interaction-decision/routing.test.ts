import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'
import { createRecommendationInvitation } from './contracts'

const policy = { decisionInstruction: '', storeInstruction: '' }
const candidates = [
  { id: 'intent:search-menu', description: '查詢餐點' },
  { id: 'intent:add-item', description: '新增餐點' },
  { id: 'intent:remove-item', description: '移除餐點' },
  { id: 'intent:set-fulfillment:dine-in', description: '改內用' },
  { id: 'intent:set-fulfillment:takeout', description: '改外帶' },
]

function provider(choices: string[], scored = false) {
  let index = 0
  return vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
    const key = Object.keys(questions)[0]!
    return { ...(scored ? {} : { selectionMode: 'unscored' as const }), answers: { [key]: { choice: choices[index++], ...(scored ? { confidence: 0.9 } : {}) } } }
  })
}

describe('staged Fast Path routing', () => {
  // Report: this conversation — many competing intents and cancellation misrouted as fulfillment.
  it('starts with four service outcomes and never exposes operations to background speech', async () => {
    const invoke = provider(['BACKGROUND'])
    const result = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '小王，你要吃什麼？', invoke, includeTrace: true })
    expect(result.kind).toBe('IGNORE')
    expect(invoke).toHaveBeenCalledOnce()
    expect(Object.keys(invoke.mock.calls[0]![1].admission!.criteria!)).toEqual(['SERVICE', 'GREET', 'BACKGROUND', 'UNCERTAIN'])
    expect(result).not.toHaveProperty('confidence')
  })

  it.each([false, true])('routes a single explicit fulfillment choice without invented confidence (scored=%s)', async (scored) => {
    const invoke = provider(['SERVICE', 'SINGLE', 'SERVICE', 'intent:set-fulfillment:dine-in', 'OPERATION', 'SINGLE'], scored)
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState: { phase: 'ordering' }, transcript: '還是留在店裡吃好了', invoke, includeTrace: true })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:set-fulfillment:dine-in', modelQuestions: 6 })
    if (scored)
      expect(result).toHaveProperty('confidence', 0.9)
    else
      expect(result).not.toHaveProperty('confidence')
    for (const [, questions] of invoke.mock.calls)
      expect(Object.keys(Object.values(questions)[0]!.criteria!).length).toBeLessThanOrEqual(6)
  })

  it('hands the entire compound request to Main before choosing a single operation', async () => {
    const invoke = provider(['SERVICE', 'HANDOFF'])
    const result = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '牛肉麵兩碗，水餃再一份', invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(result).not.toHaveProperty('actionId')
  })

  it('does not turn service admission or an invalid leaf into operation authority', async () => {
    const invoke = provider(['SERVICE', 'SINGLE', 'SERVICE', 'intent:clear-cart'])
    const result = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '不要便當了，哪有說外帶', invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('requires Jev confidence and rejects a low-confidence admission', async () => {
    const invoke = vi.fn(async () => ({ answers: { admission: { choice: 'SERVICE', confidence: 0.4 } } }))
    const result = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '我要便當', invoke })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('never infers a missing confidence as SLM evidence', async () => {
    const invoke = vi.fn(async () => ({ answers: { admission: { choice: 'SERVICE' } } }))
    const result = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '我要便當', invoke })
    expect(result.kind).toBe('UNAVAILABLE')
  })

  it('keeps complex query conditions read-only instead of dropping them', async () => {
    const invoke = provider(['SERVICE', 'QUERY'])
    const result = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '不要飯，有其他素食的嗎？', invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('binds an answer to the exact live question and rejects an expired answer', async () => {
    const question = { questionId: 'ticket-1', purpose: 'confirm-action', question: '確定清空嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'confirm:ticket-1', description: '明確同意清空' }] }
    const input = { routing: 'staged' as const, policy, candidates: [{ id: 'confirm:ticket-1', description: '明確同意清空' }], transcript: '對', decisionState: { phase: 'pending_confirmation', waitingFor: question } }
    const answer = await decideInteraction({ ...input, invoke: provider(['SERVICE', 'ANSWER', 'confirm:ticket-1']) })
    expect(answer).toMatchObject({ kind: 'FAST_ACTION', actionId: 'confirm:ticket-1', answeredQuestionId: 'ticket-1' })
    const expired = await decideInteraction({ ...input, decisionState: { ...input.decisionState, waitingFor: { ...question, expiresAt: Date.now() - 1 } }, invoke: provider(['SERVICE', 'ANSWER']) })
    expect(expired).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
    expect(expired).not.toHaveProperty('actionId')
  })

  it('retains all candidates and hands off an oversized group instead of truncating', async () => {
    const large = Array.from({ length: 9 }, (_, index) => ({ id: `intent:reserve-tables:${index}`, description: `第 ${index + 1} 桌` }))
    const invoke = provider(['SERVICE', 'SINGLE', 'SERVICE'])
    const result = await decideInteraction({ routing: 'staged', policy, candidates: large, transcript: '幫我選桌', invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    expect(result).not.toHaveProperty('actionId')
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('retains a qualified service handoff when a later provider round fails', async () => {
    const invoke = provider(['SERVICE'])
    invoke.mockRejectedValueOnce(new Error('offline'))
    const unavailable = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '你好', invoke })
    expect(unavailable).toMatchObject({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' })
    const later = provider(['SERVICE'])
    later.mockImplementationOnce(async () => ({ selectionMode: 'unscored', answers: { admission: { choice: 'SERVICE' } } })).mockRejectedValueOnce(new Error('offline'))
    const qualified = await decideInteraction({ routing: 'staged', policy, candidates, transcript: '我要便當', invoke: later })
    expect(qualified).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  })

  it.each([
    { phone: 'SKIP', kind: 'FAST_ACTION' },
    { phone: 'ENTRY_REQUIRED', kind: 'CUSTOMER_ENTRY_REQUIRED' },
    { phone: 'INFORMATION', kind: 'NEEDS_ASSISTANT' },
    { phone: 'UNCERTAIN', kind: 'NEEDS_ASSISTANT' },
  ])('retains the optional entry boundary for $phone', async ({ phone, kind }) => {
    const invoke = provider(['SERVICE', phone])
    const result = await decideInteraction({ routing: 'staged', policy, candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話' }], decisionState: { phase: 'customer_entry' }, transcript: '測試入口回答', invoke })
    expect(result.kind).toBe(kind)
    if (phone === 'INFORMATION')
      expect(result.reason).toBe('GENERAL_QUESTION')
    if (phone !== 'SKIP')
      expect(result).not.toHaveProperty('actionId')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does not start a duplicate operation for speech related to an active request', async () => {
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState: { phase: 'ordering', activeRequest: { stage: 'tool_requested', text: '水餃一份' } }, transcript: '改成兩份', invoke: provider(['SERVICE', 'FOLLOW_UP']) })
    expect(result.kind).toBe('FOLLOW_UP_ACTIVE')
    expect(result).not.toHaveProperty('actionId')
  })

  it('returns an unfinished-fragment relation without concatenating or acting', async () => {
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState: { phase: 'ordering', incompleteSpeech: { transcript: '我要一份', expiresAt: Date.now() + 3000 } }, transcript: '水餃', invoke: provider(['SERVICE', 'CONTINUE']) })
    expect(result.kind).toBe('CONTINUE_INCOMPLETE')
    expect(result).not.toHaveProperty('actionId')
  })

  it('supersedes an invitation only after an independent qualified effect', async () => {
    const decisionState = { phase: 'ordering', waitingFor: createRecommendationInvitation('invitation', Date.now()) }
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState, transcript: '水餃一份', invoke: provider(['SERVICE', 'SINGLE', 'ITEM', 'intent:add-item', 'OPERATION', 'SINGLE']) })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', supersededQuestionId: 'invitation' })
    const uncertain = await decideInteraction({ routing: 'staged', policy, candidates, decisionState, transcript: '那個', invoke: provider(['SERVICE', 'UNCERTAIN']) })
    expect(uncertain).not.toHaveProperty('supersededQuestionId')
    expect(uncertain).not.toHaveProperty('answeredQuestionId')
  })

  it('rejects unsupported rich reads after a simple-query classification instead of dropping conditions', async () => {
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'beef', label: '牛肉' }] }, transcript: '不要牛肉的有什麼', invoke: provider(['SERVICE', 'SINGLE', 'MENU']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('routes a new query through the browser revocation protocol during destructive confirmation', async () => {
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState: { phase: 'pending_confirmation', waitingFor: { questionId: 'clear-1', question: '確定清空？', purpose: 'confirm-action', expiresAt: Date.now() + 30_000, choices: [{ id: 'confirm:clear-1', description: '確定清空' }] } }, transcript: '有哪些素食', invoke: provider(['SERVICE', 'QUERY']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('actionId')
  })

  it('retains a live target question for an admitted but unresolved answer', async () => {
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState: { phase: 'clarification', waitingFor: { questionId: 'target-1', question: '哪一份水餃？', purpose: 'item-clarification', expiresAt: Date.now() + 30_000, choices: [{ id: 'target:1', description: '第一份' }, { id: 'target:2', description: '第二份' }] } }, transcript: '就是那份', invoke: provider(['SERVICE', 'UNCERTAIN']) })
    expect(result.kind).toBe('CLARIFICATION')
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('actionId')
  })

  it('rejects an add hypothesis when independent purpose identifies a factual inquiry', async () => {
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState: { phase: 'ordering' }, transcript: '牛肉麵可以不加香菜嗎', invoke: provider(['SERVICE', 'SINGLE', 'ITEM', 'intent:add-item', 'INFORMATION']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('rejects a single add hypothesis that omits another requested dish', async () => {
    const result = await decideInteraction({ routing: 'staged', policy, candidates, decisionState: { phase: 'ordering' }, transcript: '要一份乾炒意麵、一份水餃，乾炒意麵不要香菜', invoke: provider(['SERVICE', 'SINGLE', 'ITEM', 'intent:add-item', 'OPERATION', 'HANDOFF']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(result).not.toHaveProperty('actionId')
  })
})

// Report: this chat, Nov1 v2 live PB add-on request. Jev correctly selected
// family HANDOFF because only MENU was available, but it was mislabeled as
// uncertain meaning and the complete Main order was made read-only.
it('hands a positively selected unsupported family to Main without claiming semantic uncertainty', async () => {
  const invoke = provider(['SERVICE', 'SINGLE', 'HANDOFF'])
  const result = await decideInteraction({ routing: 'staged', policy, transcript: '請加兩份排骨便當，每份加一份白飯', candidates: [{ id: 'intent:search-menu', description: 'Read actual menu only' }], decisionState: { phase: 'ordering' }, invoke })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
  expect(invoke).toHaveBeenCalledTimes(3)
})

it.each(['SERVICE', 'BACKGROUND', 'UNCERTAIN'])('admits service before handing an uncovered browser request to the full planner (%s)', async (admission) => {
  const invoke = provider(['KIOSK', admission])
  const result = await decideInteraction({ routing: 'staged', policy, transcript: '把雞腿便當換成控肉便當兩份，備註不要辣', candidates: [{ id: 'intent:search-menu', description: 'Read actual menu only' }], decisionState: { phase: 'ordering', requiresPlanner: true }, invoke })
  expect(result.kind).toBe(admission === 'SERVICE' ? 'NEEDS_ASSISTANT' : admission === 'BACKGROUND' ? 'IGNORE' : 'UNAVAILABLE')
  if (admission === 'SERVICE')
    expect(result.reason).toBe('NEW_REQUEST')
  expect(invoke).toHaveBeenCalledTimes(2)
})

// Report: output/playwright/pb-electron/restored-S06-nov4-r1.json.
it.each(['OTHER', 'UNCERTAIN'])('checks planner-only recipient before service meaning (%s)', async (recipient) => {
  const invoke = provider([recipient])
  const result = await decideInteraction({ routing: 'staged', policy, transcript: '同伴，你要兩份還是三份？', candidates, decisionState: { phase: 'ordering', requiresPlanner: true, references: [{ refId: 'test-product', label: '測試餐點' }] }, conversation: { messages: [{ role: 'user', content: '先前正在點餐' }] }, invoke, includeTrace: true })
  expect(result.kind).toBe(recipient === 'OTHER' ? 'IGNORE' : 'UNAVAILABLE')
  expect(invoke).toHaveBeenCalledOnce()
  expect(Object.keys(invoke.mock.calls[0][1])).toEqual(['recipient'])
  expect(JSON.parse(invoke.mock.calls[0][0])).toEqual({ customerUtterance: '同伴，你要兩份還是三份？', waitingFor: null })
})
