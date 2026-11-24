import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { menu as sampleMenu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom } from './kiosk-fast-path'
import { browserRecoveryReply, createInvitationWindow, createMenuReplyWindow, operationReplyFrom, questionReceiptFrom, replyFromConversation, replyFromOperation, replyFromReceipt, replyWithQuestion } from './questionPresentation'

it('answers from the cart recheck when a quantity change is still unsettled', () => {
  const customerMessage = '目前購物車：蝦捲 1 份。'
  const result = browserRecoveryReply({ operationAttempted: true, receipt: { source: 'browser', status: 'unknown', reason: 'cart-rechecked', customerMessage } })
  expect(result.content).toBe(customerMessage)
})

// Report: this chat Nov17 — invoice/notification errors repeatedly told the customer to open the cart.
it('preserves an actionable known rejection without appending generic cart recovery', () => {
  const result = browserRecoveryReply({ operationAttempted: false, verifiedMessage: '請先填寫通知手機。' })
  expect(result.content).toBe('請先填寫通知手機。')
})

it('asks staff to verify an uncertain submission without sending the customer back to the cart', () => {
  const result = browserRecoveryReply({ operationAttempted: true, orderUnconfirmed: true })
  expect(result.content).toContain('訂單紀錄')
  expect(result.content).not.toContain('打開購物車')
  expect(result.content).not.toContain('重新送出')
})

it('retains unknown order evidence through the Main tool loop', () => {
  const menu = createMenuReplyWindow()
  menu.record('continue_checkout', { ok: false, status: 'unknown', effect: 'unknown', source: 'browser', execution: { documentId: 'doc', operationId: 'op', durationMs: 6000, steps: [{ id: 'step', action: 'submit', label: '送出訂單', effect: 'order', state: 'unknown', startedMs: 0 }] } })
  const reply = replyFromConversation({ status: 'incomplete', reason: 'tool-rejected', agentMode: 'active', requestedTools: ['continue_checkout'] }, { menu, failureMessage: '未完成', browserRecovery: { operationAttempted: true, page: 'cart' } })
  expect(reply.content).toContain('訂單紀錄')
  expect(reply.content).not.toContain('打開購物車')
})

// Report: this chat, Nov15: 一份水餃有幾顆 was replaced by a missing-description disclaimer.
it('answers known dumpling serving facts even when the merchant description is empty', () => {
  const menu = createMenuReplyWindow()
  menu.record('get_menu_item_details', { ok: true, source: 'browser', dataOnly: true, products: [{ name: '周氏水餃(最低8顆)', description: '', price: 64 }] })
  const reply = menu.reply()
  expect(reply).toContain('8顆')
  expect(reply).toContain('64元')
  expect(reply).not.toContain('網站未提供餐點內容')
  expect(reply).not.toContain('想點哪道')
})

it('reads back the verified cart including dumplings per serving before checkout', () => {
  const menu = createMenuReplyWindow()
  menu.record('list_cart_items', { ok: true, source: 'browser', dataOnly: true, cart: { subtotal: 64, lines: [{ name: '周氏水餃(最低8顆)', quantity: 1, unitPrice: 64, options: [] }] } })
  expect(menu.reply()).toContain('每份 8 顆，1 份')
  expect(menu.reply()).toContain('64元')
})

// Report: this chat, Nov14 full Host replay; Jev abstention hid add tools from Main.
it('lets Main independently resolve a PB handoff while preserving explicit read-only restrictions', () => {
  expect(conversationDecisionStateFrom({ phase: 'ordering' }, { reason: 'UNCERTAIN_OPERATION' }, 'browser')).not.toHaveProperty('readOnly')
  expect(conversationDecisionStateFrom({ phase: 'ordering', readOnly: true }, { reason: 'UNCERTAIN_OPERATION' }, 'browser')).toHaveProperty('readOnly', true)
  expect(conversationDecisionStateFrom({ phase: 'ordering' }, { reason: 'MENU_QUERY' }, 'browser')).toHaveProperty('readOnly', true)
  expect(conversationDecisionStateFrom({ phase: 'customer_entry' }, { reason: 'UNCERTAIN_OPERATION' }, 'browser')).toHaveProperty('readOnly', true)
})

it('does not present internal browser catalog preparation as completion of an order request', () => {
  const menu = createMenuReplyWindow()
  menu.record('browser_cart_get', { ok: true, source: 'browser', dataOnly: true, customerMessage: '尚未加購的資料準備。' })
  expect(menu.hasReceipts()).toBe(false)
  const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['browser_cart_get'], answer: '已加入兩份。' }, { menu, failureMessage: '未完成。' })
  expect(result.content).not.toContain('已加入')
})

it('retains a verified lookup after a known presentation failure without claiming an unknown cart operation', () => {
  const menu = createMenuReplyWindow()
  menu.record('get_menu_item_details', { ok: true, source: 'browser', dataOnly: true, products: [{ name: 'A套餐', description: '水餃12顆 + 蛋花湯', price: 136 }] })
  menu.record('point_to_menu_items', { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '暫時無法在畫面標示餐點。' })
  const result = replyFromConversation({ status: 'incomplete', reason: 'tool-rejected', agentMode: 'active', requestedTools: ['get_menu_item_details', 'point_to_menu_items'] }, { menu, failureMessage: '我還沒確認這次操作的結果。' })
  expect(result.role).toBe('assistant')
  expect(result.content).toContain('水餃12顆 + 蛋花湯')
  expect(result.content).toContain('暫時無法在畫面標示餐點')
  expect(result.content).not.toContain('還沒確認')
  const write = replyFromConversation({ status: 'incomplete', reason: 'tool-rejected', agentMode: 'active', requestedTools: ['add_items_to_cart', 'point_to_menu_items'] }, { menu, failureMessage: '我還沒確認這次操作的結果。' })
  expect(write.content).toContain('還沒確認')
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
  expect(result.content).toContain('詢問或調整')
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

// Report: this chat, 2026-10-29; real PB reads were discarded as unverified Menu results.
it('presents both external browser read receipts without trusting generated prices', () => {
  const menu = createMenuReplyWindow()
  menu.record('browser_search', { ok: true, source: 'browser', customerMessage: '雞腿便當，單份 NT$10。' })
  menu.record('browser_search', { ok: true, source: 'browser', customerMessage: '排骨便當，單份 NT$10。' })
  const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['browser_search'], answer: '兩款都是100元。' }, { menu, failureMessage: '未完成。' })
  expect(result.content).toBe('雞腿便當，單份 NT$10。 排骨便當，單份 NT$10。')
  expect(result.role).toBe('assistant')
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
  expect(present({ kind: 'payment-methods' })).toEqual({ role: 'assistant', content: '目前支援LINE Pay、街口支付。' })
  expect(present({ kind: 'menu-information', subjects: ['湯包'] })).toEqual({ role: 'assistant', content: '目前菜單沒有標示「湯包」，請問你指的是哪一道餐點？' })
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
  expect(window.reply()).toBe('你想調整價位，還是換餐點種類？')
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

  it('does not reinterpret a phone-stage provider fallback as an admitted factual menu query', () => {
    const state = conversationDecisionStateFrom({ phase: 'customer_entry', catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }], categories: [] } }, { reason: 'PROVIDER_FAILURE' })
    expect(state).not.toHaveProperty('requireMenuRead')
  })

  // Report: this chat, 2026-10-19, visitor session hIHA3DAvjhrG8x0RjggBa.
  it('rejects invented noodles after an unmatched food refusal and retains its evidence requirement across continuations', () => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [], categories: [] }, productResolution: { status: 'none', count: 0, references: [] }, references: [{ label: '剛展示的周氏蝦捲招牌便當', refId: 'ITEM_1' }] }, {})
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
    expect(replyFromOperation('已加入牛肉麵。', current.reply(), undefined)).toBe('目前沒有可驗證的餐點查詢結果，請告訴我想找的餐點或條件。')
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
    expect(window.reply()).toBe('我找到：牛肉麵。 我找到：水餃。 單份基本售價：牛肉麵 NT$150、水餃 NT$80。')
    expect(replyFromOperation('沒有經過查詢的推薦。', createMenuReplyWindow().reply(), undefined)).toBe('目前沒有可驗證的餐點查詢結果，請告訴我想找的餐點或條件。')
  })
  it('keeps a cart-only summary grounded without requiring a new menu query', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 2 })
    const window = createMenuReplyWindow()
    window.record('cart_get', await runtime.invokeForAgent('cart_get', { display: false }))
    expect(window.reply()).toBe('目前訂單：周氏蝦捲 2 份。合計 NT$150。')
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
    expect(answer).toBe('已將周氏蝦捲加入購物車，共 1 份。 請問要櫃台自取？')
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
  expect(reply.content).toContain('剛才沒有理解清楚')
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

// Report: live PB flow comparison in this chat, Nov11; Host confirmation uses
// the same verified-effect/refusal receipts as native cart tools.
it('keeps the Host confirmed-add outcome under the same cart receipt policy', () => {
  const replies = createMenuReplyWindow()
  replies.record('browser_confirm_add', { source: 'browser', ok: true, status: 'verified', effectMessage: '已加入便當一份。', customerMessage: '已加入便當一份，小計130元。' })
  expect(replies.browserOutcome()).toBe('已加入便當一份，小計130元。')
  replies.record('browser_confirm_add', { source: 'browser', ok: false, status: 'rejected', customerMessage: '購物車已變更，尚未再次加入。' })
  expect(replies.browserOutcome()).toBe('已加入便當一份。 購物車已變更，尚未再次加入。')
})

// Report: this chat, 2026-10-29; a repeated stale write hid the preceding successful quantity change.
it('preserves verified PB effects when a later write is rejected without presenting an old cart as current', () => {
  const replies = createMenuReplyWindow()
  replies.record('browser_cart_quantity', { source: 'browser', ok: true, status: 'verified', effectMessage: '已將每日新品改為兩份。', customerMessage: '已改兩份。目前購物車小計50元。' })
  expect(replies.browserOutcome()).toBe('已改兩份。目前購物車小計50元。')
  replies.record('browser_cart_add', { source: 'browser', ok: false, status: 'rejected', customerMessage: '後一項價格已變更，未加入。' })
  expect(replies.browserOutcome()).toBe('已將每日新品改為兩份。 後一項價格已變更，未加入。')
  expect(replies.browserOutcome()).not.toContain('小計50元')
})

// Report: output/playwright/pb-electron/restored-S06-current-sequence.json.
it('presents preservation as a fresh cart readback without claiming a write', () => {
  const replies = createMenuReplyWindow()
  replies.record('browser_cart_remove', { source: 'browser', ok: true, status: 'preserved', effect: 'none', customerMessage: '餐點維持不變。目前購物車：雞腿便當2份，小計20元。' })
  expect(replies.browserOutcome()).toBe('餐點維持不變。目前購物車：雞腿便當2份，小計20元。')
})

// Report: this chat, 2026-10-31; configured rice inquiry was narrated with only the meal base quote.
it('retains a verified configured-price receipt as menu evidence without inventing a cart change', () => {
  const menu = createMenuReplyWindow()
  const message = '雞腿便當（白飯 每份 1 個），單份 15 元，2 份合計 30 元。本次僅查價，尚未加入購物車。'
  menu.record('browser_quote_selection', { ok: true, source: 'browser', effect: 'none', unitPrice: 15, total: 30, customerMessage: message })
  expect(menu.hasReceipts()).toBe(true)
  expect(menu.reply()).toBe(message)
  expect(menu.browserOutcome()).toBeUndefined()
})

it('offers one verified next step without stacking a second question or implying order submission', () => {
  const receipt = { ok: true, source: 'browser', status: 'verified', customerMessage: '已加入雞腿飯兩份。', nextActions: ['view-cart', 'choose-item'] }
  // A final presenter binds the checkout question after verifying the current
  // cart. Formatting an intermediate tool receipt must not ask it early.
  expect(operationReplyFrom(receipt)).toBe('已加入雞腿飯兩份。')
  expect(operationReplyFrom({ ...receipt, customerMessage: '已加入雞腿飯。還要什麼？' })).toBe('已加入雞腿飯。還要什麼？')
  expect(operationReplyFrom({ ...receipt, customerMessage: '請問要幾份？', pendingCustomerChoice: { question: '請問要幾份？' } })).toBe('請問要幾份？')
})

it('answers a public detail read using website prices and drops preparation text once an actual presentation follows', () => {
  const menu = createMenuReplyWindow()
  menu.record('get_menu_item_details', { ok: true, source: 'browser', dataOnly: true, products: [{ name: '雞腿飯', configurations: [{ name: '大份', unitPrice: 130 }, { name: '小份', unitPrice: 100 }] }] })
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['get_menu_item_details'], answer: '雞腿飯只要1元，已加入。' }, { menu, failureMessage: '未完成' })
  expect(reply.role).toBe('assistant')
  expect(reply.content).toContain('大份130元、小份100元')
  expect(reply.content).not.toContain('只要1元')
  expect(reply.content).not.toContain('已加入')
  menu.record('point_to_menu_items', { ok: true, source: 'browser', customerMessage: '這是雞腿飯。' })
  expect(menu.reply()).toBe('這是雞腿飯。')
})
it('reads a cart total directly from the website without recalculating it or claiming an opened window', () => {
  const menu = createMenuReplyWindow()
  menu.record('list_cart_items', { ok: true, source: 'browser', dataOnly: true, cart: { lines: [{ name: '雞腿飯', quantity: 2 }], subtotal: 199 } })
  expect(menu.reply()).toContain('網站小計199元')
  expect(menu.reply()).not.toContain('已打開')
})

it('speaks the website option description instead of the private cart configuration fingerprint', () => {
  const menu = createMenuReplyWindow()
  menu.record('list_cart_items', { ok: true, source: 'browser', dataOnly: true, cart: { lines: [{ name: '雞腿飯', quantity: 1, configuration: '{"private-option-id":123}', description: '加蛋 ×1' }], subtotal: 120 } })
  expect(menu.reply()).toContain('加蛋 ×1')
  expect(menu.reply()).not.toContain('private-option-id')
})

// Report: this chat, Nov14; local session CX4pdljsMeNnROLq_EyRU, entries90–106 (no public URL).
it('answers the opened A套餐 from its current website detail receipt instead of the no-evidence fallback', () => {
  const menu = createMenuReplyWindow()
  menu.record('open_menu_item_details', { ok: true, source: 'browser', products: [{ name: '炸雞腿便當', price: 130, details: '無關餐點' }, { name: 'A套餐', price: 136, details: 'A套餐水餃12顆 + 蛋花湯$136' }], productDialog: [{ name: 'A套餐' }] })
  expect(menu.hasReceipts()).toBe(true)
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['open_menu_item_details'], answer: 'A套餐含龍蝦，1元。' }, { menu, requireMenuRead: true, failureMessage: '查詢未完成。' })
  expect(reply.role).toBe('assistant')
  expect(reply.content).toContain('水餃12顆 + 蛋花湯')
  expect(reply.content).toContain('136')
  expect(reply.content).not.toContain('炸雞腿')
  expect(reply.content).not.toContain('龍蝦')
  expect(reply.content).not.toContain('目前沒有可驗證')
})

it('retains website contents in an explicit detail lookup rather than answering only the price', () => {
  const menu = createMenuReplyWindow()
  menu.record('get_menu_item_details', { ok: true, source: 'browser', dataOnly: true, products: [{ name: 'B套餐', price: 150, details: '水餃10顆 + 牛肉湯' }] })
  expect(menu.reply()).toContain('水餃10顆 + 牛肉湯')
  expect(menu.reply()).toContain('150元')
})

it.each([
  { ok: false, source: 'browser', products: [{ name: 'A套餐', details: '水餃12顆 + 蛋花湯', price: 136 }], productDialog: [{ name: 'A套餐' }] },
  { ok: true, source: 'browser', products: [{ name: 'A套餐', details: '水餃12顆 + 蛋花湯', price: 136 }], productDialog: [] },
  { ok: true, source: 'browser', products: [{ name: 'B套餐', details: '其他套餐', price: 150 }], productDialog: [{ name: 'A套餐' }] },
])('does not use unrelated or unsuccessful dialog data as evidence: %j', (receipt) => {
  const menu = createMenuReplyWindow()
  menu.record('open_menu_item_details', receipt)
  expect(menu.hasReceipts()).toBe(false)
})

// Report: this chat; a real pending question is a valid pause, not an execution failure.
it.each(['ADD_ITEM', 'REMOVE_ITEM', 'SET_QUANTITY'].flatMap(intent => ['completed', 'incomplete'].map(status => ({ intent, status: status as 'completed' | 'incomplete' }))))('presents the current Host question without an internal limit error ($intent, $status)', ({ intent, status }) => {
  const question = { questionId: 'live-question', purpose: intent === 'REMOVE_ITEM' ? 'browser-service-question' : 'browser-order-quantity', question: intent === 'REMOVE_ITEM' ? '購物車裡哪一道餐點要刪除？' : '請問炸排骨便當要幾份？', expiresAt: Date.now() + 30000, choices: [{ id: 'cancel', description: '取消選餐' }] }
  const result = replyFromConversation({ status, reason: status === 'incomplete' ? 'tool-limit' : undefined, agentMode: 'active', requestedTools: ['ask_customer_question'] }, { menu: createMenuReplyWindow(), question, handoff: { intent }, failureMessage: '內部執行上限。' })
  expect(result).toEqual({ role: 'assistant', content: question.question })
})

// Report: this chat; customer recovery must preserve facts without showing internal errors.
it.each(['tool-limit', 'duplicate-tool-call', 'tool-rejected', 'provider-error'] as const)('offers browser ordering recovery after %s instead of a purple error', (reason) => {
  const result = replyFromConversation({ status: 'incomplete', reason, agentMode: 'active', requestedTools: ['get_menu_item_details'], answer: '已加入三份，總共999元。' }, { menu: createMenuReplyWindow(), failureMessage: '內部執行上限與工具錯誤', browserRecovery: { operationAttempted: false, page: 'menu' } })
  expect(result.role).toBe('assistant')
  expect(result.content).toContain('請再告訴我')
  expect(result.content).not.toContain('畫面選餐')
  expect(result.content).not.toContain('內部執行上限')
  expect(result.content).not.toContain('已加入')
  expect(result.content).not.toContain('999')
})

it('requires cart review after an attempted browser effect without claiming success or inviting replay', () => {
  const result = replyFromConversation({ status: 'incomplete', reason: 'tool-limit', agentMode: 'active', requestedTools: ['add_items_to_cart'] }, { menu: createMenuReplyWindow(), handoff: { intent: 'ADD_ITEM' }, failureMessage: '內部上限', browserRecovery: { operationAttempted: true, page: 'menu' } })
  expect(result.role).toBe('assistant')
  expect(result.content).toContain('核對')
  expect(result.content).toContain('避免重複操作')
  expect(result.content).not.toContain('已加入')
  expect(result.content).not.toContain('重新點一次')
})

// Report: this chat, 2026-11-15; an unbound spoken question left checkout as the next answer's authority.
it('does not invent an unanswered product question from a presentation next-action hint', () => {
  const receipt = { ok: true, source: 'browser', customerMessage: '目前查到：炸排骨便當，單份 130 元。', nextActions: ['choose-item'] }
  expect(operationReplyFrom(receipt)).toBe(receipt.customerMessage)
  expect(questionReceiptFrom(receipt)).toBeUndefined()
})

// Report: this chat, 2026-11-17 — a final policy/navigation receipt erased both search results.
it.each(['已清除搜尋，回到完整菜單。', '機臺不能自行創造餐點。'])('retains all named search facts before the final guidance: %s', (outcome) => {
  const menu = createMenuReplyWindow()
  for (const query of ['章魚燒', '貢丸湯'])
    menu.record('search_menu_items', { ok: true, source: 'browser', status: 'not-found', effect: 'none', search: query, products: [], customerMessage: `目前搜尋沒有找到「${query}」。` })
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['search_menu_items', 'search_menu_items', 'reply_to_customer'] }, { menu, outcome, failureMessage: '未完成。' })
  expect(reply.content).toContain('章魚燒')
  expect(reply.content).toContain('貢丸湯')
  expect(reply.content).toContain(outcome)
})

it('does not repeat the last found dish when preserving an earlier missing search', () => {
  const menu = createMenuReplyWindow()
  menu.record('search_menu_items', { ok: true, source: 'browser', status: 'not-found', effect: 'none', customerMessage: '目前搜尋沒有找到「棺材板」。' })
  const outcome = '目前查到：魚丸湯，單份 50 元。'
  menu.record('search_menu_items', { ok: true, source: 'browser', customerMessage: outcome })
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['search_menu_items', 'search_menu_items'] }, { menu, outcome, failureMessage: '未完成。' })
  expect(reply.content).toContain('棺材板')
  expect(reply.content.split('魚丸湯')).toHaveLength(2)
})

// Report: this chat, Nov17 cases 4/5 — attempted execution is not proof of a write or unknown effect.
it('keeps a verified no-effect rejection at the current form step', () => {
  const menu = createMenuReplyWindow()
  menu.record('browser_question_answer', { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '請先修正捐贈碼格式。' })
  const reply = replyFromConversation({ status: 'incomplete', reason: 'tool-rejected', agentMode: 'active', requestedTools: ['browser_question_answer'] }, { menu, failureMessage: '操作未完成', browserRecovery: { operationAttempted: true, page: 'cart' } })
  expect(reply.content).toBe('請先修正捐贈碼格式。')
  expect(reply.content).not.toContain('打開購物車')
})

// Report: this chat, Nov17 case 5 — a later missing receipt cannot inherit an earlier no-effect rejection.
it('does not erase an unsettled operation with an earlier known no-effect receipt', () => {
  const menu = createMenuReplyWindow()
  menu.beginOperation('add_items_to_cart')
  menu.record('add_items_to_cart', { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '份數不合法。' })
  expect(menu.effectState()).toBe('none')
  menu.beginOperation('add_items_to_cart')
  expect(menu.effectState()).toBe('unknown')
  menu.record('add_items_to_cart', { ok: true, source: 'browser', status: 'verified', effect: 'applied', effectMessage: '已加入一份雞腿飯。', customerMessage: '已加入一份雞腿飯。' })
  expect(menu.effectState()).toBe('applied')
  menu.beginOperation('add_items_to_cart')
  menu.record('add_items_to_cart', { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '第二道未加入。' })
  const reply = replyFromConversation({ status: 'incomplete', reason: 'tool-rejected', agentMode: 'active', requestedTools: ['add_items_to_cart'] }, { menu, failureMessage: '失敗', browserRecovery: { operationAttempted: true, page: 'cart' } })
  expect(reply.content).toContain('已加入一份雞腿飯')
  expect(reply.content).toContain('第二道未加入')
  expect(reply.content).not.toContain('打開購物車')
})

it('keeps an unsettled final submission on order verification instead of cart recovery', () => {
  const menu = createMenuReplyWindow()
  menu.beginOperation('browser_question_answer', { maySubmit: true })
  const reply = replyFromConversation({ status: 'incomplete', reason: 'provider-error', agentMode: 'active', requestedTools: ['browser_question_answer'] }, { menu, failureMessage: '失敗', browserRecovery: { operationAttempted: true, page: 'cart' } })
  expect(reply.content).toContain('訂單紀錄')
  expect(reply.content).not.toContain('打開購物車')
})

// Report: this chat, Nov19 — asking for fish after millet porridge appended an old porridge miss.
it('does not attach an unrelated missing search to the current fish lookup', () => {
  const menu = createMenuReplyWindow({ sourceUtterance: '那有什麼魚類' })
  menu.record('search_menu_items', { ok: true, source: 'browser', search: '魚', products: [{ name: '魚丸湯', price: 50 }], customerMessage: '目前查到：魚丸湯，單份 50 元。' })
  menu.record('search_menu_items', { ok: true, source: 'browser', status: 'not-found', search: '粥', products: [], customerMessage: '目前搜尋沒有找到「粥」。' })
  const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['search_menu_items', 'search_menu_items'] }, { menu, outcome: '目前搜尋沒有找到「粥」。', failureMessage: '未完成。' })
  expect(reply.content).toContain('魚丸湯')
  expect(reply.content).not.toContain('粥')
})

it('keeps a missing dish that the current customer actually asked alongside a found dish', () => {
  const menu = createMenuReplyWindow({ sourceUtterance: '有魚丸湯和小米粥嗎' })
  menu.record('search_menu_items', { ok: true, source: 'browser', search: '魚', customerMessage: '目前查到：魚丸湯，單份 50 元。' })
  menu.record('search_menu_items', { ok: true, source: 'browser', status: 'not-found', search: '小米粥', customerMessage: '目前搜尋沒有找到「小米粥」。' })
  expect(menu.reply()).toContain('魚丸湯')
  expect(menu.reply()).toContain('小米粥')
})

// Report: this chat, Nov19 — soup lookup rejection was replaced with order-edit recovery.
it('preserves an actionable menu query rejection instead of asking which order to change', () => {
  const menu = createMenuReplyWindow({ sourceUtterance: '那有什麼湯？' })
  menu.record('list_menu_items', { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '這次湯品查詢還沒完成，請再告訴我想找的種類。' })
  const result = replyFromConversation({ status: 'incomplete', reason: 'tool-rejected', requestedTools: ['list_menu_items'], agentMode: 'active' }, { menu, failureMessage: '失敗', browserRecovery: { operationAttempted: false, page: 'menu' } })
  expect(result.content).toBe('這次湯品查詢還沒完成，請再告訴我想找的種類。')
  expect(result.content).not.toContain('送出訂單')
  expect(result.content).not.toContain('調整哪一項')
})

// Report: this chat, Nov19 — releasing a question needs a visible receipt, not a generic recovery prompt.
it.each(['QUESTION_RETRY_LIMIT', 'CHECKOUT_RECOVERY'])('shows the Host %s message even when Main had chosen a question tool', (code) => {
  const menu = createMenuReplyWindow()
  menu.record('ask_customer_question', { ok: true, source: 'browser', status: 'clarification', effect: 'none', code, customerMessage: '這題暫時無法接續，我先停止追問。' })
  expect(replyFromConversation({ status: 'completed', requestedTools: ['ask_customer_question'], agentMode: 'active' }, { menu, failureMessage: '失敗' }).content).toBe('這題暫時無法接續，我先停止追問。')
})

// Report: this chat, Nov19 — a failed targeted display must not narrate ten unrelated catalog candidates.
it('keeps a rejected targeted display concise and does not repeat its error or the earlier catalog', () => {
  const menu = createMenuReplyWindow({ sourceUtterance: '那我要炸的' })
  menu.record('list_menu_items', { ok: true, source: 'browser', dataOnly: true, products: Array.from({ length: 13 }, (_, index) => ({ name: `不相關餐點${index}`, price: 100 })) })
  menu.record('point_to_menu_items', { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '這次餐點介紹尚未完成，正在重新確認。' })
  const reply = replyFromConversation({ status: 'incomplete', reason: 'tool-rejected', requestedTools: ['list_menu_items', 'point_to_menu_items'], agentMode: 'active' }, { menu, failureMessage: '失敗', browserRecovery: { operationAttempted: false, page: 'menu' } })
  expect(reply.content).not.toContain('不相關')
  expect(reply.content).toBe('這次餐點介紹尚未完成，正在重新確認。')
})

// Report: this chat, Nov23 — a dispatched order was incorrectly presented as an unsettled cart operation.
it('keeps the native order outcome message instead of generic cart recovery', () => {
  const message = '訂單結果仍在確認，請先查看目前畫面，避免重複送出。'
  const result = browserRecoveryReply({ operationAttempted: true, receipt: { schemaVersion: 1, ok: true, source: 'browser', code: 'order-submission-result', dispatch: 'dispatched', status: 'unknown', effect: 'unknown', consistency: 'unavailable', reason: 'invalid-result-format', customerMessage: message } })
  expect(result.content).toBe(message)
  expect(result.content).not.toContain('購物車')
})

// Report: this chat, 2026-11-23. Same-page merchant refusal is a final
// no-effect reply even when the final confirmation button was dispatched.
it.each(['dispatched', 'not-dispatched'])('reports the PB closed-store refusal (%s) without order recovery', (dispatch) => {
  const menu = createMenuReplyWindow()
  const message = '目前非營業時間，暫時無法點餐。'
  menu.beginOperation('browser_cart_get', { maySubmit: true })
  menu.record('browser_cart_get', {
    schemaVersion: 1,
    ok: true,
    source: 'browser',
    code: 'order-submission-result',
    dispatch,
    status: 'rejected',
    effect: 'none',
    consistency: 'unavailable',
    reason: 'store-closed',
    customerMessage: message,
  })
  expect(menu.orderUnconfirmed()).toBe(false)
  expect(menu.effectState()).toBe('none')
  expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['browser_cart_get'] }, {
    menu,
    failureMessage: '未完成',
    browserRecovery: { operationAttempted: true, page: 'cart' },
  })).toMatchObject({ role: 'assistant', content: message })
})
