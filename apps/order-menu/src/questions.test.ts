import type { CheckoutSnapshot } from './domain/checkout-flow'

import { describe, expect, it, vi } from 'vitest'

import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from './domain/checkout-flow'
import { menu } from './domain/order-machine'
import { authorize, compileOperationPlan, createQuestion, deriveDecisionContext, resolveIntent } from './kiosk-intents'
import { createMenuToolRuntime } from './webmcp'

describe('action-bound customer questions', () => {
  it('revokes an operation confirmation when the assistant answers a side question', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '清空訂單' })
    const pending = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:clear-cart' }) as { pendingConfirmation: { confirmationId: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: '我是這裡的 AI 點餐助手。', interruptsQuestion: true })
    const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '好' }) as { phase: string, candidates: Array<{ id: string }> }
    expect(next.phase).not.toBe('pending_confirmation')
    expect(next.candidates.some(choice => choice.id.startsWith('intent:confirm:'))).toBe(false)
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: `intent:confirm:${pending.pendingConfirmation.confirmationId}` })).rejects.toThrow()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
  })
  it.each(['menu_get', 'menu_recommend', 'cart_get', 'menu_select_item', 'menu_open', 'dialogue'] as const)('retains an unanswered question across %s in the same order', async (action) => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onMenuRequested: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    const offered = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' }) as { pendingCustomerChoice: { questionId: string, question: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: offered.pendingCustomerChoice.question, questionId: offered.pendingCustomerChoice.questionId })
    if (action === 'dialogue')
      await runtime.invoke('kiosk_dialogue_presented', { content: '我找到其他餐點。' })
    else if (action === 'menu_select_item')
      await runtime.invoke(action, { itemId: 'chous-shrimp-roll' })
    else
      await runtime.invoke(action, action === 'menu_get' ? { query: '周氏蝦捲' } : {})
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '對' })).toMatchObject({ waitingFor: { purpose: 'checkout-entry' } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
  })

  it('retains a deferred question through an unrelated reply and only clears it on a new order', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
      const offered = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' }) as { pendingCustomerChoice: { questionId: string, question: string } }
      await runtime.invoke('kiosk_dialogue_presented', { content: offered.pendingCustomerChoice.question, questionId: offered.pendingCustomerChoice.questionId })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '先不要' })
      const deferred = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:defer-question' }) as { customerMessage: string }
      await runtime.invoke('kiosk_dialogue_presented', { content: deferred.customerMessage })
      vi.advanceTimersByTime(55_000)
      expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '對' })).toMatchObject({ waitingFor: { purpose: 'checkout-entry' } })
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ questionHistory: expect.arrayContaining([expect.objectContaining({ status: 'deferred' })]) })
      await runtime.reset()
      expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '對' })).not.toHaveProperty('waitingFor')
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ questionHistory: [] })
    }
    finally { vi.useRealTimers() }
  })

  it('retains the same unanswered need after cart edits without reviving the old execution ticket', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    const offered = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' }) as { pendingCustomerChoice: { questionId: string, question: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: offered.pendingCustomerChoice.question, questionId: offered.pendingCustomerChoice.questionId })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '對' })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:start-checkout' })).rejects.toThrow()
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '對' })).toMatchObject({ waitingFor: { purpose: 'checkout-entry' } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
  })

  it('does not extend one-use destructive confirmation authority across idle', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '清空訂單' })
      const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:clear-cart' }) as { pendingConfirmation: { confirmationId: string } }
      vi.setSystemTime(Date.now() + 55_000)
      await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: `intent:confirm:${result.pendingConfirmation.confirmationId}` })).rejects.toThrow('expired')
      expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '確認' })).not.toMatchObject({ phase: 'pending_confirmation' })
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
    }
    finally { vi.useRealTimers() }
  })
  it('runs checkout questions through membership and invoice, then selects a payment method without starting payment', async () => {
    let snapshot: CheckoutSnapshot | undefined
    let revision = 0
    let payment: 'pending' | undefined
    let methodSelections = 0
    const update = (next: CheckoutSnapshot) => {
      snapshot = next
      revision++
      return next
    }
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      checkout: {
        snapshot: () => snapshot,
        revision: () => revision,
        paymentStatus: () => payment,
        assertCanRestart: () => {},
        restart: () => {
          snapshot = undefined
          revision++
        },
        start: () => update(beginCheckout()),
        skipMembership: () => update(skipMembership(snapshot!)),
        chooseInvoice: method => update(chooseInvoiceMethod(snapshot!, method)),
        requestTaxId: () => update(requestTaxId(snapshot!)),
        setTaxId: value => update(setTaxIdDraft(snapshot!, value)),
        confirmTaxId: () => update(confirmTaxId(snapshot!)),
        selectPayment: async () => {
          methodSelections++
          revision++
          return { customerMessage: '已選擇，尚未付款。', status: 'selected' }
        },
        cancel: () => {
          snapshot = undefined
          revision++
        },
      },
    })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    let result = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    const answer = async (transcript: string, candidateId: string) => {
      const receipt = result as { pendingCustomerChoice: { question: string, questionId: string } }
      await runtime.invoke('kiosk_dialogue_presented', { content: receipt.pendingCustomerChoice.question, questionId: receipt.pendingCustomerChoice.questionId })
      await runtime.invoke('kiosk_fast_path_context', { transcript })
      result = await runtime.invoke('kiosk_fast_path_execute', { candidateId })
    }
    await answer('對', 'intent:start-checkout')
    expect(snapshot?.stage).toBe('membership')
    expect(methodSelections).toBe(0)
    await answer('略過會員', 'intent:skip-membership')
    expect(snapshot?.stage).toBe('invoice')
    expect(result).toMatchObject({ pendingCustomerChoice: { purpose: 'invoice' } })
    expect(JSON.stringify(result)).not.toContain('已掃描載具')
    await answer('略過，捐贈發票', 'intent:choose-invoice:donation')
    expect(snapshot?.stage).toBe('payment')
    expect(snapshot?.invoiceMethod).toBe('donation')
    expect(snapshot?.donationCode).toBeUndefined()
    expect(methodSelections).toBe(0)
    await answer('信用卡', 'intent:select-payment:card')
    expect(methodSelections).toBe(1)
    expect(result).toMatchObject({ payment: { method: 'card', status: 'selected' } })
    expect(result).not.toHaveProperty('pendingConfirmation')
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:select-payment:card' })).rejects.toThrow('expired')
    expect(methodSelections).toBe(1)
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'checkout_payment_select', paymentState: 'idle' })
    payment = 'pending'
    revision++
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '信用卡' })).toMatchObject({ phase: 'payment_locked', candidates: [] })
  })
  it('rejects a stale presentation receipt after touch changes the cart', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const result = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { pendingCustomerChoice: { questionId: string } }
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    expect(await runtime.invoke('kiosk_question_validate', { questionId: result.pendingCustomerChoice.questionId })).toEqual({})
    await runtime.invoke('kiosk_dialogue_presented', { content: '內用還是自取？', questionId: result.pendingCustomerChoice.questionId })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '對' })).not.toHaveProperty('waitingFor')
  })

  it('keeps a presented question across idle while rejecting its expired issued answer', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
      const result = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' }) as { pendingCustomerChoice: { questionId: string } }
      await runtime.invoke('kiosk_dialogue_presented', { content: '準備結帳？', questionId: result.pendingCustomerChoice.questionId })
      await runtime.invoke('kiosk_fast_path_context', { transcript: '不要' })
      vi.advanceTimersByTime(30_000)
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { purpose: 'checkout-entry' } })
      await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:defer-question' })).rejects.toThrow('expired')
      const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '不要' })
      expect(resumed).toMatchObject({ waitingFor: { purpose: 'checkout-entry', question: expect.stringContaining('結帳') } })
      expect(resumed).not.toMatchObject({ waitingFor: { questionId: result.pendingCustomerChoice.questionId } })
      expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:defer-question' })).toMatchObject({ customerMessage: expect.stringContaining('保留目前訂單') })
      expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '對' })).toMatchObject({ waitingFor: { purpose: 'checkout-entry' } })
    }
    finally { vi.useRealTimers() }
  })

  it('never renews an expired question that the host did not actually present', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      const result = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { pendingCustomerChoice: { questionId: string } }
      vi.setSystemTime(Date.now() + 55_000)
      expect(await runtime.invoke('kiosk_question_validate', { questionId: result.pendingCustomerChoice.questionId })).toEqual({})
      await runtime.invoke('kiosk_dialogue_presented', { content: '內用還是自取？', questionId: result.pendingCustomerChoice.questionId })
      expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '對' })).not.toHaveProperty('waitingFor')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
    }
    finally { vi.useRealTimers() }
  })

  it('lets a new meal request retain the unanswered checkout question, while a bare agreement cannot create a meal', async () => {
    const runtime = createMenuToolRuntime({ menu: [...menu, { id: 'dumplings', name: '水餃', description: '十顆一份', price: 60, imageUrl: '', category: '點心', recommendationTags: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    const result = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' }) as { pendingCustomerChoice: { questionId: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: '現在結帳嗎？', questionId: result.pendingCustomerChoice.questionId })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '再加兩份水餃' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.map(candidate => candidate.id)).toContain('intent:add-item')
    const added = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' }) as { cart: { lines: Array<{ name: string, quantity: number }> } }
    expect(added.cart.lines).toContainEqual(expect.objectContaining({ name: '水餃', quantity: 2 }))
    const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as { candidates: Array<{ id: string }> }
    expect(resumed).toMatchObject({ waitingFor: { purpose: 'checkout-entry' } })
    expect(resumed.candidates.map(candidate => candidate.id)).not.toContain('intent:add-item')
  })

  it('owns the POS question text and rejects Agent-invented wording or a different purpose', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await expect(runtime.invokeForAgent('order_ask_question', { purpose: 'payment-method', question: '信用卡嗎？' })).rejects.toThrow('not legal')
    await expect(runtime.invokeForAgent('order_ask_question', { purpose: 'fulfillment', question: '內用還是外帶？' })).rejects.toThrow('application-owned')
    const asked = await runtime.invokeForAgent('order_ask_question', { purpose: 'fulfillment' }) as { pendingCustomerChoice: { questionId: string, question: string } }
    expect(asked.pendingCustomerChoice.question).toBe('請問要內用還是自取？')
    await runtime.invoke('kiosk_dialogue_presented', { content: asked.pendingCustomerChoice.question, questionId: asked.pendingCustomerChoice.questionId })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '內用' })).toMatchObject({ waitingFor: { purpose: 'fulfillment' } })
  })

  it('uses POS capabilities for questions, candidates and execution', async () => {
    const runtime = createMenuToolRuntime({ fulfillmentModes: [{ id: 'takeout', label: '自取' }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(runtime.toolDefinitions.find(tool => tool.name === 'order_set_fulfillment')?.inputSchema).toMatchObject({ properties: { mode: { enum: ['takeout'] } } })
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { pendingCustomerChoice: { choices: unknown[] } }
    expect(added.pendingCustomerChoice.choices).toHaveLength(1)
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '內用' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.map(choice => choice.id)).not.toContain('intent:set-fulfillment:dine-in')
    await expect(runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })).rejects.toThrow('not offered')
  })
  it('carries POS labels through host state, semantic choices, questions and operation receipts', async () => {
    const fulfillmentModes = [{ id: 'dine-in' as const, label: '店內用餐' }, { id: 'takeout' as const, label: '櫃台自取' }]
    const runtime = createMenuToolRuntime({ fulfillmentModes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    expect(added).toMatchObject({ pendingCustomerChoice: { question: '請問要店內用餐還是櫃台自取？' } })
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ fulfillmentModes })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '櫃台自取' }) as { candidates: Array<{ id: string, description: string }> }
    expect(context).toMatchObject({ fulfillmentModes })
    expect(context.candidates.find(choice => choice.id === 'intent:set-fulfillment:takeout')?.description).toContain('櫃台自取')
    expect(await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })).toMatchObject({ customerMessage: '已設為櫃台自取。' })
  })
  it('binds a paraphrased checkout question by ID, and resolves agreement to entering checkout', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    const result = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' }) as { pendingCustomerChoice: { questionId: string } }
    expect(result.pendingCustomerChoice?.questionId).toEqual(expect.any(String))
    await runtime.invoke('kiosk_dialogue_presented', { content: '準備進入結帳流程了嗎？', questionId: result.pendingCustomerChoice.questionId })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as { candidates: Array<{ id: string }>, waitingFor: { purpose: string } }
    expect(context.waitingFor.purpose).toBe('checkout-entry')
    expect(context.candidates.map(candidate => candidate.id)).toContain('intent:start-checkout')
    expect(context.candidates.map(candidate => candidate.id)).not.toContain('intent:add-item')
    expect(context.candidates.map(candidate => candidate.id)).toContain('intent:defer-question')
  })

  it('never promotes arbitrary assistant prose or an unpresented offer into authorization context', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '好' })).not.toHaveProperty('waitingFor')
    await runtime.invoke('kiosk_dialogue_presented', { content: '水餃一份七十元，好嗎？' })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '好' })).not.toHaveProperty('waitingFor')
  })
})

describe('bounded question plans', () => {
  const cart = { fulfillmentMode: 'takeout' as const, lines: [{ id: 'L1', itemId: 'dumplings', name: '水餃', options: {}, quantity: 1, unitPrice: 60 }], itemCount: 1, total: 60 }
  const base = { cart, menu: [], revisions: { cart: 1, checkout: 1, selectedItem: 0 } }

  it('keeps checkout acceptance and a deferred question separate, and consumes the question authority once', () => {
    const initial = deriveDecisionContext(base)
    const waitingFor = createQuestion(initial, 'Q1', Date.now())!
    const context = deriveDecisionContext({ ...base, waitingFor, transcript: '對' })
    expect(context.candidates.map(candidate => candidate.intent)).toEqual(['SEARCH_MENU', 'RECOMMEND', 'VIEW_CART', 'CLEAR_CART', 'SET_FULFILLMENT', 'SET_FULFILLMENT', 'START_CHECKOUT', 'DEFER_QUESTION'])
    const result = resolveIntent(context.candidates.find(candidate => candidate.intent === 'START_CHECKOUT')!, context)
    expect(result).toMatchObject({ kind: 'PLAN', plan: { questionId: 'Q1', intent: 'START_CHECKOUT' } })
    if (result.kind !== 'PLAN')
      throw new Error('Expected checkout entry')
    const operation = compileOperationPlan(result.plan)
    expect(operation.toolName).toBe('checkout_start')
    expect(authorize(operation, context)).toEqual({ kind: 'EXECUTE' })
    expect(authorize(operation, { ...context, waitingFor: undefined })).toEqual({ kind: 'BLOCKED', reason: 'STALE_PLAN' })
  })

  it('payment method choice executes directly and cannot mean checkout entry', () => {
    const initial = deriveDecisionContext({ ...base, checkout: { stage: 'payment', invoiceMethod: 'donation' } })
    const waitingFor = createQuestion(initial, 'Q2', Date.now())!
    const context = deriveDecisionContext({ ...initial, waitingFor, transcript: '信用卡' })
    expect(waitingFor.purpose).toBe('payment-method')
    expect(context.candidates.map(choice => choice.intent)).not.toContain('START_CHECKOUT')
    const result = resolveIntent(context.candidates.find(choice => choice.slots?.method === 'card')!, context)
    if (result.kind !== 'PLAN')
      throw new Error('Expected payment choice')
    expect(authorize(compileOperationPlan(result.plan), context)).toEqual({ kind: 'EXECUTE' })
    const pending = deriveDecisionContext({ ...context, paymentStatus: 'pending' })
    expect(pending.candidates).toEqual([])
    expect(createQuestion(pending, 'Q3', Date.now())).toBeUndefined()
  })
})
