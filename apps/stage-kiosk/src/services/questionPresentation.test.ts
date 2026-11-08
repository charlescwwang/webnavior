import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { menu as sampleMenu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom } from './kiosk-fast-path'
import { createInvitationWindow, createMenuReplyWindow, createServiceClarificationWindow, operationReplyFrom, questionReceiptFrom, replyFromConversation, replyFromOperation, replyFromReceipt, replyWithQuestion } from './questionPresentation'

// Report: this chat, Nov08 — independent lookup prompts were concatenated, then prices repeated.
it('presents two real meal lookups with each price once and one browsing question', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { id: 'rice', name: '雞肉飯', category: '飯', description: '雞肉搭配白飯', price: 95, imageUrl: '', recommendationTags: [], optionGroups: [] },
    { id: 'noodles', name: '牛肉麵', category: '麵', description: '牛肉湯麵', price: 150, imageUrl: '', recommendationTags: [], optionGroups: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const window = createMenuReplyWindow()
  window.record('menu_get', await runtime.invoke('menu_get', { query: '雞肉飯', display: true }))
  window.record('menu_get', await runtime.invoke('menu_get', { query: '牛肉麵', display: true }))
  const reply = replyWithQuestion(window.reply(), undefined, 'ordering')
  expect(reply.match(/95元/g)).toHaveLength(1)
  expect(reply.match(/150元/g)).toHaveLength(1)
  expect(reply.match(/[?？]/g)).toHaveLength(1)
  expect(reply).not.toContain('這道餐點要點幾份')
  expect(reply).toContain('哪一道')
})

// Report: this chat, Nov08 — a factual detour must resume the real option question only.
it('uses the current validated question instead of a lookup quantity invitation', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ id: 'meal', name: '雞肉飯', category: '飯', description: '', price: 95, imageUrl: '', recommendationTags: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const receipt = await runtime.invoke('menu_get', { query: '雞肉飯', display: true })
  const question = { questionId: 'size', purpose: 'item-configuration', question: '請問要小份還是大份？', choices: [], expiresAt: Date.now() + 30000 }
  expect(replyFromReceipt(receipt, question)).not.toContain('要點幾份')
  expect(replyFromReceipt(receipt, question)?.match(/[?？]/g)).toHaveLength(1)
  expect(replyFromReceipt(receipt, question)).toContain(question.question)
})

// Report: this chat, Nov08; unclear input needs a finite path, not a repeated question loop.
it('asks once, offers assistance once, then stops asking until real progress or a reset', () => {
  const window = createServiceClarificationWindow()
  const state = { phase: 'ordering' as const }
  expect(window.clarify(state, '不明需求')?.purpose).toBeUndefined()
  expect(window.clarify(state, '仍不清楚')?.purpose).toBe('staff-assistance')
  expect(window.clarify(state, '還是不清楚')).toBeUndefined()
  window.settle({ kind: 'UNAVAILABLE' })
  expect(window.clarify(state, '再來一次')).toBeUndefined()
  window.reset()
  expect(window.clarify(state, '新訪客的需求')?.purpose).toBeUndefined()
})

it('adds open guidance only to ordinary ordering and never replaces an owned question', () => {
  expect(replyWithQuestion('已加入餐點。', undefined, 'ordering')).toBe('已加入餐點。 接下來想點哪道餐點？')
  expect(replyWithQuestion('訂單已完成。', undefined, 'checkout_complete')).toBe('訂單已完成。')
  expect(replyWithQuestion('付款處理中。', undefined, 'payment_locked')).toBe('付款處理中。')
  expect(replyWithQuestion('還想吃什麼？', undefined, 'ordering')).toBe('還想吃什麼？')
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct29 cancellation -> takeout.
it.each(['我不要便當了', '我不要便當了，哪有說我要自取'])('keeps an unresolved operation conversational without allowing an unrelated write: %s', async (transcript) => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const item = sampleMenu[0]!
  await runtime.invoke('order_add_item', { itemId: item.id, quantity: 1 })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const state = conversationDecisionStateFrom(await runtime.invoke('kiosk_interaction_state'), { reason: 'UNCERTAIN_OPERATION' })
  expect(state?.readOnly).toBe(true)
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'uncertain-cancellation', transcript, expectedMenuRevision: state!.menuRevision, readOnly: state!.readOnly, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  await expect(runtime.invokeForAgent('order_set_fulfillment', { mode: 'takeout' })).rejects.toThrow('not available')
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], reply: { kind: 'clarification' } }, { menu: createMenuReplyWindow(), context, failureMessage: '再試一次。' })
  expect(reply.role).toBe('assistant')
  expect(reply.content).not.toContain('再試一次')
  expect(reply.content).not.toContain('已移除')
  expect(context.cart).toEqual(before.cart)
  expect(context.cart.fulfillmentMode).toBe(before.cart.fulfillmentMode)
})

// Report: Oct29 Main returned unsupported prose, then Host showed an unverified-reply error.
it('turns an unverified no-operation completion into an owned clarification instead of a retry error', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: sampleMenu[0]!.id, quantity: 1 })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '已移除便當，現在只剩水餃。' }, { menu: createMenuReplyWindow(), context, handoff: { intent: 'REMOVE_ITEM' }, failureMessage: '再試一次。' })
  expect(result.role).toBe('assistant')
  expect(result.content).not.toContain('已移除')
  expect(result.content).not.toContain('再試一次')
  expect(result.content).toContain('查詢哪道餐點，或調整哪項訂單內容')
  expect(result).toHaveProperty('clarification', true)
  expect(parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context')).cart).toEqual(context.cart)
})

it('does not replace a failed or attempted write with a meaning clarification', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['cart_remove_item'], answer: '已移除。' }, { menu: createMenuReplyWindow(), context, handoff: { intent: 'REMOVE_ITEM' }, failureMessage: '我還不能確認這次移除的結果。' })
  expect(result.role).toBe('error')
  expect(result.content).toBe('我還不能確認這次移除的結果。')
  expect(result).not.toHaveProperty('clarification')
})

// Report: this chat, 2026-10-26; XCUxZDdu entries213–217 and LtPeoyq9 entries45–49.
it.each([
  { phase: 'ordering', answer: '我們目前菜單中沒有湯包。' },
  { phase: 'checkout_payment_select', answer: '目前支援 LINE Pay 與街口支付。' },
])('retains the guard against unsupported free-prose facts after uncertain handoff in $phase', ({ phase, answer }) => {
  const state = conversationDecisionStateFrom({ phase }, { reason: 'UNCERTAIN_OPERATION' })
  const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer }, {
    menu: createMenuReplyWindow(),
    requireMenuRead: state?.requireMenuRead,
    serviceReply: state?.serviceReply,
    failureMessage: '這次沒能完成回覆，請再試一次，或使用螢幕操作。',
  })
  // Free prose is still not evidence. Structured replies below obtain facts
  // from a fresh context instead of trusting the model's claimed answer.
  expect(result.role).toBe('error')
  expect(result.content).toBe('這次沒能完成回覆，請再試一次，或使用螢幕操作。')
})

// Report: this chat, 2026-10-26; explanations were blocked despite available Menu facts.
it('answers structured information and clarification from the current context without authorizing a write', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  context.paymentMethods = [{ id: 'linepay', label: 'LINE Pay' }, { id: 'jkopay', label: '街口支付' }]
  context.allowedPaymentMethods = ['linepay', 'jkopay']
  const before = context.cart
  const present = (value: unknown) => replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: JSON.stringify(value) }, { menu: createMenuReplyWindow(), context, failureMessage: '未完成。' })
  expect(present({ kind: 'payment-methods' })).toEqual({ role: 'assistant', content: '付款方式請依店家結帳指示。接下來想點哪道餐點？' })
  expect(present({ kind: 'menu-information', subjects: ['湯包'] })).toEqual({ role: 'assistant', content: '目前沒有提供「湯包」。您想查詢哪道餐點？' })
  expect(present({ kind: 'clarification' }).role).toBe('assistant')
  expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['kiosk_session_history'], answer: '{"kind":"clarification"}' }, { menu: createMenuReplyWindow(), context, failureMessage: '未完成。' }).role).toBe('assistant')
  expect(present({ kind: 'payment-methods', answer: '已完成付款。' })).toHaveProperty('clarification', true)
  expect(present({ kind: 'payment-methods', answer: '已完成付款。' }).content).not.toContain('已完成付款')
  expect(present({ kind: 'operation-result', answer: '已加入水餃。' })).toHaveProperty('clarification', true)
  expect(present({ kind: 'operation-result', answer: '已加入水餃。' }).content).not.toContain('已加入')
  expect(parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context')).cart).toEqual(before)
})

it('requires fresh complete catalog evidence and retains display and mutation receipt requirements', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const result = { status: 'completed' as const, agentMode: 'active' as const, requestedTools: [], answer: JSON.stringify({ kind: 'menu-information', subjects: ['水餃'] }) }
  expect(replyFromConversation(result, { menu: createMenuReplyWindow(), context, requireMenuRead: true, failureMessage: '未展示。' })).toHaveProperty('clarification', true)
  expect(replyFromConversation(result, { menu: createMenuReplyWindow(), context, handoff: { intent: 'ADD_ITEM' }, failureMessage: '未加入。' })).toHaveProperty('clarification', true)
  context.catalog = undefined
  expect(replyFromConversation(result, { menu: createMenuReplyWindow(), context, failureMessage: '資料不足。' })).toHaveProperty('clarification', true)
})

it('does not let a menu read finish a known removal task', () => {
  const menu = createMenuReplyWindow()
  menu.record('menu_get', JSON.stringify({ items: [{ id: 'pork', name: '排骨便當' }], customerMessage: '目前查不到排骨飯。' }))
  const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_get'], answer: '目前查不到排骨飯。' }, { menu, handoff: { intent: 'REMOVE_ITEM' }, failureMessage: '請確認要移除的餐點。' })
  expect(result.content).toBe('請確認要移除的餐點。')
})

// Report: this chat, 2026-10-21; a resolved store FAQ must not require a menu receipt.
it('allows verified service-information scope without granting an order mutation', () => {
  const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [], categories: [] } }, { reason: 'GENERAL_QUESTION' })
  expect(state).toHaveProperty('readOnly', true)
  expect(state).not.toHaveProperty('requireMenuRead')
  expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '營業時間為11:00到14:00。' }, { menu: createMenuReplyWindow(), requireMenuRead: state?.requireMenuRead, serviceReply: state?.serviceReply, failureMessage: '未完成。' })).toEqual({ role: 'assistant', content: '營業時間為11:00到14:00。' })
})

// Report: this chat, 2026-10-20 — retracted order while the phone page is still visible.
it('does not trust free prose for uncertain phone-stage meaning', () => {
  const state = conversationDecisionStateFrom({ phase: 'customer_entry', catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] }, interactionState: { screen: 'customer_entry', matchingCartLines: 0 } }, { reason: 'UNCERTAIN_OPERATION' })
  expect(state).toHaveProperty('readOnly', true)
  expect(state).not.toHaveProperty('requireMenuRead')
  expect(conversationDecisionStateFrom(state)).toHaveProperty('readOnly', true)
  expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '好的，這份水餃先不點。' }, { menu: createMenuReplyWindow(), requireMenuRead: state?.requireMenuRead, serviceReply: state?.serviceReply, failureMessage: '未完成。' })).toEqual({ role: 'error', content: '未完成。' })
})

it.each(['configuration', 'clarification', 'meal_confirmation', 'pending_confirmation', 'checkout_payment_select', 'checkout_payment_pending'])('does not give an uncertain %s handoff authority to answer a question or mutate checkout', (phase) => {
  const waitingFor = { questionId: 'Q1', purpose: 'confirmation', question: '確認操作嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'confirm', description: '確認' }] }
  const state = conversationDecisionStateFrom({ phase, waitingFor }, { reason: 'UNCERTAIN_OPERATION' })
  expect(state).toHaveProperty('readOnly', true)
  expect(state).not.toHaveProperty('requireMenuRead')
  expect(state).toHaveProperty('waitingFor', waitingFor)
})

it('retains separate unfinished speech as unverified context instead of merging it into a new order', () => {
  const fragment = { transcript: '我要兩份……', expiresAt: Date.now() + 3000 }
  const state = conversationDecisionStateFrom({ phase: 'ordering', incompleteSpeech: fragment }, { reason: 'UNCERTAIN_OPERATION' })
  expect(state).toHaveProperty('incompleteSpeech', fragment)
  expect(state?.incompleteSpeech).not.toHaveProperty('related', true)
  expect(state).not.toHaveProperty('requireMenuRead')
})

it.each([true, false])('does not inherit checkout consent from an uncertain answer (question live=%s)', (live) => {
  const waitingFor = { questionId: 'checkout', purpose: 'checkout-entry', question: '開始結帳嗎？', expiresAt: Date.now() + (live ? 30_000 : -30_000), choices: [{ id: 'checkout', description: '開始結帳' }] }
  const state = conversationDecisionStateFrom({ phase: 'ordering', waitingFor }, { reason: 'UNCERTAIN_OPERATION' })
  expect(state?.readOnly).toBe(true)
  expect(state).not.toHaveProperty('requireMenuRead')
  expect(state).toHaveProperty('waitingFor', waitingFor)
})

// Report: this chat, query-action voice clarification, 2026-10-19.
it('presents the application-owned query question without a choice panel or dish claims', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const receipt = await runtime.invokeForAgent('menu_recommend', { action: 'clarify' })
  const window = createMenuReplyWindow()
  window.record('menu_recommend', receipt)
  expect(window.hasReceipts()).toBe(true)
  expect(window.reply()).toBe('您想找哪一道餐點？')
  expect(receipt).not.toHaveProperty('pendingCustomerChoice')
  expect(receipt).not.toHaveProperty('presentation')
})

describe('question presentation receipts', () => {
  it('retains phone entry even when a stale factual lookup has a valid presentation receipt', () => {
    const menu = createMenuReplyWindow()
    menu.record('menu_recommend', { items: [{ id: 'bento', name: '炸排骨便當', price: 130 }], customerMessage: '推薦一項：炸排骨便當。' })
    const customerEntry = { phase: 'customer_entry', prompt: '請先填寫手機或選擇略過。' }
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_recommend', 'menu_show_recommendations'] }, { menu, requireMenuRead: true, failureMessage: '失敗。', customerEntry })).toEqual({ role: 'assistant', content: customerEntry.prompt })
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_recommend', 'order_add_item'] }, { menu, requireMenuRead: true, failureMessage: '失敗。', customerEntry })).toEqual({ role: 'assistant', content: customerEntry.prompt })
  })

  it('explains pending phone entry instead of an empty recommendation or blocked order result', () => {
    const menu = createMenuReplyWindow()
    menu.record('menu_recommend', { items: [], customerMessage: '目前沒有查到符合條件的餐點。' })
    const customerEntry = { phase: 'customer_entry', prompt: '請先填寫手機或選擇略過。' }
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_recommend'] }, { menu, failureMessage: '失敗。', customerEntry })).toEqual({ role: 'assistant', content: customerEntry.prompt })
    expect(replyFromConversation({ status: 'failed', agentMode: 'active', requestedTools: ['order_add_item'] }, { menu: createMenuReplyWindow(), failureMessage: '失敗。', customerEntry })).toEqual({ role: 'assistant', content: customerEntry.prompt })
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_recommend'] }, { menu, failureMessage: '失敗。', customerEntry: { ...customerEntry, phase: 'ordering' } })).toEqual({ role: 'assistant', content: '目前沒有查到符合條件的餐點。' })
  })

  // Report: this chat, session McJ8clPpBKvNt_XMYWFRq, 2026-10-18.
  it('requires fresh menu evidence for a catalog-grounded replacement handoff before publishing dish examples', () => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }], categories: [] }, references: [{ label: '購物車水餃', refId: 'CART_LINE_1' }] }, { reason: 'NEW_REQUEST' })
    expect(state).toMatchObject({ requireMenuRead: true })
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '請提供牛肉麵名稱，例如紅燒或清燉牛肉麵。' }, { menu: createMenuReplyWindow(), requireMenuRead: state?.requireMenuRead, serviceReply: state?.serviceReply, failureMessage: '查詢未完成。' })).toEqual({ role: 'error', content: '查詢未完成。' })
  })

  // Report: Nov1 C09-A2/C12-F3 whole-turn replacement replay.
  it.each([undefined, 'INFORMATION'])('preserves whole-request operation scope with price choice %s', (priceChoiceId) => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } }, { reason: 'NEW_REQUEST', resolvedBy: 'main-service', requestScope: 'order-operation', priceChoiceId })
    expect(state).not.toHaveProperty('requireMenuRead')
    expect(state).not.toHaveProperty('readOnly')
  })

  it('does not reinterpret a phone-stage provider fallback as an admitted factual menu query', () => {
    const state = conversationDecisionStateFrom({ phase: 'customer_entry', catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }], categories: [] } }, { reason: 'PROVIDER_FAILURE' })
    expect(state).not.toHaveProperty('requireMenuRead')
  })

  // Report: this chat, 2026-10-19, visitor session hIHA3DAvjhrG8x0RjggBa.
  it('rejects invented noodles after an unmatched food refusal and retains its evidence requirement across continuations', () => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [], categories: [] }, productResolution: { status: 'none', count: 0, references: [] }, references: [{ label: '剛展示的蝦捲招牌便當', refId: 'ITEM_1' }] }, {})
    expect(state).toMatchObject({ requireMenuRead: true })
    const continued = conversationDecisionStateFrom(state)
    expect(continued).toMatchObject({ requireMenuRead: true })
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '推薦3項麵食：紅燒牛肉麵、麻醬麵、酸辣湯麵。' }, { menu: createMenuReplyWindow(), requireMenuRead: continued?.requireMenuRead, failureMessage: '查詢未完成。' })).toEqual({ role: 'error', content: '查詢未完成。' })
    const menu = createMenuReplyWindow()
    menu.record('menu_get', { items: [{ id: 'beef', name: '紅燒牛肉麵', price: 150 }], customerMessage: '我找到：紅燒牛肉麵。' })
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_get'], answer: '推薦3項麵食：紅燒牛肉麵、麻醬麵、酸辣湯麵。' }, { menu, requireMenuRead: continued?.requireMenuRead, failureMessage: '查詢未完成。' })).toEqual({ role: 'assistant', content: '我找到：紅燒牛肉麵。' })
  })

  it('keeps identity dialogue natural when only old cart references remain', () => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [], categories: [] }, references: [{ label: '購物車水餃', refId: 'CART_LINE_1' }], interactionState: { matchingCartLines: 0, lastAddedItemName: '水餃', screen: 'menu' } }, { reason: 'GENERAL_QUESTION' })
    expect(state).not.toHaveProperty('requireMenuRead')
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '我是點餐助手。' }, { menu: createMenuReplyWindow(), requireMenuRead: state?.requireMenuRead, serviceReply: state?.serviceReply, failureMessage: '查詢未完成。' })).toEqual({ role: 'assistant', content: '我是點餐助手。' })
  })

  it('does not publish a no-tool fabricated recommendation for a turn requiring menu evidence', () => {
    const menu = createMenuReplyWindow()
    const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '推薦3 項：香菜肉絲乾麵、韭菜盒、甜不辣。' }, { menu, requireMenuRead: true, failureMessage: '查詢失敗。' })
    expect(result).toEqual({ role: 'error', content: '查詢失敗。' })
    expect(result.content).not.toContain('韭菜盒')
  })
  // Report: attachment 44310a20-ae6f-4e32-84e9-3b36bf0c5298, this chat, 2026-10-20.
  it('keeps a qualified compound request writable but does not upgrade uncertain meaning to operation authority', () => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }, { label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } }, { reason: 'UNCERTAIN_OPERATION' })
    expect(state).not.toHaveProperty('requireMenuRead')
    expect(state).toHaveProperty('readOnly', true)
    const qualified = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }, { label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } }, { reason: 'NEW_REQUEST' })
    expect(qualified).not.toHaveProperty('readOnly')
  })

  it.each(['MENU_QUERY', 'UNCERTAIN_FILTER', 'UNRESOLVED_FILTER', 'UNSUPPORTED_FILTER', 'UNSUPPORTED_PRICE'] as const)('keeps %s handoffs read-only while retaining ordinary mutation tasks', (reason) => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [], categories: [{ label: '便當', matchedText: '便當', itemCount: 5 }] } }, { reason })
    expect(state).toMatchObject({ readOnly: true, requireMenuRead: true })
    expect(conversationDecisionStateFrom(state)).toMatchObject({ readOnly: true })
    expect(conversationDecisionStateFrom({ phase: 'ordering' }, { reason: 'NEW_REQUEST' })).not.toHaveProperty('readOnly')
  })

  it.each(['MENU_QUERY', 'UNCERTAIN_FILTER', 'UNRESOLVED_FILTER'] as const)('requires a lookup for %s even when an unfamiliar subject has no catalog evidence', (reason) => {
    expect(conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [], categories: [] } }, { reason })).toMatchObject({ readOnly: true, requireMenuRead: true })
  })

  it('carries a food-query handoff into a required read without blocking ordinary conversation', () => {
    expect(conversationDecisionStateFrom({ phase: 'customer_entry' }, { reason: 'MENU_QUERY' })).toMatchObject({ requireMenuRead: true })
    expect(conversationDecisionStateFrom({ phase: 'customer_entry' })).not.toHaveProperty('requireMenuRead')
  })
  // Report: local customer attachment 9b8c37b5-50d8-4d5c-a928-0dcaa0712dab, no public URL.
  it('uses current-turn receipts rather than the previously displayed dumplings to answer a new order', () => {
    const previous = createMenuReplyWindow()
    previous.record('menu_get', { customerMessage: '我找到：水餃。', items: [{ id: 'd', name: '水餃', price: 80 }] })
    expect(previous.reply()).toBe('我找到：水餃。')
    const current = createMenuReplyWindow()
    expect(replyFromOperation('已加入牛肉麵。', current.reply(), undefined)).toBe('目前沒有可驗證的餐點查詢結果，請告訴我想找的餐點或條件，或使用畫面選餐。')
    expect(replyFromOperation(current.reply(), '已將紅燒牛肉麵加入購物車，共 1 份。', undefined)).toBe('已將紅燒牛肉麵加入購物車，共 1 份。')
  })

  it('does not narrate invented vegetarian recommendations after an empty actual menu query', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const result = await runtime.invokeForAgent('menu_recommend', { action: 'update', dietary: 'vegetarian' })
    const window = createMenuReplyWindow()
    window.record('menu_recommend', result)
    const reply = replyFromOperation('推薦松露素麵和田園沙拉。', window.reply(), undefined)
    expect(reply).toBe(operationReplyFrom(result))
    expect(reply).not.toContain('松露素麵')
  })
  it('retains multiple same-turn lookup receipts instead of using an unrelated last read', () => {
    const window = createMenuReplyWindow()
    window.record('menu_get', { customerMessage: '我找到：牛肉麵。', items: [{ id: 'n', name: '牛肉麵', price: 150 }] })
    window.record('menu_get', { customerMessage: '我找到：水餃。', items: [{ id: 'd', name: '水餃', price: 80 }] })
    window.record('cart_get', { customerMessage: '購物車是空的。' })
    expect(window.reply()).toBe('我找到：牛肉麵。 我找到：水餃。 單份基本售價：牛肉麵 150元、水餃 80元。')
    expect(replyFromOperation('沒有經過查詢的推薦。', createMenuReplyWindow().reply(), undefined)).toBe('目前沒有可驗證的餐點查詢結果，請告訴我想找的餐點或條件，或使用畫面選餐。')
  })
  it('keeps a cart-only summary grounded without requiring a new menu query', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 2 })
    const window = createMenuReplyWindow()
    window.record('cart_get', await runtime.invokeForAgent('cart_get', { display: false }))
    expect(window.reply()).toBe('目前訂單：蝦捲 2 份。合計 150元。')
  })
  const question = { questionId: 'Q1', purpose: 'checkout-entry', question: '要進入結帳流程嗎？', expiresAt: 100, choices: [{ id: 'intent:start-checkout', description: '開始結帳，進入會員與發票步驟。' }] }
  it('retains superseded invitation records without letting stale decisions consume the current one', () => {
    const window = createInvitationWindow()
    window.present({ ...question, questionId: 'I1', purpose: 'recommendation-invitation' })
    window.present({ ...question, questionId: 'I2', purpose: 'recommendation-invitation' })
    window.resolve({ supersededQuestionId: 'I1' })
    expect(window.decisionState({ phase: 'ordering' }, 1000)?.waitingFor?.questionId).toBe('I2')
    window.resolve({ supersededQuestionId: 'I2' })
    expect(window.decisionState({ phase: 'ordering' }, 1000)).not.toHaveProperty('waitingFor')
    expect(window.history()).toMatchObject([{ question: { questionId: 'I1' }, status: 'superseded' }, { question: { questionId: 'I2' }, status: 'superseded' }])
    window.reset()
    expect(window.history()).toEqual([])
  })
  it('retains a presented invitation across idle without replacing a service-owned question', () => {
    const window = createInvitationWindow()
    const invitation = { ...question, questionId: 'I1', purpose: 'recommendation-invitation', question: '需要我推薦幾樣餐點嗎？', choices: [{ id: 'intent:recommend', description: '推薦三樣餐點，不新增訂購。' }] }
    window.present(invitation)
    expect(window.decisionState({ phase: 'ordering' }, 55000)?.waitingFor).toMatchObject({ questionId: 'I1', expiresAt: 85000 })
    expect(window.decisionState({ phase: 'ordering', waitingFor: question }, 55000)?.waitingFor).toBe(question)
    expect(window.decisionState({ phase: 'configuration' }, 55000)?.waitingFor).toBeUndefined()
    window.resolve({ answeredQuestionId: 'old-id' })
    expect(window.decisionState({ phase: 'ordering' }, 55000)?.waitingFor?.questionId).toBe('I1')
    window.resolve({ answeredQuestionId: 'I1' })
    expect(window.decisionState({ phase: 'ordering' }, 55000)?.waitingFor).toBeUndefined()
    expect(window.history()).toMatchObject([{ question: { questionId: 'I1' }, status: 'answered' }])
    window.reset()
    expect(window.history()).toEqual([])
  })
  // Report: attachment c1d194f6; one receipt carried the same text in outcome and pending question.
  it('composes one validated question without duplicating the explicit outcome', () => {
    expect(replyFromReceipt({ customerMessage: question.question, pendingCustomerChoice: question }, question)).toBe(question.question)
    expect(replyFromReceipt({ customerMessage: `已設為自取。 ${question.question}`, pendingCustomerChoice: question }, question)).toBe(`已設為自取。 ${question.question}`)
    expect(replyFromReceipt({ customerMessage: '已設為自取。', pendingCustomerChoice: question }, question)).toBe(`已設為自取。 ${question.question}`)
    expect(replyFromReceipt({ pendingCustomerChoice: question }, question)).toBe(question.question)
    expect(replyFromReceipt({ pendingCustomerChoice: question })).toBeUndefined()
    expect(replyFromReceipt({ cart: { itemCount: 1 } })).toBe('目前購物車共有 1 份餐點。')
  })

  it('renders a correlated question with a natural answer, without deriving authority from that answer', () => {
    expect(questionReceiptFrom('準備結帳嗎？')).toBeUndefined()
    expect(questionReceiptFrom(JSON.stringify({ pendingCustomerChoice: question }))).toEqual(question)
    expect(replyWithQuestion('已設為自取。', question)).toBe('已設為自取。 要進入結帳流程嗎？')
    expect(replyWithQuestion('已設為自取。 要進入結帳流程嗎？', question)).toBe('已設為自取。 要進入結帳流程嗎？')
  })

  it('preserves bounded question effects for both Jev and Main Agent, without private payloads', () => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', waitingFor: { ...question, holdId: 'private', choices: [{ ...question.choices[0], slots: { lineId: 'internal' } }] } })
    expect(state?.waitingFor).toEqual(question)
    expect(JSON.stringify(state)).not.toContain('private')
    expect(JSON.stringify(state)).not.toContain('internal')
  })
  it('renders only the application question and outcome instead of a competing Agent question', () => {
    const fulfillment = { ...question, purpose: 'fulfillment', question: '請問要內用還是自取？' }
    const outcome = operationReplyFrom(JSON.stringify({ customerMessage: '已加入水餃。', pendingCustomerChoice: fulfillment }))
    expect(replyFromOperation('已加入水餃，要內用還是外帶？', outcome, fulfillment)).toBe('已加入水餃。 請問要內用還是自取？')
    expect(replyFromOperation('內用還是外帶？', undefined, fulfillment)).toBe('請問要內用還是自取？')
    expect(replyFromOperation('這是模擬支付成功。', '付款狀態尚未確認。', undefined)).toBe('付款狀態尚未確認。')
    expect(replyFromOperation('水餃每份十顆。', undefined, undefined)).toBe('水餃每份十顆。')
  })
  it('preserves POS fulfillment choices in both decision transports', () => {
    const fulfillmentModes = [{ id: 'takeout', label: '櫃台自取' }]
    expect(conversationDecisionStateFrom({ phase: 'ordering', fulfillmentModes })).toMatchObject({ fulfillmentModes })
  })
  it('presents the actual runtime receipt once and activates only its POS choices', async () => {
    const runtime = createMenuToolRuntime({ fulfillmentModes: [{ id: 'takeout', label: '櫃台自取' }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const result = await runtime.invokeForAgent('order_add_item', { itemId: 'chous-shrimp-roll' })
    const offered = questionReceiptFrom(result)!
    const validated = questionReceiptFrom(await runtime.invoke('kiosk_question_validate', { questionId: offered.questionId }))!
    const answer = replyFromOperation('已加入餐點。要內用還是外帶？', operationReplyFrom(result), validated)
    expect(answer).toBe('已將蝦捲加入購物車，共 1 份。 請問要櫃台自取？')
    await runtime.invoke('kiosk_dialogue_presented', { content: answer, questionId: validated.questionId })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '自取' }) as { waitingFor: { question: string }, candidates: Array<{ id: string }> }
    expect(context.waitingFor.question).toBe('請問要櫃台自取？')
    expect(context.candidates.map(choice => choice.id)).toContain('intent:set-fulfillment:takeout')
    expect(context.candidates.map(choice => choice.id)).not.toContain('intent:set-fulfillment:dine-in')
  })
})

describe('preference lookup receipts', () => {
  // Report: this chat, 2026-10-19 — internal catalog reads must not reintroduce rejected dishes.
  it('speaks only the filtered recommendation after an internal catalog lookup', async () => {
    const runtime = createMenuToolRuntime({ menu: [
      { ...sampleMenu[0]!, id: 'bento', name: '便當', category: '飯類' },
      { ...sampleMenu[0]!, id: 'salad', name: '田園沙拉', category: '沙拉' },
    ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const window = createMenuReplyWindow()
    window.record('menu_get', await runtime.invokeForAgent('menu_get', { display: false }))
    expect(window.hasReceipts()).toBe(false)
    window.record('menu_recommend', await runtime.invokeForAgent('menu_recommend', { action: 'update', excludeItemIds: ['bento'] }))
    expect(window.hasReceipts()).toBe(true)
    expect(window.reply()).toBe('推薦一項：田園沙拉。')
    expect(window.reply()).not.toContain('便當')
  })
})

// Report: Oct28; typed clarification must not revive a prior purchase confirmation.
it('pauses an unexecuted demand with a neutral clarification instead of a failure or stale purchase question', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  context.waitingFor = { questionId: 'old', purpose: 'confirmation', question: '確定加購水餃嗎？', choices: [], expiresAt: Date.now() + 30000 }
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], reply: { kind: 'clarification' }, answer: '已加入水餃。' }, { context, menu: createMenuReplyWindow(), handoff: { intent: 'ADD_ITEM' }, failureMessage: '失敗。' })
  expect(reply.role).toBe('assistant')
  expect(reply.content).toContain('您想查詢哪道餐點')
  expect(reply.content).not.toContain('水餃')
})

it('renders a typed hearing check without inventing fulfillment or payment facts', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], reply: { kind: 'hearing-check' } }, { context, menu: createMenuReplyWindow(), failureMessage: '失敗。' })
  expect(reply.role).toBe('assistant')
  expect(reply.content).toContain('有收到您的這句話')
  expect(reply.content).not.toContain('內用')
  expect(reply.content).not.toContain('刷卡')
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30.
it('presents a reviewed clarification after reads instead of replacing it with menu availability', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const menu = createMenuReplyWindow()
  menu.record('menu_get', { items: [], customerMessage: '沒有查到。' })
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_get'], reply: { kind: 'clarification' } }, { menu, context, failureMessage: '失敗。' })
  expect(reply.role).toBe('assistant')
  expect(reply.content).toContain('查詢哪道餐點，或調整哪項訂單內容')
  expect(reply.content).not.toContain('沒有查到')
})

it('presents an owned waiting question without claiming completion or reporting an error', () => {
  const question = { questionId: 'quantity', requestId: 'draft', purpose: 'item-configuration', question: '水餃要幾份？', expiresAt: Date.now() + 30000, choices: [] }
  const receipts = createMenuReplyWindow()
  receipts.record('order_add_item', { customerMessage: question.question, pendingCustomerChoice: question })
  const result = replyFromConversation({ status: 'waiting', agentMode: 'active', requestedTools: ['order_add_item'], question }, { menu: receipts, question, outcome: question.question, handoff: { intent: 'ADD_ITEM' }, failureMessage: '系統失敗，請重試。' })
  expect(result).toEqual({ role: 'assistant', content: question.question })
})

it('retains every confirmed operation receipt when a later operation fails', () => {
  const receipts = createMenuReplyWindow()
  receipts.record('order_add_item', { customerMessage: '水餃兩份已加入。' })
  receipts.record('order_add_item', { customerMessage: '牛肉麵一份已加入。' })
  receipts.record('cart_remove_item', { ok: false, customerMessage: '全部移除了。' })
  const result = replyFromConversation({ status: 'incomplete', agentMode: 'active', requestedTools: ['order_add_item', 'order_add_item', 'cart_remove_item'], reason: 'tool-rejected' }, { menu: receipts, outcome: '牛肉麵一份已加入。', failureMessage: '移除未完成。' })
  expect(result.content).toContain('水餃兩份已加入。')
  expect(result.content).toContain('牛肉麵一份已加入。')
  expect(result.content).toContain('移除未完成。')
  expect(result.content).not.toContain('全部移除了')
})

it('cannot revive a question rejected by final Menu validation from the raw loop result', () => {
  const question = { questionId: 'stale', purpose: 'item-configuration', question: '舊水餃要幾份？', expiresAt: Date.now() - 1, choices: [] }
  const result = replyFromConversation({ status: 'waiting', agentMode: 'active', requestedTools: ['order_add_item'], question }, { menu: createMenuReplyWindow(), question: undefined, failureMessage: '問題已變更，請確認畫面。' })
  expect(result).toEqual({ role: 'error', content: '問題已變更，請確認畫面。' })
})

it('reports accepted effects as partial progress when the requested effect is still missing', () => {
  const receipts = createMenuReplyWindow()
  receipts.record('order_add_item', { customerMessage: '水餃一份已加入。' })
  const result = replyFromConversation({ status: 'incomplete', agentMode: 'active', requestedTools: ['order_add_item', 'cart_remove_item'], reason: 'tool-rejected' }, { menu: receipts, handoff: { intent: 'REMOVE_ITEM' }, failureMessage: '移除尚未完成。' })
  expect(result.content).toBe('水餃一份已加入。 移除尚未完成。')
})

// Report: live112 C09-F3, price inquiry interrupted the retained sauce answer.
it.each(['MENU_QUERY', 'NEW_REQUEST'] as const)('keeps a qualified factual price selector read-only after %s', (reason) => {
  const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [{ label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } }, { reason, priceChoiceId: 'INFORMATION' })
  expect(state).toHaveProperty('readOnly', true)
  expect(state).not.toHaveProperty('requireMenuRead')
})

// Report: N05-UX-RANKING,Nov5 — Main selected missing information correctly but Host erased it.
it('preserves missing-data information through the display-required Host boundary', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const result = { status: 'completed' as const, agentMode: 'active' as const, requestedTools: [], reply: { kind: 'service-information' as const, topic: 'other' as const } }
  const shown = replyFromConversation(result, { menu: createMenuReplyWindow(), context, requireMenuRead: true, failureMessage: '未展示。' })
  expect(shown.role).toBe('assistant')
  expect(shown.content).toContain('協助查菜單')
  expect(shown.content).not.toContain('理解')
  expect(shown).not.toHaveProperty('clarification')
})

// Report: attachment 6dfae2fd, 「大腸臭臭鍋一碗」 must finish as a verified menu miss.
it.each(['completed', 'incomplete'] as const)('handles a verified unmatched add without hiding a %s tool outcome', (status) => {
  const menu = createMenuReplyWindow()
  menu.record('menu_get', { items: [], matchKind: 'none', requestedQueries: ['大腸臭臭鍋'], customerMessage: '目前菜單查不到「大腸臭臭鍋」。' })
  const reply = replyFromConversation({ status, agentMode: 'active', requestedTools: ['menu_get'] }, { menu, handoff: { intent: 'ADD_ITEM', status: 'unmatched' }, sourceUtterance: '大腸臭臭鍋一碗', failureMessage: '操作失敗。' })
  expect(reply).toEqual(status === 'completed' ? { role: 'assistant', content: '目前菜單查不到「大腸臭臭鍋」。' } : { role: 'error', content: '操作失敗。' })
})

// Report: attachment 6dfae2fd; a different meal, possible alias or partial lookup cannot settle an add.
it.each([
  { query: '牛肉火鍋', matchKind: 'none', status: 'unmatched' as const },
  { query: '大腸臭臭鍋', matchKind: 'possible', status: 'unmatched' as const },
  { query: '大腸臭臭鍋', matchKind: 'none', status: 'unrepresentable' as const },
])('keeps unresolved add guards for $query / $matchKind / $status', ({ query, matchKind, status }) => {
  const menu = createMenuReplyWindow()
  menu.record('menu_get', { items: [], matchKind, requestedQueries: [query], customerMessage: '查詢結果。' })
  expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_get'] }, { menu, handoff: { intent: 'ADD_ITEM', status }, sourceUtterance: '大腸臭臭鍋一碗', failureMessage: '未加入。' })).toEqual({ role: 'error', content: '未加入。' })
})

// Report: this chat, 2026-11-06 — a normal out-of-scope answer must not become a purple technical error.
it('presents a structured scope refusal as normal assistant speech without a menu receipt', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const presented = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], reply: { kind: 'service-information', topic: 'out-of-scope' } }, { menu: createMenuReplyWindow(), requireMenuRead: true, context, failureMessage: 'Failed' })
  expect(presented).toMatchObject({ role: 'assistant', content: '我是點餐助手，可以幫您看菜單、選餐和確認訂單。您想吃什麼？' })
})

// Report: this chat,2026-11-06 — asking how many dumplings only returned availability/price.
it.each(['displayed', 'context'])('retains the portion description through the %s customer reply', async (path) => {
  const runtime = createMenuToolRuntime({ menu: [{ id: 'dumplings', name: '水餃', category: '點心', description: '每份10顆，80元，現點現煮', price: 80, imageUrl: '', recommendationTags: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const receipt = await runtime.invokeForAgent('menu_get', { query: '水餃', display: path === 'displayed' })
  const menu = createMenuReplyWindow()
  menu.record('menu_get', receipt)
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: path === 'displayed' ? ['menu_get'] : [], reply: { kind: 'menu-information', subjects: ['水餃'] } }, { menu, context, failureMessage: '無法確認。' })
  expect(reply.role).toBe('assistant')
  expect(reply.content).toContain('每份10顆')
  expect(reply.content).toContain('80元')
  expect(reply.content.match(/80元/g)).toHaveLength(1)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

// Report: this chat, 2026-11-07, session ggUmSdBBOnjiRPKu06-uR seq102–127.
it('does not replace a displayed recommendation outcome with an internal lookup after display rejection', () => {
  const menu = createMenuReplyWindow()
  const displayed = { presentation: { kind: 'recommendation', itemIds: ['fish'] }, items: [{ id: 'fish', name: '魚便當', price: 140 }], customerMessage: '含魚：推薦一項：魚便當。' }
  const internal = { dataOnly: true, items: [{ id: 'chicken', name: '雞便當', price: 135 }], customerMessage: '我找到：雞便當、排骨便當。' }
  menu.record('menu_recommend', displayed)
  let outcome = operationReplyFrom(displayed)
  menu.record('menu_get', internal)
  outcome = operationReplyFrom(internal) ?? outcome
  const reply = replyFromConversation({ status: 'incomplete', reason: 'tool-rejected', agentMode: 'active', requestedTools: ['menu_recommend', 'menu_get'] }, { menu, outcome, failureMessage: '點餐系統未接受這次操作，請確認畫面後再繼續。' })
  expect(reply.content).toContain('魚便當')
  expect(reply.content).not.toContain('雞便當')
  expect(reply.content).not.toContain('我找到')
  expect(operationReplyFrom(JSON.stringify(internal))).toBeUndefined()
})

// Report: Nov6 I_A7 utterance108: recovery clarification unexpectedly displayed the cart.
it('regression K1107-SCOPE keeps unresolved speech reply-only', () => {
  const state = conversationDecisionStateFrom({ phase: 'ordering', menuRevision: 1 }, { reason: 'UNCERTAIN_OPERATION', recovery: { status: 'completed', admission: 'service', disposition: 'clarify' } })
  expect(state?.readOnly).toBe(true)
  expect(state?.replyOnly).toBe(true)
  expect(state?.serviceReply).not.toBe(true)
  expect(state?.requireMenuRead).not.toBe(true)
})

// Report: this chat Nov7; a browsing prompt must not leave old order consent in foreground.
it('regression K1107-GUIDE marks a Menu guidance receipt as a clarification for the Host reply window', () => {
  const menu = createMenuReplyWindow()
  menu.record('menu_recommend', { queryAction: 'clarify', items: [], guidance: { reason: 'exhausted', itemIds: ['chicken'] }, customerMessage: '可以看看香烤雞腿飯，請說想看的餐點名稱。' })
  const reply = replyFromConversation({ status: 'completed', requestedTools: ['menu_recommend'], agentMode: 'active' }, { menu, failureMessage: '未完成。' })
  expect(reply.role).toBe('assistant')
  expect(reply.clarification).toBe(true)
  expect(reply.content).toContain('香烤雞腿飯')
})

// Report: this chat Nov7; an earlier fuzzy lookup cannot hide the real purchase confirmation.
it('regression K1107-FUZZY keeps the later Menu-owned confirmation in foreground', () => {
  const menu = createMenuReplyWindow()
  menu.record('menu_get', { matchKind: 'possible', items: [], guidance: { reason: 'possible', itemIds: ['pork'] }, customerMessage: '您想找的是打拋豬便當嗎？' })
  const question = { questionId: 'owned-confirmation', purpose: 'confirm-meal' as const, question: '您是要新增打拋豬便當嗎？', choices: [{ id: 'yes', description: '同意新增' }, { id: 'no', description: '拒絕新增' }], expiresAt: Date.now() + 30000 }
  menu.record('menu_confirm_item', { pendingCustomerChoice: question })
  const reply = replyFromConversation({ status: 'completed', requestedTools: ['menu_get', 'menu_confirm_item'], agentMode: 'active' }, { menu, question, failureMessage: '未完成。' })
  expect(reply.content).toBe(question.question)
  expect(reply.clarification).toBeUndefined()
})

// Report: this chat, Nov08 — read results must remain available alongside accepted order effects.
it('keeps factual lookup results and accepted effects with one owned next question', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ id: 'meal', name: '雞肉飯', category: '飯', description: '', price: 95, imageUrl: '', recommendationTags: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const menu = createMenuReplyWindow()
  menu.record('order_add_item', { customerMessage: '水餃兩份已加入。' })
  menu.record('menu_get', await runtime.invoke('menu_get', { query: '雞肉飯', display: true }))
  const question = { questionId: 'fulfillment', purpose: 'fulfillment', question: '請問要內用還是自取？', choices: [], expiresAt: Date.now() + 30000 }
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['order_add_item', 'menu_get'] }, { menu, question, failureMessage: '未完成。' })
  expect(reply.content).toContain('水餃兩份已加入')
  expect(reply.content).toContain('雞肉飯')
  expect(reply.content.match(/95元/g)).toHaveLength(1)
  expect(reply.content.match(/？/g)).toHaveLength(1)
  expect(reply.content).toContain(question.question)
})

// Report: this chat, Nov08 — recommendation guidance and a later lookup must not each ask a question.
it('keeps one display question when guidance is followed by a factual meal read', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ id: 'rice', name: '雞肉飯', category: '飯', description: '', price: 95, imageUrl: '', recommendationTags: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const window = createMenuReplyWindow()
  window.record('menu_recommend', await runtime.invokeForAgent('menu_recommend', { action: 'clarify' }))
  window.record('menu_get', await runtime.invoke('menu_get', { query: '雞肉飯', display: true }))
  expect(window.reply().match(/？/g)).toHaveLength(1)
  expect(window.reply()).toContain('95元')
})
