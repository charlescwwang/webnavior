import type { BrowserConversation } from './browserConversation'

import { expect, it } from 'vitest'

import { browserToolResult } from './browserConversation'
import { availableOrderingTools, nativeOrderingToolName } from './orderingTools'

const context: BrowserConversation = { taskId: 'test', sourceUtterance: '雞腿飯改兩份', page: 'menu', phase: 'browsing', readOnly: false, cart: { version: 'cart', lines: [{ ref: 'line', name: '雞腿飯', quantity: 3 }] }, catalog: { complete: true, products: [] }, allowedToolNames: [] }
it('offers only table operations and bounded questions on table entry', () => {
  expect(availableOrderingTools({ ...context, page: 'table', phase: 'selecting_table', cart: undefined })).toEqual(['select_table', 'start_ordering_at_table', 'ask_customer_question', 'reply_to_customer'])
})
it('allows cart changes from the menu, but never from an information-only request', () => {
  expect(availableOrderingTools(context)).toContain('set_cart_item_quantity')
  expect(availableOrderingTools(context)).toContain('remove_items_from_cart')
  expect(availableOrderingTools({ ...context, readOnly: true })).not.toContain('add_items_to_cart')
  expect(availableOrderingTools({ ...context, readOnly: true })).not.toContain('set_cart_item_quantity')
  expect(availableOrderingTools({ ...context, cart: { version: 'empty', lines: [] } })).not.toContain('remove_items_from_cart')
})
it('exposes cancellation only for an actual unfinished selection or question', () => {
  expect(availableOrderingTools(context)).not.toContain('cancel_item_selection')
  expect(availableOrderingTools({ ...context, itemSelectionOpen: true })).toContain('cancel_item_selection')
  expect(nativeOrderingToolName('list_cart_items')).toBe('browser_cart_get')
  expect(nativeOrderingToolName('add_items_to_cart')).toBe('browser_cart_add')
})

it('keeps clarification available when a request has not identified a meal yet', () => {
  expect(availableOrderingTools({ ...context, sourceUtterance: '改成兩份', providedSlots: undefined })).toContain('ask_customer_question')
})

// Report: this chat, Nov14 audit — internal instructions must not name tools Main cannot call.
it('translates Host draft and confirmation hints into the published model vocabulary', () => {
  const receipt = browserToolResult('add_items_to_cart', { source: 'browser', dataOnly: true, explanation: '呼叫 browser_confirm_add；缺資料時用 browser_order_draft；查詳情用 browser_product_get。', nextStep: '使用 browser_cart_quantity 修改。' })
  expect(receipt.reason).toContain('add_items_to_cart')
  expect(receipt.reason).toContain('get_menu_item_details')
  expect(receipt.nextStep).toContain('set_cart_item_quantity')
  expect(JSON.stringify(receipt)).not.toContain('browser_')
})

// Report: this chat, Nov14 audit — page, task and cart evidence must be independent.
it.each(['menu', 'cart', 'checkout'] as const)('keeps cart edits available from %s with fresh cart ownership and permits no writes for read-only demand', (page) => {
  for (const readOnly of [false, true]) {
    for (const populated of [false, true]) {
      const tools = availableOrderingTools({ ...context, page, readOnly, cart: { version: 'cart', lines: populated ? context.cart!.lines : [] } })
      expect(tools).toContain('list_cart_items')
      expect(tools).toContain('get_menu_item_details')
      expect(tools.includes('add_items_to_cart')).toBe(!readOnly)
      expect(tools.includes('set_cart_item_quantity')).toBe(!readOnly && populated)
      expect(tools.includes('remove_items_from_cart')).toBe(!readOnly && populated)
      expect(tools.includes('replace_item_in_cart')).toBe(!readOnly && populated)
      expect(tools).not.toContain('select_table')
    }
  }
})
it.each(['sign_in_required', 'review_required'] as const)('restricts %s to an explanation even if stale cart/selection fields are present', (phase) => {
  expect(availableOrderingTools({ ...context, phase, itemSelectionOpen: true, search: '雞腿', readOnly: false })).toEqual(['reply_to_customer'])
})
it('retains cancellation in every live pending-question phase without treating the question as purchase consent', () => {
  const waitingFor = { questionId: 'q', purpose: 'browser-confirm-add', question: '要加入嗎？', choices: [{ id: 'confirm', description: '加入一份' }], expiresAt: Date.now() + 60000 }
  for (const phase of ['choosing_product', 'collecting_quantity', 'configuring', 'confirming_add'] as const) {
    const tools = availableOrderingTools({ ...context, phase, waitingFor })
    expect(tools).toContain('cancel_item_selection')
    expect(tools).toContain('ask_customer_question')
    expect(tools).toContain('list_cart_items')
  }
})

// Report: this chat, Nov14; the issued table question was mislabeled information_ready.
it('projects a completed clarification as waiting for the customer, not another model task', () => {
  const receipt = browserToolResult('ask_customer_question', { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '請確認桌號。', tableChoices: ['A1 桌'] })
  expect(receipt.outcome).toBe('awaiting_customer_answer')
})

it('does not treat a read preserving an older question as a newly issued question', () => {
  expect(browserToolResult('list_menu_items', { ok: true, source: 'browser', dataOnly: true, pendingCustomerChoice: { question: '要幾份？' } }).outcome).toBe('information_ready')
})
it('recognizes a Host clarification as waiting for the customer too', () => {
  expect(browserToolResult('start_ordering_at_table', { ok: true, source: 'host', status: 'clarification', effect: 'none', customerMessage: '請確認桌號。' }).outcome).toBe('awaiting_customer_answer')
})

// Report: this chat, 2026-11-15; a dispatched order is not a verified merchant acceptance.
it.each([
  { status: 'pending', effect: 'pending', consistency: 'unavailable', outcome: 'action_pending' },
  { status: 'accepted', effect: 'applied', consistency: 'unavailable', outcome: 'action_completed' },
  { status: 'accepted', effect: 'applied', consistency: 'conflict', outcome: 'action_completed' },
  { status: 'unknown', effect: 'unknown', consistency: 'unavailable', outcome: 'action_result_requires_review' },
  { status: 'rejected', effect: 'none', consistency: 'unavailable', outcome: 'action_blocked' },
])('projects submission $status/$consistency without losing its distinct outcome', ({ outcome, ...state }) => {
  const order = state.status === 'accepted' ? { hash: 'order-hash', number: '4006', status: 20, total: 50 } : undefined
  const result = browserToolResult('browser_order_submit', { schemaVersion: 1, code: 'order-submission-result', source: 'browser', ok: true, dispatch: 'dispatched', ...state, ...(order ? { order } : {}), reason: 'verified-test-result', customerMessage: '回覆依核實狀態產生' })
  expect(result.outcome).toBe(outcome)
  expect(result.submission).toMatchObject({ status: state.status, consistency: state.consistency })
  expect(result.customerMessage).toBe('回覆依核實狀態產生')
  if (order) {
    const submission = result.submission
    if (submission?.status !== 'accepted')
      throw new Error('Expected a verified merchant acceptance.')
    expect(submission.order).toEqual(order)
  }
})

// Report: this chat, 2026-11-15; tool success must retain the unabridged compound request for Main's existing next round.
it('projects tool-level completion without claiming the complete customer request is finished', () => {
  const result = browserToolResult('replace_item_in_cart', { ok: true, source: 'browser', status: 'verified', effect: 'applied', completionScope: 'tool-call', originalRequest: '排骨三份、雞腿只要一份', completedEffects: ['雞腿兩份已換成排骨兩份'] })
  expect(result.outcome).toBe('action_completed')
  expect(result.completionScope).toBe('tool-call')
  expect(result.originalRequest).toBe('排骨三份、雞腿只要一份')
  expect(result.completedEffects).toEqual(['雞腿兩份已換成排骨兩份'])
})
