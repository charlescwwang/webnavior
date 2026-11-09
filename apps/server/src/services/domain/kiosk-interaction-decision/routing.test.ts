import type { SystemOneQuestion } from '../kiosk-system-one'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
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
  // Report: this chat Nov8 — returning on assent consumes that invitation, not an older checkout question.
  it('retains the answered return invitation ID through the read coverage check', async () => {
    const invoke = provider(['intent:return-menu', 'COMPLETE'])
    const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, candidates: [{ id: 'intent:return-menu', description: '回到全部菜單' }], decisionState: { phase: 'ordering', waitingFor: { questionId: 'return-1', purpose: 'menu-return-invitation', question: '要回菜單嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'intent:return-menu', description: '回菜單，不改訂單。' }, { id: 'DECLINE_INVITATION', description: '保留。' }] } }, transcript: '好', invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:return-menu', answeredQuestionId: 'return-1' })
    expect(result).not.toHaveProperty('supersededQuestionId')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  // Report: this chat Nov8 — a bare assent after returning to the menu lost the recommendation invitation.
  it.each(['intent:recommend', 'DECLINE_INVITATION', 'HANDOFF'])('uses only the current invitation effects: %s', async (choice) => {
    const invoke = provider([choice])
    const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, candidates: [...candidates, { id: 'intent:recommend', description: '推薦' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('current-invitation', Date.now()) }, transcript: choice === 'HANDOFF' ? '改水餃兩份' : choice === 'DECLINE_INVITATION' ? '不用' : '好', invoke })
    expect(invoke).toHaveBeenCalledOnce()
    expect(Object.keys(invoke.mock.calls[0]![1].operation!.criteria!)).toEqual(['intent:recommend', 'DECLINE_INVITATION', 'HANDOFF'])
    if (choice === 'intent:recommend') {
      expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:recommend', answeredQuestionId: 'current-invitation' })
    }
    else if (choice === 'DECLINE_INVITATION') {
      expect(result).toMatchObject({ kind: 'IGNORE', answeredQuestionId: 'current-invitation' })
    }
    else {
      expect(result.kind).toBe('NEEDS_ASSISTANT')
      expect(result).not.toHaveProperty('answeredQuestionId')
      expect(result).not.toHaveProperty('actionId')
    }
  })

  // Report: this chat Nov8 — full-menu lookup was incorrectly sent through the order-write consent gate.
  it('treats full-menu lookup as a read without an order-mutation permission question', async () => {
    const invoke = provider(['SINGLE', 'MENU', 'intent:search-all-menu', 'COMPLETE'])
    const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, candidates: [{ id: 'intent:search-menu', description: '查餐點' }, { id: 'intent:search-all-menu', description: '看完整菜單' }], transcript: '我要看你們全部的菜單', invoke })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:search-all-menu' })
    expect(invoke).toHaveBeenCalledTimes(4)
  })

  // Report: this conversation — many competing intents and cancellation misrouted as fulfillment.
  it('starts with four service outcomes and never exposes operations to background speech', async () => {
    const invoke = provider(['BACKGROUND'])
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '小王，你要吃什麼？', invoke, includeTrace: true })
    expect(result.kind).toBe('IGNORE')
    expect(invoke).toHaveBeenCalledOnce()
    expect(Object.keys(invoke.mock.calls[0]![1].admission!.criteria!)).toEqual(['SERVICE', 'GREET', 'BACKGROUND', 'UNCERTAIN'])
    expect(result).not.toHaveProperty('confidence')
  })

  it.each([false, true])('routes a single explicit fulfillment choice without invented confidence (scored=%s)', async (scored) => {
    const invoke = provider(['SERVICE', 'SINGLE', 'SERVICE', 'intent:set-fulfillment:dine-in', 'OPERATION', 'SINGLE'], scored)
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState: { phase: 'ordering' }, transcript: '還是留在店裡吃好了', invoke, includeTrace: true })
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
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '牛肉麵兩碗，水餃再一份', invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(result).not.toHaveProperty('actionId')
  })

  it('does not turn service admission or an invalid leaf into operation authority', async () => {
    const invoke = provider(['SERVICE', 'SINGLE', 'SERVICE', 'intent:clear-cart'])
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '不要便當了，哪有說外帶', invoke })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('requires Jev confidence and rejects a low-confidence admission', async () => {
    const invoke = vi.fn(async () => ({ answers: { admission: { choice: 'SERVICE', confidence: 0.4 } } }))
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '我要便當', invoke })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('never infers a missing confidence as SLM evidence', async () => {
    const invoke = vi.fn(async () => ({ answers: { admission: { choice: 'SERVICE' } } }))
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '我要便當', invoke })
    expect(result.kind).toBe('UNAVAILABLE')
  })

  it('keeps complex query conditions read-only instead of dropping them', async () => {
    const invoke = provider(['SERVICE', 'QUERY'])
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '不要飯，有其他素食的嗎？', invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('binds an answer to the exact current question irrespective of silence', async () => {
    const question = { questionId: 'ticket-1', purpose: 'confirm-action', question: '確定清空嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'confirm:ticket-1', description: '明確同意清空' }] }
    const input = { routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates: [{ id: 'confirm:ticket-1', description: '明確同意清空' }], transcript: '對', decisionState: { phase: 'pending_confirmation', waitingFor: question } }
    const answer = await decideInteraction({ ...input, invoke: provider(['SERVICE', 'ANSWER', 'confirm:ticket-1', 'OPERATION', 'SINGLE']) })
    expect(answer).toMatchObject({ kind: 'FAST_ACTION', actionId: 'confirm:ticket-1', answeredQuestionId: 'ticket-1' })
    const delayed = await decideInteraction({ ...input, decisionState: { ...input.decisionState, waitingFor: { ...question, expiresAt: Date.now() - 60000 } }, invoke: provider(['SERVICE', 'ANSWER', 'confirm:ticket-1', 'OPERATION', 'SINGLE']) })
    expect(delayed).toMatchObject({ kind: 'FAST_ACTION', actionId: 'confirm:ticket-1', answeredQuestionId: 'ticket-1' })
  })

  it('retains all candidates and hands off an oversized group instead of truncating', async () => {
    const large = Array.from({ length: 9 }, (_, index) => ({ id: `intent:reserve-tables:${index}`, description: `第 ${index + 1} 桌` }))
    const invoke = provider(['SERVICE', 'SINGLE', 'SERVICE'])
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates: large, transcript: '幫我選桌', invoke })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    expect(result).not.toHaveProperty('actionId')
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('retains a qualified service handoff when a later provider round fails', async () => {
    const invoke = provider(['SERVICE'])
    invoke.mockRejectedValueOnce(new Error('offline'))
    const unavailable = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '你好', invoke })
    expect(unavailable).toMatchObject({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' })
    const later = provider(['SERVICE'])
    later.mockImplementationOnce(async () => ({ selectionMode: 'unscored', answers: { admission: { choice: 'SERVICE' } } })).mockRejectedValueOnce(new Error('offline'))
    const qualified = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '我要便當', invoke: later })
    expect(qualified).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  })

  it.each([
    { phone: 'SKIP', kind: 'FAST_ACTION' },
    { phone: 'ENTRY_REQUIRED', kind: 'CUSTOMER_ENTRY_REQUIRED' },
    { phone: 'INFORMATION', kind: 'NEEDS_ASSISTANT' },
    { phone: 'UNCERTAIN', kind: 'NEEDS_ASSISTANT' },
  ])('retains the optional entry boundary for $phone', async ({ phone, kind }) => {
    const invoke = provider(['SERVICE', phone])
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates: [{ id: 'intent:skip-customer-entry', description: '略過電話' }], decisionState: { phase: 'customer_entry' }, transcript: '測試入口回答', invoke })
    expect(result.kind).toBe(kind)
    if (phone === 'INFORMATION')
      expect(result.reason).toBe('GENERAL_QUESTION')
    if (phone !== 'SKIP')
      expect(result).not.toHaveProperty('actionId')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does not start a duplicate operation for speech related to an active request', async () => {
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState: { phase: 'ordering', activeRequest: { stage: 'tool_requested', text: '水餃一份' } }, transcript: '改成兩份', invoke: provider(['SERVICE', 'FOLLOW_UP']) })
    expect(result.kind).toBe('FOLLOW_UP_ACTIVE')
    expect(result).not.toHaveProperty('actionId')
  })

  it('returns an unfinished-fragment relation without concatenating or acting', async () => {
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState: { phase: 'ordering', incompleteSpeech: { transcript: '我要一份', expiresAt: Date.now() + 3000 } }, transcript: '水餃', invoke: provider(['SERVICE', 'CONTINUE']) })
    expect(result.kind).toBe('CONTINUE_INCOMPLETE')
    expect(result).not.toHaveProperty('actionId')
  })

  it('supersedes an invitation only after an independent qualified effect', async () => {
    const decisionState = { phase: 'ordering', waitingFor: createRecommendationInvitation('invitation', Date.now()) }
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState, transcript: '水餃一份', invoke: provider(['SERVICE', 'SINGLE', 'ITEM', 'intent:add-item', 'OPERATION', 'SINGLE']) })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', supersededQuestionId: 'invitation' })
    const uncertain = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState, transcript: '那個', invoke: provider(['SERVICE', 'UNCERTAIN']) })
    expect(uncertain).not.toHaveProperty('supersededQuestionId')
    expect(uncertain).not.toHaveProperty('answeredQuestionId')
  })

  it('rejects unsupported rich reads after a simple-query classification instead of dropping conditions', async () => {
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'beef', label: '牛肉' }] }, transcript: '不要牛肉的有什麼', invoke: provider(['SERVICE', 'SINGLE', 'MENU']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('routes a new query through the browser revocation protocol during destructive confirmation', async () => {
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState: { phase: 'pending_confirmation', waitingFor: { questionId: 'clear-1', question: '確定清空？', purpose: 'confirm-action', expiresAt: Date.now() + 30_000, choices: [{ id: 'confirm:clear-1', description: '確定清空' }] } }, transcript: '有哪些素食', invoke: provider(['SERVICE', 'QUERY']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('actionId')
  })

  it('rechecks an unresolved answer without assuming its recipient from the live question', async () => {
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState: { phase: 'clarification', waitingFor: { questionId: 'target-1', question: '哪一份水餃？', purpose: 'item-clarification', expiresAt: Date.now() + 30_000, choices: [{ id: 'target:1', description: '第一份' }, { id: 'target:2', description: '第二份' }] } }, transcript: '就是那份', invoke: provider(['SERVICE', 'UNCERTAIN']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
    expect(result).not.toHaveProperty('answeredQuestionId')
    expect(result).not.toHaveProperty('actionId')
  })

  it('rejects an add hypothesis when independent purpose identifies a factual inquiry', async () => {
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState: { phase: 'ordering', catalogEvidence: { products: [{ label: '牛肉麵', matchedText: '牛肉麵', source: 'name' }], categories: [] } }, transcript: '牛肉麵可以不加香菜嗎', invoke: provider(['SERVICE', 'SINGLE', 'ITEM', 'intent:add-item', 'INFORMATION']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('rejects a single add hypothesis that omits another requested dish', async () => {
    const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, decisionState: { phase: 'ordering' }, transcript: '要一份乾炒意麵、一份水餃，乾炒意麵不要香菜', invoke: provider(['SERVICE', 'SINGLE', 'ITEM', 'intent:add-item', 'OPERATION', 'HANDOFF']) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(result).not.toHaveProperty('actionId')
  })
})

// Reports: live112 C08-F1/C12-F1, total correction became a new-meal confirmation.
it.each([0.5, 0.95])('rechecks uncertain purpose before admitting a Menu request recovery scope (%s)', async (confidence) => {
  const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
    const key = Object.keys(questions)[0]!
    return { answers: { [key]: { choice: key === 'admission' ? 'SERVICE' : 'UNCERTAIN', confidence: key === 'admission' ? 0.95 : confidence } } }
  })
  const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '水餃總共改三份', invoke, decisionState: { phase: 'ordering', clarificationOffer: { id: 'offer', label: '水餃' }, intentRecovery: { kind: 'request', candidateIds: ['intent:set-quantity'] } } })
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'eligible' } })
  expect(result).not.toHaveProperty('actionId')
})

// Report: live112 C14-F2: dine-in correction was consumed by a checkout invitation.
it('verifies whole-effect coverage even after Jev hypothesizes an answer to checkout', async () => {
  const invoke = provider(['SERVICE', 'ANSWER', 'intent:start-checkout', 'OPERATION', 'HANDOFF'])
  const choice = { id: 'intent:start-checkout', description: '開始結帳，不修改用餐方式' }
  const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates: [choice], transcript: '更正，我要內用', invoke, decisionState: { phase: 'ordering', waitingFor: { questionId: 'checkout', purpose: 'checkout-entry', question: '要進入結帳嗎？', expiresAt: Date.now() + 30000, choices: [choice] } } })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
  expect(result).not.toHaveProperty('answeredQuestionId')
})

// Report: reported-20261103-background-service-clarification-loop in orderingIncidents.ts.
it.each(['BACKGROUND', 'UNCERTAIN', 'SERVICE'])('rechecks admission before interpreting an active service answer: %s', async (scope) => {
  const invoke = provider([scope])
  const state = { phase: 'ordering', serviceClarification: { questionId: 'service', question: '要查詢還是修改？', sourceUtterance: '幫我處理', contextKey: serviceContextKey({ phase: 'ordering' }), expiresAt: Date.now() + 30000 } }
  const result = await decideInteraction({ routing: 'staged' as const, backgroundSpeechMode: 'enforce' as const, policy, candidates, transcript: '它卻出現了第四個字', decisionState: state, invoke })
  expect(result.kind).toBe(scope === 'BACKGROUND' ? 'IGNORE' : 'UNAVAILABLE')
  if (scope !== 'BACKGROUND')
    expect(result.recovery?.status).toBe('eligible')
  expect(invoke).toHaveBeenCalledOnce()
  expect(result).not.toHaveProperty('actionId')
})

// Report: this chat Nov7 — recommendation requests must keep their finite Jev effects.
it.each([
  { transcript: '推薦什麼？', actionId: 'intent:recommend' },
  { transcript: '你還推薦什麼？', actionId: 'intent:recommend-more' },
])('retains a confident finite recommendation without asking Main: $transcript', async ({ transcript, actionId }) => {
  const invoke = provider(['SINGLE', 'MENU', actionId], true)
  const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', transcript, policy, candidates: [{ id: 'intent:recommend', description: '推薦餐點' }, { id: 'intent:recommend-more', description: '換其他推薦' }], invoke })
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId })
  expect(invoke).toHaveBeenCalledTimes(3)
})

// Report: this chat, Nov7 — pure greetings reached Main with background filtering OFF.
it('keeps a pure greeting in Jev without re-enabling background admission', async () => {
  const invoke = provider(['GREET'], true)
  const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, candidates, transcript: '你好', invoke })
  expect(result.kind).toBe('GREET')
  expect(invoke).toHaveBeenCalledOnce()
  const question = invoke.mock.calls[0]![1].purpose!
  expect(question.criteria).toHaveProperty('GREET')
  expect(question.criteria).not.toHaveProperty('BACKGROUND')
  expect(Object.keys(question.criteria!).length).toBeLessThanOrEqual(6)
})

it('does not discard a request after a greeting', async () => {
  const invoke = provider(['QUERY'], true)
  const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, candidates, transcript: '你好，我想吃魚', invoke })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' })
})

// Report: this chat, Nov7 — a quantity-unit clarification is not add/cancel consent.
it('allows a Menu-issued unit clarification without granting an order write', async () => {
  const id = 'configure:current:unit-guidance'
  const invoke = provider(['ANSWER', id], true)
  const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, transcript: '30顆', candidates: [{ id, description: '說明點餐單位，保留需求再問幾份。' }], decisionState: { phase: 'configuration', waitingFor: { questionId: 'current', requestId: 'draft', purpose: 'item-configuration', question: '請問要幾份？', expiresAt: Date.now() + 30000, choices: [{ id, description: '說明點餐單位，保留需求再問幾份。' }] } }, invoke })
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: id, answeredQuestionId: 'current' })
  expect(invoke).toHaveBeenCalledTimes(2)
})

// Report: this chat, Nov8 — classified recommendation exit was reclassified as unknown.
it('finishes a read-only browse exit at its own leaf without interpreting order consent', async () => {
  const invoke = provider(['SINGLE', 'MENU', 'EXIT', 'COMPLETE'], true)
  const menuCandidates = ['search-menu', 'search-all-menu', 'recommend', 'recommend-more', 'show-recommendations', 'return-menu'].map(name => ({ id: `intent:${name}`, description: name }))
  const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, candidates: menuCandidates, transcript: '不要了', invoke })
  expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:return-menu' })
  expect(invoke).toHaveBeenCalledTimes(4)
  expect(result).not.toHaveProperty('answeredQuestionId')
})

it('does not authorize a browse exit without a browser-issued return candidate', async () => {
  const invoke = provider(['SINGLE', 'MENU', 'EXIT'], true)
  const menuCandidates = ['search-menu', 'search-all-menu', 'recommend', 'recommend-more', 'show-recommendations', 'scroll-menu:up'].map(name => ({ id: `intent:${name}`, description: name }))
  const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, candidates: menuCandidates, transcript: '回主畫面', invoke })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('actionId')
})

// Report: DEV-810280 Nov8 — buying the whole menu was classified as returning to the menu.
it('hands off the whole request when a proposed menu exit cannot satisfy collective ordering', async () => {
  const invoke = provider(['SINGLE', 'MENU', 'EXIT', 'HANDOFF'])
  const candidates = ['search-menu', 'search-all-menu', 'recommend', 'recommend-more', 'show-recommendations', 'return-menu'].map(name => ({ id: `intent:${name}`, description: name }))
  const result = await decideInteraction({ routing: 'staged', backgroundSpeechMode: 'off', policy, candidates, transcript: '菜單上的都來一份', invoke })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
  expect(result).not.toHaveProperty('actionId')
})
