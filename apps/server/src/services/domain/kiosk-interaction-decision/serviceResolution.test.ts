import type { KioskDecisionState, KioskInteractionDecision } from './contracts'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { expect, it, vi } from 'vitest'

import { resolveServiceHandoff } from './serviceResolution'

const decision: KioskInteractionDecision = { kind: 'NEEDS_ASSISTANT', confidence: 0.95, trace: { model: 'recorded' }, modelCalls: 2, modelQuestions: 2 }
const state: KioskDecisionState = { phase: 'ordering', catalogEvidence: { products: [], categories: [] } }

// Report: this chat, Nov8 — read-only invitation acceptance was reclassified as acknowledgement.
it('preserves a finite answer to the current recommendation invitation without a second qualifier', async () => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"ACKNOWLEDGEMENT"}' } }] } }] }))
  const accepted: KioskInteractionDecision = { kind: 'FAST_ACTION', actionId: 'intent:recommend', answeredQuestionId: 'recommend-1' }
  const result = await resolveServiceHandoff(accepted, '好', { ...state, waitingFor: { questionId: 'recommend-1', purpose: 'recommendation-invitation', question: '需要我幫您推薦餐點嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'intent:recommend', description: '只推薦，不加車。' }] } }, complete)
  expect(result).toEqual(accepted)
  expect(complete).not.toHaveBeenCalled()
})

it.each(['wrong-question', 'write', 'other-purpose'])('does not settle an invalid recommendation answer: %s', async (scenario) => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"ACKNOWLEDGEMENT"}' } }] } }] }))
  await resolveServiceHandoff({ kind: 'FAST_ACTION', actionId: scenario === 'write' ? 'intent:add-item' : 'intent:recommend', answeredQuestionId: scenario === 'wrong-question' ? 'another' : 'recommend-1' }, '好', { ...state, waitingFor: { questionId: 'recommend-1', purpose: scenario === 'other-purpose' ? 'checkout-entry' : 'recommendation-invitation', question: '下一步？', expiresAt: Date.now() + (scenario === 'expired' ? -1 : 30_000), choices: [{ id: 'intent:recommend', description: '只推薦，不加車。' }] } }, complete)
  if (scenario === 'write') {
    // This boundary does not qualify writes; the owned order-answer policy
    // still owns them. Do not manufacture a recommendation settlement.
    expect(complete).not.toHaveBeenCalled()
  }
  else {
    expect(complete).toHaveBeenCalledOnce()
  }
})

// Report: this chat Nov8 — finishing an order was misclassified as generic fulfillment information.
it.each(['ORDER_REVIEW', 'OUT_OF_SCOPE'])('qualifies a generic handoff with a reviewable order: %s', async (choice) => {
  const result = await resolveServiceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' }, '這樣就好', { ...state, intentRecovery: { kind: 'request', candidateIds: ['intent:view-cart'] } }, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice }) } }] } }] }), undefined, 'off')
  expect(result.requestScope).toBe(choice === 'ORDER_REVIEW' ? 'order-information' : 'service-information')
  expect(result).not.toHaveProperty('actionId')
})
function response(choice: string) {
  return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ recipient: 'kiosk', choice }) } }] } }] })
}

// Report: this chat, 2026-11-08; an absent dish was blocked by customization first.
it.each(['鱔魚意麵一份不要辣不要香菜', '香菇飯兩份不要蒜'])('resolves dish identity before unsupported preparation: %s', async (transcript) => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_condition_support', arguments: '{"choice":"REQUIREMENT"}' } }] } }] }))
  const result = await resolveServiceHandoff(decision, transcript, { ...state, unavailableConditionReferences: [{ id: 'preparation', label: '製作調整' }] }, complete)
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('question')
})

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
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  if (choice === 'SERVICE_INFORMATION_ONLY') {
    expect(result.reason).toBe('GENERAL_QUESTION')
    expect(result).not.toHaveProperty('actionId')
  }
  else {
    expect(result).toMatchObject({ reason: 'MENU_QUERY', requestScope: 'menu-information' })
    expect(result).not.toHaveProperty('actionId')
  }
})

// Report: Nov1 C09-A2/C12-F3: a new replacement while fulfillment waits
// was qualified by Main but projected back into read-only uncertainty.
it('admits a whole-turn replacement independently from the waiting answer scope', async () => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, '牛肉麵不要了，改水餃一份', { ...state, intentRecovery: { kind: 'answer', questionId: 'q', requestId: 'r', candidateIds: ['intent:set-fulfillment'] } }, async () => response('ORDER_MUTATION'), undefined, 'enforce')
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', resolvedBy: 'main-service' })
})

// Report: Nov1 C06-F1/C06-A1; an unsupported requirement must not be dropped.
it('keeps preparation on the Menu lookup path instead of asking to retain an unsupported condition', async () => {
  const complete = vi.fn(async () => response('UNCERTAIN'))
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_FILTER' }, '不要辣', { ...state, unavailableConditionReferences: [{ id: 'spice', label: '辣度標示' }] }, complete)
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result).not.toHaveProperty('question')
  expect(complete).not.toHaveBeenCalled()
})

// Report: this chat, Nov08; a nutrition question must create an answerable assistance invitation.
it.each(['低脂', '高蛋白'])('offers nonblocking assistance when nutrition data is absent: %s', async (transcript) => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_condition_support', arguments: '{"choice":"REQUIREMENT"}' } }] } }] }))
  const result = await resolveServiceHandoff(decision, transcript, { ...state, unavailableConditionReferences: [{ id: 'protein', label: '蛋白質' }] }, complete)
  expect(result).toMatchObject({ kind: 'SERVICE_CLARIFICATION', question: { purpose: 'staff-assistance', sourceUtterance: transcript, question: '目前菜單沒有營養標示，無法確認是否符合您的需求。需要服務人員協助嗎？' } })
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
it.each([true, false])('acknowledges an explicit idle request with an unchanged question across silence: %s', async (live) => {
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, '先等一下', {
    ...state,
    waitingFor: { questionId: 'configuration-q', purpose: 'item-configuration', question: '請問辣度？', choices: [], expiresAt: Date.now() + (live ? 30000 : -1) },
  }, async () => response('IDLE'), undefined, 'enforce')
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.reason).toBe('GENERAL_QUESTION')
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

// Report: DEV-810280 Nov8 — re-showing a cart did not fulfill a request to return to the menu.
it('preserves a qualified menu return as its existing effect handoff', async () => {
  const result = await resolveServiceHandoff(decision, '我想繼續點餐', state, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"MENU_RETURN"}' } }] } }] }))
  expect(result.requestScope).toBe('order-operation')
  expect(result).toHaveProperty('handoff', { intent: 'RETURN_MENU', status: 'resolved', itemIds: [], lineIds: [] })
})

// Report: DEV-810280 replay — preserve pure addition separately from mixed edits/replacements.
it('carries whole-turn addition semantics through the existing effect handoff', async () => {
  const result = await resolveServiceHandoff(decision, '我要泰式酸辣魚一份', state, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"ORDER_ADDITION","subjects":["泰式酸辣魚"]}' } }] } }] }))
  expect(result.requestScope).toBe('order-operation')
  expect(result).toHaveProperty('handoff.intent', 'ADD_ONLY')
})

// Report: DEV-810280 Nov8 23:54 — bare add-more was misqualified as addition without meal subjects.
it('repairs an empty addition qualification once into return-to-selection without granting a purchase', async () => {
  const complete = vi.fn()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"ORDER_ADDITION","subjects":[]}' } }] } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"MENU_RETURN","subjects":[]}' } }] } }] }))
  const result = await resolveServiceHandoff(decision, '我要加點', { ...state, phase: 'ordering', interactionState: { screen: 'cart_review', cartItemCount: 2, matchingCartLines: 0 } }, complete)
  expect(complete).toHaveBeenCalledTimes(2)
  expect(result).toHaveProperty('handoff.intent', 'RETURN_MENU')
  expect(result).not.toHaveProperty('actionId')
})

it('never grants a purchase when the single addition repair still lacks a valid meal target', async () => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"ORDER_ADDITION","subjects":[]}' } }] } }] }))
  const result = await resolveServiceHandoff(decision, '還要點餐', state, complete)
  expect(complete).toHaveBeenCalledTimes(2)
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result).not.toHaveProperty('handoff')
  expect(result).not.toHaveProperty('actionId')
})

// Report: this chat Nov09, dQhGzMppwvc-EulxUtK2V — fish -> other choices
// was a menu query rejected by subject validation, then a service lock.
it.each([
  { transcript: '還有其他的嗎？', first: '魚', corrected: [] },
  { transcript: '有鱔魚意麵嗎？', first: '鱔魚麵', corrected: ['鱔魚意麵'] },
])('repairs menu subject provenance once while preserving the current utterance: $transcript', async ({ transcript, first, corrected }) => {
  const complete = vi.fn()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice: 'MENU_INFORMATION_ONLY', subjects: [first] }) } }] } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice: 'MENU_INFORMATION_ONLY', subjects: corrected }) } }] } }] }))
  const result = await resolveServiceHandoff(decision, transcript, { ...state, references: [{ refId: 'ITEM_1', label: '泰式酸辣魚便當' }] }, complete)
  expect(complete).toHaveBeenCalledTimes(2)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', requestScope: 'menu-information' })
  if (corrected.length)
    expect(result).toHaveProperty('handoff.subjects', corrected)
  else
    expect(result).not.toHaveProperty('handoff')
  expect(result).not.toHaveProperty('actionId')
})

// Report: this chat Nov09, ZYfY4d6VYjoPSy_1KqTB- — one dumpling serving
// was already added; 我要三份 became an empty addition and a technical lock.
it.each(['我要三份', '兩份', '改成四份'])('asks about existing quantities versus more food when addition has no named target: %s', async (transcript) => {
  const current = { ...state, phase: 'ordering', interactionState: { cartItemCount: 1, matchingCartLines: 0, lastAddedItemName: '水餃' }, references: [{ refId: 'CART_LINE_1', label: '購物車第1筆水餃' }], catalogEvidence: { products: [], categories: [] } }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"ORDER_ADDITION","subjects":[]}' } }] } }] }))
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION' }, transcript, current, complete)
  expect(result.kind).toBe('SERVICE_CLARIFICATION')
  expect(result).toHaveProperty('question.question', '您想調整已點餐點的總份數，還是另外加點？')
  expect(result).not.toHaveProperty('handoff')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(2)
})

// Report: Nov09 real replay — Main inherited the last-added label even after
// one subject repair. It must not turn an omitted-target quantity into a write.
it.each(['水餃', '周氏水餃(最低8顆)', '紅燒牛肉麵'])('clarifies a contextual addition target that was not named this turn: %s', async (name) => {
  const current = { ...state, interactionState: { cartItemCount: 1, matchingCartLines: 0, lastAddedItemName: name }, references: [{ refId: 'CART_LINE_1', label: `購物車第1筆${name}` }] }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice: 'ORDER_ADDITION', subjects: [name] }) } }] } }] }))
  const result = await resolveServiceHandoff(decision, '我要三份', current, complete)
  expect(result.kind).toBe('SERVICE_CLARIFICATION')
  expect(result).toHaveProperty('question.question', '您想調整已點餐點的總份數，還是另外加點？')
  expect(result).not.toHaveProperty('handoff')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(2)
})

it.each(['provider', 'malformed', 'invented-target'] as const)('does not turn a %s failure into a missing-target clarification', async (scenario) => {
  const current = { ...state, interactionState: { cartItemCount: 1, matchingCartLines: 0 }, references: [{ refId: 'CART_LINE_1', label: '水餃' }] }
  const complete = vi.fn(async () => {
    if (scenario === 'provider')
      return new Response('unavailable', { status: 503 })
    const argumentsText = scenario === 'malformed' ? '{' : '{"choice":"ORDER_ADDITION","subjects":["牛肉麵"]}'
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: argumentsText } }] } }] })
  })
  const result = await resolveServiceHandoff(decision, '我要三份', current, complete)
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result).not.toHaveProperty('actionId')
  expect(result).not.toHaveProperty('question')
})

it('reports provider failure when the subject-repair request fails instead of retaining the earlier validation error', async () => {
  const complete = vi.fn()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"choice":"MENU_INFORMATION_ONLY","subjects":["魚"]}' } }] } }] }))
    .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
  const result = await resolveServiceHandoff(decision, '還有其他的嗎？', state, complete)
  expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' })
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledTimes(2)
})

// Report: this chat, Nov09 — an unsupported food-safety inquiry must not execute Jev's recommendation.
it('handles a food-safety inquiry through existing staff assistance instead of recommendation', async () => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_condition_support', arguments: '{"choice":"REQUIREMENT"}' } }] } }] }))
  const result = await resolveServiceHandoff({ ...decision, kind: 'FAST_ACTION', actionId: 'intent:recommend' }, '說明便當是否符合食安', { ...state, unavailableConditionReferences: [{ id: 'food-safety', label: '食品安全查證' }] }, complete)
  expect(result.kind).toBe('SERVICE_CLARIFICATION')
  expect(result).toHaveProperty('question.purpose', 'staff-assistance')
  expect(result).toHaveProperty('question.question', '餐點的食安資訊，我無法確認。需要幫您呼叫服務人員嗎？')
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledOnce()
})

// Report: this chat, Nov09 — unknown foods were handed to Main without their original lookup subject.
it.each(['麵包', '湯', '飲料', '壽司'])('preserves qualified unknown menu subject %s for an actual lookup', async (subject) => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice: 'MENU_INFORMATION_ONLY', subjects: [subject] }) } }] } }] }))
  const result = await resolveServiceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY' }, `有${subject}嗎`, state, complete)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', requestScope: 'menu-information', handoff: { intent: 'SEARCH_MENU', subjects: [subject] } })
  expect(complete).toHaveBeenCalledTimes(1)
})

// Report: this chat Nov09 — a nonempty order followed by 這樣就好 fell back to generic dialogue.
it.each(['這樣就好', '就這些', '點好了', '不用再加了', '好，就這樣。'])('routes completed selection to review without model guessing or submission: %s', async (transcript) => {
  const complete = vi.fn(async () => response('ACKNOWLEDGEMENT'))
  const result = await resolveServiceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' }, transcript, { ...state, interactionState: { cartItemCount: 3, matchingCartLines: 0, screen: 'menu' }, waitingFor: { questionId: 'recommend', purpose: 'recommendation-invitation', question: '需要推薦嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'intent:recommend', description: '推薦' }] } }, complete)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', requestScope: 'order-information' })
  expect(result).not.toHaveProperty('actionId')
  expect(result).not.toHaveProperty('handoff')
  expect(complete).not.toHaveBeenCalled()
})

it.each(['empty', 'quantity', 'identity', 'checkout', 'draft', 'selected', 'mixed'])('does not turn a contextual answer into order completion: %s', async (scenario) => {
  const complete = vi.fn(async () => response('ACKNOWLEDGEMENT'))
  const question = scenario === 'quantity' ? 'item-order' : scenario === 'identity' ? 'confirm-meal' : scenario === 'checkout' ? 'checkout-entry' : undefined
  const result = await resolveServiceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' }, scenario === 'mixed' ? '這樣就好，再來一份水餃' : '這樣就好', {
    ...state,
    interactionState: { cartItemCount: scenario === 'empty' ? 0 : 3, matchingCartLines: 0, ...(scenario === 'selected' ? { selectedItemName: '水餃' } : {}) },
    ...(scenario === 'draft' ? { activeRequest: { stage: 'thinking', text: '水餃一份' } } : {}),
    ...(question ? { waitingFor: { questionId: 'pending', purpose: question, question: '目前問題', expiresAt: Date.now() + 30_000, choices: [] } } : {}),
  }, complete)
  expect(result.requestScope).not.toBe('order-information')
})

it.each(['intent:recommend', 'intent:defer-question'])('does not let %s swallow an explicit end of selection', async (actionId) => {
  const complete = vi.fn(async () => response('ACKNOWLEDGEMENT'))
  const result = await resolveServiceHandoff({ kind: 'FAST_ACTION', actionId }, '這樣就好', { ...state, interactionState: { cartItemCount: 3, matchingCartLines: 0 } }, complete)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', requestScope: 'order-information' })
  expect(result).not.toHaveProperty('actionId')
  expect(complete).not.toHaveBeenCalled()
})

// Report: this chat Nov09 — an admitted correction stayed permanently read-only behind a generic clarification.
it.each(['ORDER_MUTATION', 'MENU_INFORMATION_ONLY', 'ACKNOWLEDGEMENT'])('requalifies a recovered clarification answer as %s without reusing its old write scope', async (choice) => {
  const current = { ...state, readOnly: true, serviceClarification: { questionId: 'meaning', question: '想調整哪項？', sourceUtterance: '剛才的設定不對', contextKey: 'current', expiresAt: Date.now() + 30000 } }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice, subjects: [] }) } }] } }] }))
  const result = await resolveServiceHandoff({ ...decision, reason: 'UNCERTAIN_OPERATION', recovery: { status: 'completed', admission: 'service', disposition: 'assistant', readOnly: true } }, '把水餃每份加量改為五顆', current, complete)
  expect(complete).toHaveBeenCalledOnce()
  if (choice === 'ORDER_MUTATION')
    expect(result.requestScope).toBe('order-operation')
  else
    expect(result.requestScope).not.toBe('order-operation')
})

// Report: Nov09 real replay — intent accepted 對一份, the verifier called it
// another action, then scope twice inherited the replacement from history.
it.each(['炸排骨便當', '紅燒牛肉麵'])('keeps the live proposal after conflicting interpretation inherits %s', async (name) => {
  const current = { ...state, phase: 'meal_confirmation', waitingFor: { questionId: 'current', requestId: 'proposal', purpose: 'confirm-meal', question: `要改點${name}嗎？`, expiresAt: Date.now() + 30000, choices: [{ id: 'confirm-meal:current:yes', description: '同意' }] }, retainedRequests: [{ id: 'proposal', itemId: 'proposed', status: 'confirming' as const, sourceUtterance: '原需求', options: [], missing: { quantity: false, optionGroupIds: [] }, expectedRevisions: { menu: 0 } }] }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice: 'ORDER_ADDITION', subjects: [name] }) } }] } }] }))
  const result = await resolveServiceHandoff({ ...decision, reason: 'NEW_REQUEST' }, '對一份', current, complete)
  expect(result.kind).toBe('NEEDS_CLARIFICATION')
  expect(result).not.toHaveProperty('actionId')
  expect(result).not.toHaveProperty('recovery')
  expect(result).not.toHaveProperty('answeredQuestionId')
  expect(complete).toHaveBeenCalledTimes(2)
})

// Report: Nov09 real replay — a known ingredient was carried as a named dish,
// so asking for others silently released the original ingredient condition.
it.each([{ id: 'fish', label: '魚' }, { id: 'pork', label: '豬肉' }, { id: 'chicken', label: '雞肉' }])('keeps a verified $label inquiry on condition browsing', async (reference) => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ choice: 'MENU_INFORMATION_ONLY', subjects: [reference.label] }) } }] } }] }))
  const result = await resolveServiceHandoff(decision, `我想吃${reference.label}`, { ...state, ingredientReferences: [reference] }, complete)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', requestScope: 'menu-information' })
  expect(result).not.toHaveProperty('handoff')
  expect(complete).toHaveBeenCalledOnce()
})
