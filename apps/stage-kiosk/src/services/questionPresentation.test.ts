import { describe, expect, it } from 'vitest'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom } from './kiosk-fast-path'
import { createInvitationWindow, createMenuReplyWindow, operationReplyFrom, questionReceiptFrom, replyFromOperation, replyWithQuestion } from './questionPresentation'

describe('question presentation receipts', () => {
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
