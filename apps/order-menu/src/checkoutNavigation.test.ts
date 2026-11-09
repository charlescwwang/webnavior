import type { CheckoutSnapshot } from './domain/checkout-flow'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { beginCheckout, chooseInvoiceMethod, confirmInvoiceDraft, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from './domain/checkout-flow'
import { createMenuToolRuntime } from './webmcp'

async function setup() {
  let checkout: CheckoutSnapshot | undefined
  let revision = 0
  let review = false
  let task = 0
  const update = (next: CheckoutSnapshot) => {
    revision++
    checkout = next
    return next
  }
  const runtime = createMenuToolRuntime({
    menu: [{ id: 'meal', name: '測試便當', price: 100, category: '便當', description: '', imageUrl: '', recommendationTags: [], optionGroups: [] }],
    screen: () => checkout ? 'checkout' : review ? 'cart_review' : 'menu',
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
    onReviewRequested: () => { review = true },
    checkout: {
      snapshot: () => checkout,
      revision: () => revision,
      paymentStatus: () => undefined,
      assertCanRestart: () => {},
      restart: () => {
        checkout = undefined
        revision++
      },
      cancel: () => {
        checkout = undefined
        revision++
        review = true
      },
      start: () => update(beginCheckout('collected')),
      skipMembership: () => update(skipMembership(checkout!)),
      chooseInvoice: method => update(chooseInvoiceMethod(checkout!, method)),
      confirmInvoice: () => update(confirmInvoiceDraft(checkout!)),
      requestTaxId: () => update(requestTaxId(checkout!)),
      setTaxId: code => update(setTaxIdDraft(checkout!, code)),
      confirmTaxId: () => update(confirmTaxId(checkout!)),
      selectPayment: async () => { throw new Error('No payment in navigation tests') },
    },
  })
  await runtime.invoke('order_add_item', { itemId: 'meal', quantity: 1 })
  await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
  const start = await runtime.invoke('checkout_start', { confirmedByUser: true })
  const begin = async (transcript: string, readOnly = false) => {
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: `test:${task}` })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: `test:${++task}`, transcript, expectedMenuRevision: 0, readOnly, constraints: {} })
    return parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  }
  const offer = async (tool: 'order_set_fulfillment' | 'checkout_cancel' = 'order_set_fulfillment') => {
    await begin(tool === 'checkout_cancel' ? '返回訂單' : '我要自取')
    const result = await runtime.invokeForAgent(tool, tool === 'checkout_cancel' ? { confirmedByUser: true } : { mode: 'takeout' }) as { customerMessage: string, pendingConfirmation: { confirmationId: string }, pendingCustomerChoice: { questionId: string, question: string } }
    return result
  }
  const present = async (result: Awaited<ReturnType<typeof offer>>) => {
    await runtime.invoke('kiosk_dialogue_presented', { content: result.customerMessage, questionId: result.pendingCustomerChoice?.questionId, interruptsQuestion: true })
  }
  const end = () => runtime.invoke('kiosk_agent_task', { action: 'END', taskId: `test:${task}` })
  return { runtime, begin, end, offer, present, start, snapshot: () => checkout, screen: () => checkout ? 'checkout' : review ? 'cart_review' : 'menu', hideReview: () => {
    review = false
  } }
}

// Report: this chat, Nov2 14:57–14:58; change-to-takeout confirmation selected carrier instead.
it('publishes the exact mode-change question and gives Main its bound answer operation', async () => {
  const f = await setup()
  const result = await f.offer()
  expect(result.pendingCustomerChoice).toMatchObject({ questionId: result.pendingConfirmation.confirmationId, purpose: 'operation-confirmation' })
  await f.present(result)
  const context = await f.begin('確認')
  expect(context.phase).toBe('pending_confirmation')
  expect(context.waitingFor?.question).toContain('自取')
  expect(context.allowedToolNames).toContain('order_answer_confirmation')
  expect(context.allowedToolNames).not.toContain('checkout_choose_invoice')
  await f.runtime.invokeForAgent('order_answer_confirmation', { confirmationId: result.pendingConfirmation.confirmationId, confirmedByUser: true })
  expect(f.snapshot()).toBeUndefined()
  expect(f.screen()).toBe('cart_review')
  expect(await f.runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'takeout', itemCount: 1 } })
})

it('cancels the bound proposal while retaining checkout and dine-in', async () => {
  const f = await setup()
  const result = await f.offer()
  await f.present(result)
  await f.begin('取消')
  await f.runtime.invokeForAgent('order_answer_confirmation', { confirmationId: result.pendingConfirmation.confirmationId, confirmedByUser: false })
  expect(f.snapshot()?.stage).toBe('invoice')
  expect(await f.runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'dine-in', itemCount: 1 } })
})

it.each(['wrong-id', 'expired-task', 'changed', 'same-turn', 'unpresented', 'duplicate'])('rejects %s confirmation without selecting invoice or silently applying another action', async (scenario) => {
  vi.useFakeTimers()
  try {
    const f = await setup()
    const result = await f.offer()
    if (scenario !== 'unpresented')
      await f.present(result)
    if (scenario !== 'same-turn')
      await f.begin('確認')
    if (scenario === 'expired-task')
      vi.advanceTimersByTime(300_001)
    if (scenario === 'changed') {
      await f.end()
      await f.runtime.invokeManual('cart_set_line_quantity', { lineId: (await f.runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ id: string }> } }).cart.lines[0]!.id, quantity: 2 })
      await f.begin('確認')
    }
    const answer = { confirmationId: scenario === 'wrong-id' ? 'wrong-id' : result.pendingConfirmation.confirmationId, confirmedByUser: true }
    if (scenario === 'duplicate')
      await f.runtime.invokeForAgent('order_answer_confirmation', answer)
    await expect(f.runtime.invokeForAgent('order_answer_confirmation', answer)).rejects.toThrow()
    if (scenario !== 'duplicate') {
      expect(f.snapshot()?.stage).toBe('invoice')
      expect(f.snapshot()?.invoiceMethod).toBeUndefined()
      expect(await f.runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'dine-in' } })
    }
  }
  finally { vi.useRealTimers() }
})

it('returns to the order through checkout cancellation and preserves its meals', async () => {
  const f = await setup()
  await f.begin('回到訂單頁面')
  await f.runtime.invokeForAgent('checkout_cancel', { confirmedByUser: true })
  expect(f.snapshot()).toBeUndefined()
  expect(f.screen()).toBe('cart_review')
  expect(await f.runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'dine-in', itemCount: 1 } })
})

// Report: this chat, Nov2 14:56; explicit open-cart request produced acknowledgement only.
it('allows an explicit read-only cart display to open the actual review without modifying the order', async () => {
  const f = await setup()
  await f.runtime.invokeManual('checkout_cancel', { confirmedByUser: true })
  f.hideReview()
  await f.begin('幫我打開購物車', true)
  const result = await f.runtime.invokeForAgent('cart_get', { display: true })
  expect(f.screen()).toBe('cart_review')
  expect(result).toMatchObject({ cart: { itemCount: 1, fulfillmentMode: 'dine-in' } })
  expect(result).toHaveProperty('pendingCustomerChoice.purpose', 'checkout-entry')
})

it('keeps internal cart reads on the current screen and preserves a live checkout', async () => {
  const f = await setup()
  await f.begin('我想看購物車內容', true)
  await f.runtime.invokeForAgent('cart_get', { display: true })
  expect(f.screen()).toBe('checkout')
  await f.end()
  await f.runtime.invokeManual('checkout_cancel', { confirmedByUser: true })
  f.hideReview()
  await f.begin('查看訂單金額', true)
  await f.runtime.invokeForAgent('cart_get', { display: false })
  expect(f.screen()).toBe('menu')
})

it('names the retained fulfillment mode at checkout and keeps additions on the same order', async () => {
  const f = await setup()
  expect(f.start).toMatchObject({ customerMessage: expect.stringContaining('內用') })
  await f.runtime.invokeManual('checkout_cancel', { confirmedByUser: true })
  await f.runtime.invokeForAgent('order_add_item', { itemId: 'meal', quantity: 1 })
  expect(await f.runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'dine-in', itemCount: 2 } })
})

// Report: Nov2 Jev/Main N01-J-A1; reaffirming dine-in after cancellation opened a second mode-change question.
it('reaffirms the existing mode during checkout without asking to return and change it again', async () => {
  const f = await setup()
  await f.begin('還是內用')
  const result = await f.runtime.invokeForAgent('order_set_fulfillment', { mode: 'dine-in' })
  expect(result).not.toHaveProperty('pendingConfirmation')
  expect(result).toMatchObject({ customerMessage: expect.stringContaining('目前已是內用') })
  expect(f.snapshot()?.stage).toBe('invoice')
})

it('retains the presented confirmation across silence and answers only in a fresh task', async () => {
  vi.useFakeTimers()
  try {
    const f = await setup()
    const offered = await f.offer()
    await f.present(offered)
    await f.end()
    vi.advanceTimersByTime(120_000)
    const context = await f.begin('確認')
    expect(context.phase).toBe('pending_confirmation')
    expect(context.waitingFor?.expiresAt).toBeLessThan(Date.now())
    expect(context.allowedToolNames).not.toContain('checkout_choose_invoice')
    expect(context.allowedToolNames).toContain('order_answer_confirmation')
    expect(f.snapshot()?.invoiceMethod).toBeUndefined()
    await f.runtime.invokeForAgent('order_answer_confirmation', { confirmationId: offered.pendingConfirmation.confirmationId, confirmedByUser: true })
    expect(f.snapshot()).toBeUndefined()
    expect(await f.runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { fulfillmentMode: 'takeout', itemCount: 1 } })
  }
  finally { vi.useRealTimers() }
})

it('rejects the old ticket after cancellation and a new proposal without consuming the new one', async () => {
  const f = await setup()
  const first = await f.offer()
  await f.present(first)
  await f.begin('取消')
  await f.runtime.invokeForAgent('order_answer_confirmation', { confirmationId: first.pendingConfirmation.confirmationId, confirmedByUser: false })
  const second = await f.offer()
  await f.present(second)
  await f.begin('確認')
  await expect(f.runtime.invokeForAgent('order_answer_confirmation', { confirmationId: first.pendingConfirmation.confirmationId, confirmedByUser: true })).rejects.toThrow('STALE_PLAN')
  expect(f.snapshot()?.stage).toBe('invoice')
  await f.runtime.invokeForAgent('order_answer_confirmation', { confirmationId: second.pendingConfirmation.confirmationId, confirmedByUser: true })
  expect(f.snapshot()).toBeUndefined()
  expect(await f.runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, fulfillmentMode: 'takeout' } })
})
