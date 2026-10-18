import { describe, expect, it } from 'vitest'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom } from './kiosk-fast-path'
import { createCustomerEntryReminder, createInvitationWindow, createMenuReplyWindow, operationReplyFrom, questionReceiptFrom, replyFromConversation, replyFromOperation, replyWithQuestion } from './questionPresentation'

describe('optional phone reminder after a verified menu reply', () => {
  const hint = '手機可以選填；要開始點餐，請填寫手機或按略過。'

  it('appends once per customer while keeping menu queries and the phone choice available', async () => {
    let ready = false
    const runtime = createMenuToolRuntime({ orderingReady: () => ready, onCustomerEntrySkipped: () => ready = true, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const reminder = createCustomerEntryReminder()
    const menu = createMenuReplyWindow()
    menu.record('menu_get', await runtime.invokeForAgent('menu_get', { display: true }))
    const state = conversationDecisionStateFrom(await runtime.invoke('kiosk_interaction_state'))
    expect(reminder.append(menu.reply(), state?.phase, hint)).toBe(`${menu.reply()} ${hint}`)
    expect(reminder.append('水餃目前可以點。', state?.phase, hint)).toBe('水餃目前可以點。')
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'customer_entry' })
    await runtime.invokeManual('customer_skip_phone', { confirmedByUser: true })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    reminder.reset()
    expect(reminder.append('推薦三樣餐點。', state?.phase, hint)).toBe(`推薦三樣餐點。 ${hint}`)
  })

  it('uses the current phase when the customer skipped during a menu query', async () => {
    let ready = false
    const runtime = createMenuToolRuntime({ orderingReady: () => ready, onCustomerEntrySkipped: () => ready = true, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const reminder = createCustomerEntryReminder()
    await runtime.invokeForAgent('menu_get', { query: '水餃' })
    await runtime.invokeManual('customer_skip_phone', { confirmedByUser: true })
    const state = conversationDecisionStateFrom(await runtime.invoke('kiosk_interaction_state'))
    expect(reminder.append('水餃目前可以點。', state?.phase, hint)).toBe('水餃目前可以點。')
    expect(reminder.append('查詢結果。', undefined, hint)).toBe('查詢結果。')
    expect(reminder.append('', 'customer_entry', hint)).toBe('')
    expect(reminder.append('推薦三樣餐點。', 'customer_entry', hint)).toBe(`推薦三樣餐點。 ${hint}`)
  })
})

describe('question presentation receipts', () => {
  it('presents a verified factual price lookup at phone entry even when the Agent uses recommendation read tools', () => {
    const menu = createMenuReplyWindow()
    menu.record('menu_recommend', { items: [{ id: 'bento', name: '炸排骨便當', price: 130 }], customerMessage: '推薦一項：炸排骨便當。' })
    const customerEntry = { phase: 'customer_entry', prompt: '請先填寫手機或選擇略過。' }
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_recommend', 'menu_show_recommendations'] }, { menu, requireMenuRead: true, failureMessage: '失敗。', customerEntry })).toEqual({ role: 'assistant', content: '推薦一項：炸排骨便當。' })
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
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '請提供牛肉麵名稱，例如紅燒或清燉牛肉麵。' }, { menu: createMenuReplyWindow(), requireMenuRead: state?.requireMenuRead, failureMessage: '查詢未完成。' })).toEqual({ role: 'error', content: '查詢未完成。' })
  })

  it('does not reinterpret a phone-stage provider fallback as an admitted factual menu query', () => {
    const state = conversationDecisionStateFrom({ phase: 'customer_entry', catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }], categories: [] } }, { reason: 'PROVIDER_FAILURE' })
    expect(state).not.toHaveProperty('requireMenuRead')
  })

  it('keeps identity dialogue natural when only old cart references remain', () => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [], categories: [] }, references: [{ label: '購物車水餃', refId: 'CART_LINE_1' }], interactionState: { matchingCartLines: 0, lastAddedItemName: '水餃', screen: 'menu' } }, { reason: 'NEW_REQUEST' })
    expect(state).not.toHaveProperty('requireMenuRead')
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '我是點餐助手。' }, { menu: createMenuReplyWindow(), requireMenuRead: state?.requireMenuRead, failureMessage: '查詢未完成。' })).toEqual({ role: 'assistant', content: '我是點餐助手。' })
  })

  it('does not publish a no-tool fabricated recommendation for a turn requiring menu evidence', () => {
    const menu = createMenuReplyWindow()
    const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '推薦3 項：香菜肉絲乾麵、韭菜盒、甜不辣。' }, { menu, requireMenuRead: true, failureMessage: '查詢失敗。' })
    expect(result).toEqual({ role: 'error', content: '查詢失敗。' })
    expect(result.content).not.toContain('韭菜盒')
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
    const result = await runtime.invokeForAgent('menu_get', { dietary: 'vegetarian' })
    const window = createMenuReplyWindow()
    window.record('menu_get', result)
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
    expect(replyFromOperation('沒有經過查詢的推薦。', createMenuReplyWindow().reply(), undefined)).toBe('目前沒有可驗證的餐點查詢結果，請告訴我想找的餐點或條件，或使用畫面選餐。')
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
