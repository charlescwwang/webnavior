import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { expect, it, vi } from 'vitest'

import { resolveServiceHandoff } from './serviceResolution'

const decision: KioskInteractionDecision = { kind: 'NEEDS_ASSISTANT', confidence: 0.95, trace: { model: 'recorded' }, modelCalls: 2, modelQuestions: 2 }
const state: KioskDecisionState = { phase: 'ordering', catalogEvidence: { products: [], categories: [] } }
function response(choice: string) {
  return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ recipient: 'kiosk', choice }) } }] } }] })
}

// Report: this chat, 2026-10-21; generic Main routing incorrectly required menu reads for store FAQs.
it.each(['你們幾點關門？', '能開電子發票嗎？', '怎麼拿餐？', '可以用現金嗎？', '你可以做什麼？'])('recovers a generic service-information handoff: %s', async (transcript) => {
  const complete = vi.fn(async (_body: Record<string, unknown>) => response('SERVICE_INFORMATION_ONLY'))
  const result = await resolveServiceHandoff(decision, transcript, state, complete, undefined, 'enforce')
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION', modelCalls: 2, modelQuestions: 2, trace: { serviceResolution: { choice: 'SERVICE_INFORMATION_ONLY' } } })
  expect(result).not.toHaveProperty('actionId')
  expect(complete.mock.calls[0]?.[0]).toMatchObject({ tool_choice: 'required', tools: [{ function: { name: 'resolve_service_scope' } }], messages: expect.arrayContaining([{ role: 'user', content: transcript }]) })
})

it.each(['MENU_INFORMATION_ONLY', 'UNCERTAIN', 'invented'])('retains the original food guard for %s', async (choice) => {
  const result = await resolveServiceHandoff(decision, '我不想吃飯，還有什麼？', state, async () => response(choice), undefined, 'enforce')
  if (choice === 'MENU_INFORMATION_ONLY')
    expect(result).toMatchObject({ reason: 'MENU_QUERY', requestScope: 'menu-information' })
  else if (choice === 'UNCERTAIN')
    expect(result).toHaveProperty('reason', 'UNCERTAIN_SERVICE_REQUEST')
  else
    expect(result.reason).toBe('INVALID_CHOICE')
  expect(result).not.toHaveProperty('actionId')
  expect(result).toMatchObject({ kind: choice === 'MENU_INFORMATION_ONLY' ? 'NEEDS_ASSISTANT' : 'UNAVAILABLE', modelCalls: 2 })
})

it.each([
  { decision: { kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' }, state },
  { decision: { kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' }, state },
  { decision: { kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' }, state },
  { decision, state: { phase: 'customer_entry' } },
  { decision: { ...decision, resolvedBy: 'main-service', requestScope: 'order-operation' }, state: { ...state, catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } } },
] satisfies Array<{ decision: KioskInteractionDecision, state: KioskDecisionState }>)('does not reclassify qualified or protected handoffs %#', async (input) => {
  const complete = vi.fn(async () => response('SERVICE_INFORMATION_ONLY'))
  expect(await resolveServiceHandoff(input.decision, '略過', input.state, complete, undefined, 'enforce')).toBe(input.decision)
  expect(complete).not.toHaveBeenCalled()
})

it('retains the original guard if Main is unavailable', async () => {
  const result = await resolveServiceHandoff(decision, '幾點營業？', state, async () => {
    throw new Error('offline')
  }, undefined, 'enforce')
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result.reason).toBe('PROVIDER_FAILURE')
  expect(result).toHaveProperty('trace.serviceResolution.choice', 'UNCERTAIN')
})

it.each([
  { name: 'order_add_item', arguments: '{"choice":"SERVICE_INFORMATION_ONLY"}' },
  { name: 'resolve_service_scope', arguments: 'invalid' },
  { name: 'resolve_service_scope', arguments: '{"choice":"SERVICE_INFORMATION_ONLY","action":"skip"}' },
])('rejects malformed scope proposals without releasing the food guard: $name/$arguments', async (call) => {
  const result = await resolveServiceHandoff(decision, '能開發票嗎？', state, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: call }] } }] }), undefined, 'enforce')
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result.reason).toBe('INVALID_CHOICE')
  expect(result).toHaveProperty('trace.serviceResolution.choice', 'UNCERTAIN')
})

// Reports: live112 D01/D03/M04/M05; admitted uncertainty cannot permanently
// classify clear replacement/mixed requests as read-only menu exploration.
it.each([
  { text: '牛肉麵不要了，改水餃一份', choice: 'ORDER_MUTATION', kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' },
  { text: '牛肉麵一份幫我加，水餃一份多少錢', choice: 'ORDER_MUTATION', kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' },
  { text: '阿明，你昨天看什麼電影', choice: 'BACKGROUND', kind: 'IGNORE', reason: undefined },
  { text: '請說明付款方式', choice: 'SERVICE_INFORMATION_ONLY', kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' },
])('independently qualifies admitted meaning uncertainty: $text', async ({ text, choice, kind, reason }) => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, text, state, async () => response(choice), undefined, 'enforce')
  expect(result.kind).toBe(kind)
  expect(result.reason).toBe(reason)
  expect(result).not.toHaveProperty('actionId')
})

// Report: live112 H07; a broad menu read must not answer an explicit hearing check.
it.each(['SERVICE_INFORMATION_ONLY', 'MENU_INFORMATION_ONLY'])('qualifies an otherwise ungrounded read without altering a confirmed menu read: %s', async (choice) => {
  const fast = { kind: 'FAST_ACTION' as const, actionId: 'intent:search-menu' }
  const result = await resolveServiceHandoff(fast, choice === 'SERVICE_INFORMATION_ONLY' ? '有收到我的話嗎' : '請顯示全部菜單', state, async () => response(choice), undefined, 'enforce')
  expect(result.kind).toBe(choice === 'SERVICE_INFORMATION_ONLY' ? 'NEEDS_ASSISTANT' : 'FAST_ACTION')
  if (choice === 'SERVICE_INFORMATION_ONLY') {
    expect(result.reason).toBe('GENERAL_QUESTION')
    expect(result).not.toHaveProperty('actionId')
  }
  else {
    expect(result).toHaveProperty('actionId', 'intent:search-menu')
  }
})

// Report: Nov1 C09-A2/C12-F3: a new replacement while fulfillment waits
// was qualified by Main but projected back into read-only uncertainty.
it('admits a whole-turn replacement independently from the waiting answer scope', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, '牛肉麵不要了，改水餃一份', { ...state, intentRecovery: { kind: 'answer', questionId: 'q', requestId: 'r', candidateIds: ['intent:set-fulfillment'] } }, async () => response('ORDER_MUTATION'), undefined, 'enforce')
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', resolvedBy: 'main-service' })
})

// Report: Nov1 C06-F1/C06-A1; an unsupported requirement must not be dropped.
it('publishes an owned limitation only after Main confirms the unsupported requirement', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_FILTER' }, '不要辣', { ...state, unavailableConditionReferences: [{ id: 'spice', label: '辣度標示' }] }, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_condition_support', arguments: '{"choice":"REQUIREMENT"}' } }] } }] }), undefined, 'enforce')
  expect(result).toMatchObject({ kind: 'SERVICE_CLARIFICATION', question: { sourceUtterance: '不要辣', question: expect.stringContaining('無法確認') } })
  expect(result).toMatchObject({ question: { question: expect.stringContaining('保留這項要求，還是調整點餐需求') } })
  expect(JSON.stringify(result)).not.toContain('詢問店員')
  expect(result).not.toHaveProperty('actionId')
})
it('distinguishes a complete request for help from a genuinely unfinished fragment', async () => {
  expect(await resolveServiceHandoff({ kind: 'INCOMPLETE' }, '請幫忙，我還沒說清楚', state, async () => response('CLARIFY_SERVICE'), undefined, 'enforce')).toHaveProperty('kind', 'SERVICE_CLARIFICATION')
  expect(await resolveServiceHandoff({ kind: 'INCOMPLETE' }, '我想要', state, async () => response('UNCERTAIN'), undefined, 'enforce')).toHaveProperty('kind', 'INCOMPLETE')
})

// Report: frozen live112 D09; Main classified the preceding vague request
// instead of the explicit current payment question in a mixed JSON payload.
it('binds the current utterance to the final user message independently from history', async () => {
  const complete = vi.fn(async (_body: Record<string, unknown>) => response('SERVICE_INFORMATION_ONLY'))
  await resolveServiceHandoff(decision, '我現在要問付款方式', state, complete, { messages: [{ role: 'user', content: '我想問，那個，我還沒說清楚' }] }, 'enforce')
  const messages = complete.mock.calls[0]![0].messages as Array<{ role: string, content: string }>
  expect(messages.at(-1)).toEqual({ role: 'user', content: '我現在要問付款方式' })
  expect(messages.at(-2)!.content).toContain('我想問，那個，我還沒說清楚')
})

// Report: live112 C14-F3/C12-F3; an abstention trace is not an interpreted effect.
it('continues whole-request qualification after bounded Main abstains', async () => {
  const complete = vi.fn(async () => response('ORDER_MUTATION'))
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION', trace: { mainSkill: { selected: 'UNCERTAIN' } } }, '換成水餃一份', state, complete, undefined, 'enforce')
  expect(complete).toHaveBeenCalledOnce()
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', requestScope: 'order-operation' })
})

// Report: frozen live112 C09-A1, attempt477; pausing an unanswered meal
// question was treated as silent background even though the draft survives.
it.each([true, false])('acknowledges an explicit idle request only with a live question: %s', async (live) => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, '先等一下', {
    ...state,
    waitingFor: { questionId: 'configuration-q', purpose: 'item-configuration', question: '請問辣度？', choices: [], expiresAt: Date.now() + (live ? 30000 : -1) },
  }, async () => response('IDLE'), undefined, 'enforce')
  expect(result.kind).toBe(live ? 'NEEDS_ASSISTANT' : 'IGNORE')
  expect(result.reason).toBe(live ? 'GENERAL_QUESTION' : undefined)
  expect(result).not.toHaveProperty('actionId')
})

// Report: frozen live112 C07-A2; service admission may recover while a meal
// draft still waits. That phase does not turn an acknowledgement into a menu query.
it('qualifies a recovered new service response while configuration waits', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'NEW_REQUEST' }, '好', { ...state, phase: 'configuration' }, async () => response('ACKNOWLEDGEMENT'), undefined, 'enforce')
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.reason).toBe('GENERAL_QUESTION')
  expect(result).not.toHaveProperty('actionId')
})

// Report: live112 C11-A2, attempt706; keeping the order unchanged is a
// directed service request, separate from silently browsing on one's own.
it('hands an explicit keep-order request to a read-only service reply', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, '先不要加任何餐', state, async () => response('KEEP_ORDER'), undefined, 'enforce')
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.reason).toBe('GENERAL_QUESTION')
  expect(result).not.toHaveProperty('actionId')
})

// Report: live112 C11-A2; purpose qualification needs current reference
// evidence to distinguish an unbound pointer from an executable meal request.
it('provides the current Menu reference evidence to whole-request qualification', async () => {
  const complete = vi.fn(async (_body: Record<string, unknown>) => response('CLARIFY_SERVICE'))
  await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, '那個兩份', { ...state, references: [], productResolution: { status: 'none', count: 0, references: [] } }, complete, undefined, 'enforce')
  const messages = complete.mock.calls[0]![0].messages as Array<{ role: string, content: string }>
  expect(JSON.parse(messages.at(-2)!.content)).toMatchObject({ references: [], productResolution: { status: 'none', count: 0, references: [] } })
})

// Report: live112 C13-A2, attempt723; recovered service admission plus a
// product mention skipped purpose qualification and reached unrequested checkout.
it('qualifies a recovered named refusal before granting general Main tools', async () => {
  const complete = vi.fn(async () => response('KEEP_ORDER'))
  const result = await resolveServiceHandoff({ ...decision, reason: 'NEW_REQUEST', recovery: { status: 'completed', admission: 'service', disposition: 'assistant' } }, '不要牛肉麵，先這樣', { ...state, catalogEvidence: { products: [{ label: '牛肉麵', matchedText: '牛肉麵', source: 'name' }], categories: [] }, interactionState: { matchingCartLines: 0 } }, complete, undefined, 'enforce')
  expect(complete).toHaveBeenCalledTimes(1)
  expect(result.reason).toBe('GENERAL_QUESTION')
  expect(result).not.toHaveProperty('actionId')
})

// Report: Nov2 invoice replay P02-A2; 還沒輸入完，不要送出 is a complete refusal.
it('lets Main acknowledge a complete keep-order request after Jev calls it unfinished', async () => {
  const result = await resolveServiceHandoff({ kind: 'INCOMPLETE' }, '還沒輸入完，不要送出', { ...state, phase: 'checkout_invoice' }, async () => response('KEEP_ORDER'), undefined, 'enforce')
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' })
  expect(result).not.toHaveProperty('actionId')
})

// Report: reported-20261103-background-service-clarification-loop in orderingIncidents.ts.
it('does not turn unconfirmed recipient scope into a service question after Jev admission', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, '他的資訊給得非常非常的細', state, async () => response('UNCERTAIN'), undefined, 'enforce')
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
})

// Report: user-confirmed Nov4 unbound-reference choice, replacement B03-J-A1.
it('does not reopen a live service question after scope qualification still cannot identify the target', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, '剛才說的那個', { ...state, serviceClarification: { questionId: 'original', question: '請說明餐點名稱', sourceUtterance: '我要那個', contextKey: serviceContextKey(state), expiresAt: Date.now() + 30000 } }, async () => response('CLARIFY_SERVICE'), undefined, 'enforce')
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
})

// Report: Nov4 silence/admission correction; invalid Main scope is a technical failure.
it('does not release an unqualified handoff when Main scope output is invalid', async () => {
  const result = await resolveServiceHandoff(decision, '有其他的嗎', state, async () => response('invented'), undefined, 'enforce')
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result.reason).toBe('INVALID_CHOICE')
})

// Report: semantic1 C05-F1/B01-J-L1; a review clarification is still a purpose proposal.
it.each([false, true])('checks a review clarification before presenting or holding it (live cue=%s)', async (liveCue) => {
  const question = { questionId: 'proposed', question: '請問需要什麼？', sourceUtterance: '背景評論', contextKey: serviceContextKey(state), expiresAt: Date.now() + 30000 }
  const proposed: KioskInteractionDecision = { ...decision, kind: liveCue ? 'UNAVAILABLE' : 'SERVICE_CLARIFICATION', question, reason: 'UNCERTAIN_OPERATION', recovery: { status: 'completed', admission: 'service', disposition: 'clarify' } }
  const result = await resolveServiceHandoff(proposed, '判斷的話就是回答出來的東西', { ...state, ...(liveCue ? { serviceClarification: question } : {}) }, async () => response('BACKGROUND'), undefined, 'enforce')
  expect(result.kind).toBe('IGNORE')
  expect(result).not.toHaveProperty('question')
})

it('continues an understood menu follow-up instead of publishing a premature review question', async () => {
  const proposed: KioskInteractionDecision = { ...decision, kind: 'SERVICE_CLARIFICATION', question: { questionId: 'proposed', question: '要哪一類？', sourceUtterance: '有其他的嗎', contextKey: serviceContextKey(state), expiresAt: Date.now() + 30000 }, recovery: { status: 'completed', admission: 'service', disposition: 'clarify' } }
  const result = await resolveServiceHandoff(proposed, '有其他的嗎', state, async () => response('MENU_INFORMATION_ONLY'), undefined, 'enforce')
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.requestScope).toBe('menu-information')
  expect(result).not.toHaveProperty('question')
})

it('rejects a menu topic proposed for an explicit other recipient', async () => {
  const result = await resolveServiceHandoff(decision, '小王，有其他的嗎', state, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ recipient: 'other', choice: 'MENU_INFORMATION_ONLY' }) } }] } }] }), undefined, 'enforce')
  expect(result.kind).toBe('IGNORE')
  expect(result).not.toHaveProperty('question')
})

// Report: this chat, Nov5; preparation requests use the existing meal confirmation.
it('hands named meal preparation to Main without claiming absence or granting a write', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'NEW_REQUEST' }, '排骨便當一份，不要辣', { ...state, catalogEvidence: { products: [{ label: '排骨便當', matchedText: '排骨便當', source: 'name' }], categories: [] }, unavailableConditionReferences: [{ id: 'spice', label: '辣度' }] }, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_condition_support', arguments: '{"choice":"REQUIREMENT"}' } }] } }] }), undefined, 'enforce')
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', resolvedBy: 'main-service' })
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
})

// Report: this chat, Nov5; a late preparation condition belongs to the active draft.
it('keeps a preparation continuation on its existing draft instead of starting another Jev topic', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'NEW_REQUEST' }, '兩份，不要辣', { ...state, phase: 'configuration', catalogEvidence: { products: [], categories: [] }, retainedRequests: [{ id: 'meal', itemId: 'bento', status: 'active', sourceUtterance: '我要排骨便當', options: [], missing: { quantity: true, optionGroupIds: [] }, expectedRevisions: { menu: 1 } }], unavailableConditionReferences: [{ id: 'spice', label: '辣度' }] }, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_condition_support', arguments: '{"choice":"REQUIREMENT"}' } }] } }] }), undefined, 'enforce')
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.reason).not.toBe('NEW_REQUEST')
  expect(result).not.toHaveProperty('question')
})

// Report: this chat,2026-11-06 — clarification must not offer unrestricted assistance.
it('limits the missing-purpose clarification to menu queries and order adjustments', async () => {
  const result = await resolveServiceHandoff(decision, '幫我一下', state, async () => response('CLARIFY_SERVICE'), undefined, 'enforce')
  expect(result.kind).toBe('SERVICE_CLARIFICATION')
  expect(result).toHaveProperty('question.question', '請再說明您想查詢的餐點，或要調整的訂單內容。')
  expect(result).not.toHaveProperty('actionId')
})
