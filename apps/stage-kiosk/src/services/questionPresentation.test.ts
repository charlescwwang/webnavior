import { describe, expect, it } from 'vitest'

import { menu as sampleMenu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom } from './kiosk-fast-path'
import { createInvitationWindow, createMenuReplyWindow, operationReplyFrom, questionReceiptFrom, replyFromConversation, replyFromOperation, replyFromReceipt, replyWithQuestion } from './questionPresentation'

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
  expect(state?.readOnly === true).toBe(live)
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
  it('keeps the quantity-change plus addition handoff capable of validated order edits', () => {
    const state = conversationDecisionStateFrom({ phase: 'ordering', catalogEvidence: { products: [{ label: '紅燒牛肉麵', matchedText: '牛肉麵', source: 'alias' }, { label: '水餃', matchedText: '水餃', source: 'name' }], categories: [] } }, { reason: 'UNCERTAIN_OPERATION' })
    expect(state).not.toHaveProperty('requireMenuRead')
    expect(state).not.toHaveProperty('readOnly')
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
