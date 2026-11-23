import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { describe, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { beginBrowserCartTask, executeBrowserCartTool, executeBrowserReply, prepareBrowserQuestionAnswer, readBrowserConversation } from './browserCartTask'
import { createBrowserDialogue } from './browserDialogue'
import { conversationSource } from './kiosk-fast-path'
import { createKioskUtteranceQueue } from './kioskUtteranceQueue'
import { createMenuReplyWindow, questionReceiptFrom, replyFromConversation } from './questionPresentation'

// Report: docs/plans/2026-10-22-kiosk-field-investigation.md, seq137/349/371.
describe('field operation replies', () => {
  it.each(['已加入排骨便當。', '已設為內用。'])('rejects an unverified no-tool completion: %s', (answer) => {
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer }, { menu: createMenuReplyWindow(), failureMessage: '尚未完成。' })).toEqual({ role: 'error', content: '尚未完成。' })
  })

  it('does not let a cart read complete a fulfillment change', () => {
    const menu = createMenuReplyWindow()
    menu.record('cart_get', { cart: { lines: [], total: 0 } })
    expect(replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['cart_get'], answer: '已設為內用。' }, { menu, handoff: { intent: 'SET_FULFILLMENT' }, failureMessage: '尚未完成。' })).toEqual({ role: 'error', content: '尚未完成。' })
  })
})

function pbTools(...names: string[]): ServiceTool[] {
  return names.map(name => ({
    name,
    description: name,
    inputSchema: { type: 'object' },
    origin: 'https://app.esgpb.com',
  }))
}

// Report: docs/plans/2026-10-22-kiosk-field-investigation.md and Nov23 latency
// investigation. Reconstruct the observed cart-navigation and short-utterance
// timing with synthetic cart data. Start at the ASR result, after recognition.
it('delivers the cart review question and processes a queued short follow-up once', async () => {
  const tools = pbTools('browser_state_get', 'browser_cart_get', 'browser_cart_review', 'browser_checkout_prepare')
  const cart = { version: 'cart-v1', subtotal: 80, lines: [{ ref: 'item-1', name: '水餃', quantity: 1, unitPrice: 80 }] }
  const menu = { ok: true, source: 'browser', page: 'menu', cart, products: [] }
  const cartPage = { ok: true, source: 'browser', page: 'cart', cart, customerMessage: '水餃一份，小計 80 元。' }
  let page: 'menu' | 'cart' = 'menu'
  let opened!: () => void
  let completeNavigation!: () => void
  const started = new Promise<void>(resolve => opened = resolve)
  const navigation = new Promise<void>(resolve => completeNavigation = resolve)
  const execute = vi.fn(async (tool: ServiceTool) => {
    if (tool.name === 'browser_cart_review') {
      opened()
      await navigation
      page = 'cart'
      return cartPage
    }
    if (tool.name === 'browser_checkout_prepare')
      return { ...cartPage, checkout: { methods: [{ method: 'none', label: '無載具', selected: false }], fields: [], missing: [], ready: false, orderNote: '' } }
    return page === 'cart' ? { ...cartPage, products: [] } : menu
  })
  const client = { tools: readonly(shallowRef(tools)), execute }
  const dialogue = createBrowserDialogue({ owner: () => 'replay', documentId: () => 'replay-page', answer: async () => ({ kind: 'UNCERTAIN', provider: 'main' }) })
  const decide = vi.fn(async () => {
    throw new Error('Reading the cart cannot admit a write.')
  })
  const handled: string[] = []
  const errors: unknown[] = []
  const queue = createKioskUtteranceQueue({ onError: (_utterance, error) => errors.push(error), process: async (utterance, control) => {
    const release = beginBrowserCartTask(utterance.text, { utteranceId: utterance.id, dialogue, decide, isCurrent: control.isCurrent })
    try {
      const context = await readBrowserConversation(client, String(utterance.id), [])
      handled.push(utterance.text)
      if (utterance.text === '我要結帳') {
        const receipt = await executeBrowserCartTool(client, tools[2], {})
        const question = questionReceiptFrom(receipt)
        expect(question?.question).toContain('正確嗎')
        const replies = createMenuReplyWindow()
        replies.record('browser_cart_review', JSON.stringify(receipt))
        const reply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['browser_cart_review'] }, { menu: replies, question, failureMessage: '操作未確認' })
        expect(reply.role).toBe('assistant')
        expect(reply.content).toContain('正確嗎')
        expect(reply.content).toContain('水餃')
      }
      else {
        expect(context).toMatchObject({ page: 'cart', waitingFor: { purpose: 'browser-service-question' } })
        const answer = await prepareBrowserQuestionAnswer(client)
        expect(answer).toBeTypeOf('function')
        expect(await answer?.()).toMatchObject({ pendingCustomerChoice: { question: expect.stringContaining('發票') } })
      }
    }
    finally { release() }
  } })
  queue.submit({ source: 'asr', text: '我要結帳' })
  await started
  const followUp = queue.reserve('asr')
  if (followUp.kind !== 'ACCEPTED')
    throw new Error('The short follow-up was not admitted.')
  followUp.complete({ text: '對' })
  expect(handled).toEqual(['我要結帳'])
  completeNavigation()
  await queue.idle()
  if (errors.length)
    throw errors[0]
  expect(handled).toEqual(['我要結帳', '對'])
  expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_state_get', 'browser_cart_review', 'browser_state_get', 'browser_checkout_prepare'])
  expect(decide).not.toHaveBeenCalled()
})

// Report: docs/codex-handoff.md, 2026-11-23 RC6 submission recovery,
// seq698–708. Replay the transition from the editor to the result document
// where only the native state reader survives rediscovery.
it('keeps the PB reply path after the editor retires and reports pending payment', async () => {
  const tools = shallowRef(pbTools('browser_state_get', 'browser_cart_get'))
  const execute = vi.fn(async (_tool: ServiceTool) => ({ ok: true, source: 'browser', page: 'payment', observedAt: 123, order: {
    reference: 'REPLAY-ORDER',
    status: 20,
    total: 80,
    paymentStatus: 'pending',
    paymentMethods: ['LINE Pay', '信用卡'],
    invoice: { method: 'none' },
  } }))
  const client = { tools: readonly(tools), execute }
  const replies = createMenuReplyWindow()
  const unconfirmed = '已送出訂單，結果尚未確認，請勿重複送單。'
  replies.record('browser_order_submit', JSON.stringify({
    schemaVersion: 1,
    ok: true,
    source: 'browser',
    code: 'order-submission-result',
    dispatch: 'dispatched',
    status: 'unknown',
    effect: 'unknown',
    consistency: 'unavailable',
    reason: 'invalid-result-format',
    customerMessage: unconfirmed,
  }))
  const firstReply = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['browser_order_submit'] }, {
    menu: replies,
    failureMessage: '操作未確認',
    browserRecovery: { operationAttempted: true, page: 'cart' },
  })
  expect(firstReply).toMatchObject({ role: 'assistant', content: expect.stringContaining('勿重複送單') })

  const source = conversationSource(tools.value)
  tools.value = pbTools('browser_state_get')
  expect(conversationSource(tools.value)).toBe(source)
  expect(source).toBe('browser')
  const decide = vi.fn(async () => {
    throw new Error('Reading payment cannot admit a write.')
  })
  const release = beginBrowserCartTask('現在可以付款嗎', { decide, isCurrent: () => true })
  try {
    expect(await readBrowserConversation(client, 'payment-replay', ['browser_respond', 'browser_cart_get'])).toMatchObject({ page: 'payment', allowedToolNames: ['browser_respond'] })
    const receipt = await executeBrowserReply(client, 'checkout-guidance')
    expect(receipt).toMatchObject({ effect: 'none', customerMessage: expect.stringContaining('尚未付款') })
    expect(receipt).toMatchObject({ customerMessage: expect.stringContaining('LINE Pay或信用卡') })
    expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_state_get', 'browser_state_get'])
    expect(decide).not.toHaveBeenCalled()
  }
  finally { release() }
})
