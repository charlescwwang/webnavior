import type { OrderingContext } from '@proj-airi/stage-shared/kiosk-service-mode'

import type { CartSnapshot } from './domain/order-machine'

import { describe, expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

function tableRuntime(status: 'accepted' | 'rejected' | 'uncertain' = 'accepted') {
  let context: OrderingContext = { id: 'round-1', serviceMode: 'table-service', table: { id: 'a03', label: 'a03' }, directSubmissionSupported: true }
  const submit = vi.fn(async (cart: CartSnapshot) => ({ id: 'order-table-1', serviceMode: 'table-service' as const, table: context.table!, cart, receipt: { environment: 'test' as const, status, retryable: false, customerMessage: status === 'accepted' ? '本桌訂單已送出。' : '送單未完成。' } }))
  const completed = vi.fn()
  const runtime = createMenuToolRuntime({ menu: [{ id: 'dumplings', name: '水餃', category: '點心', description: '每份10顆', price: 80, imageUrl: '', optionGroups: [], recommendationTags: [] }], serviceContext: () => context, gateway: { submit }, orderingReady: () => false, onSessionReset: () => {
    context = { ...context, id: 'round-2', serviceMode: 'kiosk', table: undefined }
  }, onOrderConfirmed: completed, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  return { runtime, submit, completed }
}

async function reviewAndSubmit(runtime: ReturnType<typeof createMenuToolRuntime>) {
  const review = await runtime.invoke('checkout_start', { confirmedByUser: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_dialogue_presented', { content: review.pendingCustomerChoice.question, questionId: review.pendingCustomerChoice.questionId })
  return await runtime.invoke('checkout_start', { confirmedByUser: true })
}

describe('shared Menu service modes', () => {
  it('resets only its owning merchant through a host-only tool and preserves a refused round', async () => {
    const first = tableRuntime()
    const second = tableRuntime()
    await first.runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    await second.runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 2 })
    await expect(second.runtime.invokeForAgent('kiosk_ordering_reset')).rejects.toThrow('unavailable to the Agent')
    expect(await second.runtime.invoke('kiosk_ordering_reset')).toHaveProperty('cart.itemCount', 0)
    expect(await first.runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 1)

    const reset = vi.fn().mockRejectedValueOnce(new Error('round unresolved')).mockResolvedValue(undefined)
    const refused = createMenuToolRuntime({ menu: [{ id: 'dumplings', name: '水餃', category: '點心', description: '', price: 80, imageUrl: '', optionGroups: [], recommendationTags: [] }], onSessionReset: reset, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await refused.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    await expect(refused.invoke('kiosk_ordering_reset')).rejects.toThrow('round unresolved')
    expect(await refused.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 1)
    expect(await refused.invoke('kiosk_ordering_reset')).toHaveProperty('cart.itemCount', 0)
  })

  // Report: this chat Nov8 — a new checkout request must not leave the old clear-cart question executable.
  it('replaces clear-cart consent with a reviewed table-order question without submitting', async () => {
    const { runtime, submit } = tableRuntime()
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '清空購物車' })
    const clear = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:clear-cart' }) as { pendingCustomerChoice: { questionId: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: '清空嗎？', questionId: clear.pendingCustomerChoice.questionId })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'review', transcript: '幫我結帳', expectedMenuRevision: 0, readOnly: true, constraints: {} })
    const review = await runtime.invokeForAgent('cart_get', { display: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
    expect(review.pendingCustomerChoice.question).toContain('確認這份訂單並送出嗎')
    expect(review.pendingCustomerChoice.questionId).not.toBe(clear.pendingCustomerChoice.questionId)
    expect(submit).not.toHaveBeenCalled()
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 1)
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'review' })
    await runtime.invoke('kiosk_dialogue_presented', { content: review.pendingCustomerChoice.question, questionId: review.pendingCustomerChoice.questionId })
    const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as { candidates: { id: string }[] }
    expect(next.candidates.some(c => c.id === 'intent:start-checkout')).toBe(true)
    expect(next.candidates.some(c => c.id.includes(clear.pendingCustomerChoice.questionId))).toBe(false)
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:start-checkout' })
    expect(submit).toHaveBeenCalledOnce()
  })

  // Report: this chat, Nov08 — a table-bound assistant cannot offer a takeaway switch.
  it.each(['table-service', 'kiosk'] as const)('rejects unavailable fulfillment before creating a draft-navigation question: %s', async (serviceMode) => {
    const context: OrderingContext = { id: 'mode-check', serviceMode, ...(serviceMode === 'table-service' ? { table: { id: 'a03', label: 'A03' } } : {}), directSubmissionSupported: true }
    let visibleItemId: string | undefined
    const runtime = createMenuToolRuntime({ menu: [{ id: 'dumplings', name: '水餃', category: '點心', description: '每份10顆', price: 80, imageUrl: '', optionGroups: [], recommendationTags: [] }], serviceContext: () => context, fulfillmentModes: [{ id: 'takeout', label: '外帶' }], visibleItemId: () => visibleItemId, onAction: () => {}, onMenuSelection: (id) => {
      visibleItemId = id
    }, onCartChange: () => {} })
    await runtime.invoke('menu_select_item', { itemId: 'dumplings' })
    const before = await runtime.invoke('cart_get', { display: false })
    await expect(runtime.invoke('order_set_fulfillment', { mode: serviceMode === 'table-service' ? 'takeout' : 'dine-in' })).rejects.toThrow(/not offered|unavailable for table service/)
    expect(visibleItemId).toBe('dumplings')
    expect(await runtime.invoke('cart_get', { display: false })).toEqual(before)
    const state = await runtime.invoke('kiosk_interaction_state') as { waitingFor?: { purpose: string } }
    expect(state.waitingFor?.purpose).not.toBe('draft-navigation')
    if (serviceMode === 'table-service') {
      const decision = await runtime.invoke('kiosk_fast_path_context', { transcript: '改成外帶' }) as { candidates: Array<{ id: string }> }
      expect(decision.candidates.some(candidate => candidate.id.startsWith('intent:set-fulfillment:'))).toBe(false)
      expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ serviceMode: 'table-service', serviceTable: { id: 'a03', label: 'A03' }, fulfillmentModes: [{ id: 'dine-in', label: '隨桌供餐' }] })
    }
  })

  it('retains cart tools, removes payment/fulfillment choices and submits only after explicit consent', async () => {
    const { runtime, submit, completed } = tableRuntime()
    expect(runtime.toolDefinitions.some(tool => tool.name === 'order_add_item')).toBe(true)
    expect(runtime.toolDefinitions.some(tool => tool.name === 'checkout_select_payment')).toBe(false)
    expect(runtime.toolDefinitions.some(tool => tool.name === 'order_set_fulfillment')).toBe(false)
    const menu = await runtime.invoke('menu_get') as { items: Array<{ id: string }> }
    await runtime.invoke('order_add_item', { itemId: menu.items[0]!.id, quantity: 1 })
    await expect(runtime.invoke('checkout_start')).rejects.toThrow('confirmedByUser')
    expect(submit).not.toHaveBeenCalled()
    await reviewAndSubmit(runtime)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('paymentId')
    expect(completed).toHaveBeenCalledOnce()
  })
  it('applies a mode change on an explicit fresh round and restores Kiosk tools', async () => {
    const { runtime } = tableRuntime()
    await runtime.reset()
    expect(runtime.toolDefinitions.some(tool => tool.name === 'checkout_select_payment')).toBe(true)
    expect(runtime.toolDefinitions.some(tool => tool.name === 'order_set_fulfillment')).toBe(true)
  })
})

// Report: this chat,2026-11-06; session TcKmszTQ38qIqaNJ0eGc9 sequences281–289.
it('finishes an accepted table order without offering another checkout question or submission', async () => {
  const { runtime, submit } = tableRuntime()
  const menu = await runtime.invoke('menu_get') as { items: Array<{ id: string }> }
  await runtime.invoke('order_add_item', { itemId: menu.items[0]!.id, quantity: 1 })
  const submitted = await reviewAndSubmit(runtime)
  expect(submitted).toMatchObject({ customerMessage: '本桌訂單已送出。' })
  expect(submitted).not.toHaveProperty('pendingCustomerChoice')
  const state = await runtime.invoke('kiosk_fast_path_context', { transcript: '送出' }) as { phase: string, waitingFor?: unknown, candidates: Array<{ intent: string }> }
  expect(state.phase).toBe('checkout_complete')
  expect(state.waitingFor).toBeUndefined()
  expect(state.candidates.some(candidate => candidate.intent === 'START_CHECKOUT')).toBe(false)
  await expect(runtime.invoke('order_ask_question', { purpose: 'checkout-entry' })).rejects.toThrow('not legal')
  const interaction = await runtime.invoke('kiosk_interaction_state')
  expect(interaction).toMatchObject({ phase: 'checkout_complete' })

  expect(submit).toHaveBeenCalledTimes(1)
})

it('starts a fresh phase only after explicitly resetting the accepted round', async () => {
  const { runtime } = tableRuntime()
  const menu = await runtime.invoke('menu_get') as { items: Array<{ id: string }> }
  await runtime.invoke('order_add_item', { itemId: menu.items[0]!.id, quantity: 1 })
  await reviewAndSubmit(runtime)
  expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'checkout_complete' })
  await runtime.reset()
  expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'customer_entry' })
})

it.each(['rejected', 'uncertain'] as const)('does not report a %s submission as checkout complete', async (status) => {
  const { runtime, completed } = tableRuntime(status)
  const menu = await runtime.invoke('menu_get') as { items: Array<{ id: string }> }
  await runtime.invoke('order_add_item', { itemId: menu.items[0]!.id, quantity: 1 })
  await reviewAndSubmit(runtime)
  const state = await runtime.invoke('kiosk_interaction_state') as { phase: string }
  expect(state.phase).not.toBe('checkout_complete')
  expect(completed).not.toHaveBeenCalled()
})

// Report: this chat,2026-11-06 —「我想付錢」submitted immediately and failure re-offered submission.
it.each(['我要付款', '我想結帳'])('reviews the table order before submitting for %s', async (transcript) => {
  const { runtime, submit } = tableRuntime()
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 3 })
  await runtime.invoke('kiosk_fast_path_context', { transcript })
  const review = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:start-checkout' }) as { customerMessage: string, pendingCustomerChoice: { questionId: string, question: string } }
  expect(submit).not.toHaveBeenCalled()
  expect(review.customerMessage).toContain('水餃 3 份')
  expect(review.customerMessage).toContain('240元')
  expect(review.pendingCustomerChoice.question).toBe('確認這份訂單並送出嗎？')
  await runtime.invoke('kiosk_dialogue_presented', { content: review.pendingCustomerChoice.question, questionId: review.pendingCustomerChoice.questionId })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '確認送出' })
  const submitted = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:start-checkout' })
  expect(submit).toHaveBeenCalledOnce()
  expect(submitted).toMatchObject({ customerMessage: '本桌訂單已送出。' })
  expect(submitted).not.toHaveProperty('pendingCustomerChoice')
})

it.each(['rejected', 'uncertain'] as const)('does not offer another submit question after a %s result', async (status) => {
  const { runtime } = tableRuntime(status)
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  const review = await runtime.invoke('checkout_start', { confirmedByUser: true }) as { pendingCustomerChoice?: { questionId: string, question: string } }
  if (review.pendingCustomerChoice)
    await runtime.invoke('kiosk_dialogue_presented', { content: review.pendingCustomerChoice.question, questionId: review.pendingCustomerChoice.questionId })
  const result = await runtime.invoke('checkout_start', { confirmedByUser: true })
  expect(result).toMatchObject({ customerMessage: '送單未完成。' })
  expect(result).not.toHaveProperty('pendingCustomerChoice')
})

it('does not treat repeated Main checkout calls or an edited cart as fresh user confirmation', async () => {
  const { runtime, submit } = tableRuntime()
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  const first = await runtime.invokeForAgent('checkout_start', { confirmedByUser: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  const repeated = await runtime.invokeForAgent('checkout_start', { confirmedByUser: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  expect(submit).not.toHaveBeenCalled()
  expect(repeated.pendingCustomerChoice.questionId).not.toBe(first.pendingCustomerChoice.questionId)
  await runtime.invoke('kiosk_dialogue_presented', { content: repeated.pendingCustomerChoice.question, questionId: repeated.pendingCustomerChoice.questionId })
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  const changed = await runtime.invokeForAgent('checkout_start', { confirmedByUser: true }) as { customerMessage: string }
  expect(changed.customerMessage).toContain('水餃 2 份')
  expect(submit).not.toHaveBeenCalled()
})

it('requires a fresh review if the Bridge round changes on the confirming turn', async () => {
  let context: OrderingContext = { id: 'old-round', serviceMode: 'table-service', table: { id: 'a03', label: 'a03' }, directSubmissionSupported: true }
  let reviews = 0
  const submit = vi.fn()
  const runtime = createMenuToolRuntime({ serviceContext: () => context, gateway: { submit }, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {}, onReviewRequested: () => {
    reviews++
    if (reviews === 2)
      context = { ...context, id: 'new-round', table: { id: 'a08', label: 'a08' } }
  } })
  const menu = await runtime.invoke('menu_get') as { items: Array<{ id: string }> }
  await runtime.invoke('order_add_item', { itemId: menu.items[0]!.id, quantity: 1 })
  const first = await runtime.invoke('checkout_start', { confirmedByUser: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_dialogue_presented', { content: first.pendingCustomerChoice.question, questionId: first.pendingCustomerChoice.questionId })
  const refreshed = await runtime.invoke('checkout_start', { confirmedByUser: true }) as { customerMessage: string, pendingCustomerChoice: { questionId: string } }
  expect(submit).not.toHaveBeenCalled()
  expect(refreshed.customerMessage).toContain('A08')
  expect(refreshed.pendingCustomerChoice.questionId).not.toBe(first.pendingCustomerChoice.questionId)
})

it('does not expose submission tools or ask to send when unpaid submission is unavailable', async () => {
  const context: OrderingContext = { id: 'unsupported', serviceMode: 'table-service', table: { id: 'a03', label: 'a03' }, directSubmissionSupported: false }
  const runtime = createMenuToolRuntime({ serviceContext: () => context, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  const menu = await runtime.invoke('menu_get') as { items: Array<{ id: string }> }
  await runtime.invoke('order_add_item', { itemId: menu.items[0]!.id, quantity: 1 })
  expect(runtime.toolDefinitions.some(tool => tool.name === 'checkout_start')).toBe(false)
  const state = await runtime.invoke('kiosk_fast_path_context', { transcript: '我要付款' }) as { candidates: Array<{ intent: string }> }
  expect(state.candidates.some(candidate => candidate.intent === 'START_CHECKOUT')).toBe(false)
  const result = await runtime.invoke('checkout_start', { confirmedByUser: true })
  expect(result).toMatchObject({ ok: false, customerMessage: '這份訂單無法直接送出。' })
  expect(result).not.toHaveProperty('pendingCustomerChoice')
})
