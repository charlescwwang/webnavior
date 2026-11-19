import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'

import { expect, it } from 'vitest'

import { orderingInstructions } from './skills'

const context: BrowserConversation = { taskId: 'current', sourceUtterance: '雞腿飯', phase: 'browsing', readOnly: false, catalog: { complete: true, products: [] }, allowedToolNames: [] }

it('loads only the active workflow with common invariants and a stable content version', () => {
  const result = orderingInstructions({ ...context, phase: 'collecting_quantity' })
  expect(result.workflow).toBe('order')
  expect(result.version).toMatch(/^2026-11-12\.[a-f0-9]{12}$/)
  expect(result.instructions).toContain('未知份數不預設一份')
  expect(result.instructions).not.toContain('## 桌號流程')
  expect(result.instructions).not.toContain('## 發票與結帳流程')
  expect(orderingInstructions({ ...context, phase: 'configuring' }).version).toBe(result.version)
})

it('routes by verified page and pending task instead of an extra classifier or utterance keywords', () => {
  expect(orderingInstructions({ ...context, page: 'table' }).workflow).toBe('table')
  expect(orderingInstructions({ ...context, page: 'cart' }).workflow).toBe('cart')
  expect(orderingInstructions({ ...context, page: 'cart', phase: 'confirming_add' }).workflow).toBe('order')
  expect(orderingInstructions({ ...context, page: 'checkout' }).workflow).toBe('checkout')
  expect(orderingInstructions({ ...context, readOnly: true }).workflow).toBe('browse')
  expect(orderingInstructions(undefined).workflow).toBe('browse')
})

it('teaches table selection and menu entry as distinct voice operations without accepting a website default', () => {
  const { instructions } = orderingInstructions({ ...context, phase: 'selecting_table', page: 'table' })
  expect(instructions).toContain('select_table')
  expect(instructions).toContain('start_ordering_at_table')
  expect(instructions).toContain('沒有就先問桌號')
  expect(instructions).not.toContain('請顧客點「開始點餐」')
})

// Public tool vocabulary must agree with every program-selected Main workflow.
it('keeps all Main workflow instructions on the public business-tool contract', () => {
  for (const page of ['table', 'menu', 'cart', 'checkout'] as const) {
    const { instructions } = orderingInstructions({ ...context, page })
    expect(instructions).not.toMatch(/browser_[a-z_]+/)
    expect(instructions).not.toMatch(/加車|空車|改車|原車|車況/)
    expect(instructions).toContain('add_items_to_cart')
  }
})

// Report: this chat, Nov19 — Main used promotion-policy as a missing-field question type.
it('keeps promotion inquiries on the reply tool in every active ordering workflow', () => {
  for (const page of ['table', 'menu', 'cart', 'checkout'] as const) {
    const { instructions } = orderingInstructions({ ...context, page })
    expect(instructions).toContain('「有沒有買一送一／現在有什麼優惠」是活動資訊詢問')
    expect(instructions).toContain('promotion-policy 不是 ask_customer_question 的 questionType')
    expect(instructions).toContain('不得當成 customerMessage 朗讀或轉貼')
    expect(instructions).toContain('關鍵字查詢只補找候選')
    expect(instructions).toContain('不能因名稱含湯就把湯餃、含湯套餐當成單點湯品')
  }
})
