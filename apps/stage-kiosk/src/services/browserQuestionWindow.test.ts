import { expect, it } from 'vitest'

import { createBrowserQuestionWindow } from './browserQuestionWindow'

function setup() {
  let time = 1000
  const window = createBrowserQuestionWindow(() => time)
  const products = [{ productRef: 'p-today-a', name: '今日餐甲', configurationVersion: 'a', unitPrice: 21 }, { productRef: 'p-today-b', name: '今日餐乙', configurationVersion: 'b', unitPrice: 25 }]
  const snapshot = { owner: 'customer-a', documentId: 'document-a', cartVersion: 'cart-a', products }
  return { window, products, snapshot, advance: (milliseconds: number) => time += milliseconds }
}

it('keeps the original second candidate after the live daily list is reordered', () => {
  const { window, products, snapshot } = setup()
  const question = window.presentProducts(snapshot, products, '我要一份餐點')
  const reordered = { ...snapshot, products: [...products].reverse() }
  expect(window.consume(question.questionId, 'product:2', reordered)).toEqual({ kind: 'product', product: products[1] })
  expect(window.consume(question.questionId, 'product:2', reordered)).toEqual({ kind: 'invalid' })
})

it.each(['owner', 'documentId', 'cartVersion'] as const)('revokes short-answer authority after %s changes', (key) => {
  const { window, products, snapshot } = setup()
  const question = window.presentProducts(snapshot, products, '我要一份餐點')
  expect(window.consume(question.questionId, 'product:2', { ...snapshot, [key]: 'replacement' })).toEqual({ kind: 'invalid' })
  expect(window.pending(snapshot)).toBeUndefined()
})

it.each(['productRef', 'name', 'configurationVersion', 'unitPrice'] as const)('invalidates a question when the original candidate %s changes', (key) => {
  const { window, products, snapshot } = setup()
  const question = window.presentProducts(snapshot, products, '我要一份餐點')
  const changed = { ...products[1], [key]: key === 'unitPrice' ? 26 : 'next-day-value' }
  expect(window.consume(question.questionId, 'product:2', { ...snapshot, products: [products[0], changed] })).toEqual({ kind: 'invalid' })
})

it('does not let an expired or superseded answer consume a newer question', () => {
  const { window, products, snapshot, advance } = setup()
  const first = window.presentProducts(snapshot, products, '我要一份餐點')
  const second = window.presentProducts(snapshot, products, '重新選一次')
  expect(window.consume(first.questionId, 'product:1', snapshot)).toEqual({ kind: 'invalid' })
  expect(window.pending(snapshot)?.question.questionId).toBe(second.questionId)
  advance(120_001)
  expect(window.consume(second.questionId, 'product:1', snapshot)).toEqual({ kind: 'invalid' })
})

it('requires a separate full confirmation and consumes its stored plan exactly once', () => {
  const { window, products, snapshot } = setup()
  const productQuestion = window.presentProducts(snapshot, products, '我要一份餐點')
  expect(window.consume(productQuestion.questionId, 'product:2', snapshot).kind).toBe('product')
  const proposal = { productRef: products[1].productRef, productName: products[1].name, quantity: 2, unitPrice: 25, note: '', optionSummary: '', options: [], selection: { version: 'b', variantRef: '', choices: [] } }
  const confirm = window.presentAddition(snapshot, proposal)
  proposal.quantity = 9
  expect(confirm.question).toContain('2 份')
  expect(confirm.question).toContain('50 元')
  expect(window.consume(confirm.questionId, 'confirm', snapshot)).toMatchObject({ kind: 'addition', proposal: { quantity: 2 } })
  expect(window.consume(confirm.questionId, 'confirm', snapshot)).toEqual({ kind: 'invalid' })
})

// Report: this chat, Nov12; ordinary meals were all described as 不加料.
it('omits an empty customization label while retaining requested options and notes', () => {
  const { window, products, snapshot } = setup()
  const base = { productRef: products[0].productRef, productName: products[0].name, quantity: 1, unitPrice: 21, note: '', optionSummary: '', options: [], selection: { version: 'a', variantRef: '', choices: [] } }
  expect(window.presentOrder(snapshot, [base]).question).not.toContain('不加料')
  const configured = { ...base, options: [{ name: '加蛋', quantity: 1 }], optionSummary: '加蛋 每份 1 個', note: '不要蔥' }
  expect(window.presentOrder(snapshot, [configured]).question).toContain('加蛋 每份 1 個')
  expect(window.presentOrder(snapshot, [configured]).question).toContain('不要蔥')
})

// Report: this chat, Nov12; the fixed 確認加入： prefix sounded like an internal status label.
it('asks a natural confirmation while keeping the same single-use sealed order', () => {
  const { window, products, snapshot } = setup()
  const proposal = { productRef: products[0].productRef, productName: products[0].name, quantity: 2, unitPrice: 21, note: '', optionSummary: '', options: [], selection: { version: 'a', variantRef: '', choices: [] } }
  const question = window.presentOrder(snapshot, [proposal])
  expect(question.question).toBe('今日餐甲 2 份，單份 21 元。合計 42 元，要幫您加入購物車嗎？')
  expect(question.question).not.toContain('確認加入：')
  expect(window.consume(question.questionId, 'confirm', snapshot)).toMatchObject({ kind: 'order', proposals: [proposal] })
  expect(window.consume(question.questionId, 'confirm', snapshot)).toEqual({ kind: 'invalid' })
})

// Report: this chat, Nov12; PB's minimum notice should not be read as part of the dish name.
it('speaks the dumpling count per serving while preserving vendor identity and the sealed quantities', () => {
  const { window, snapshot } = setup()
  const product = { productRef: 'p-2589', name: '周氏水餃(最低8顆)', configurationVersion: 'dumpling', unitPrice: 64 }
  const binding = { ...snapshot, products: [product] }
  const proposal = { productRef: product.productRef, productName: product.name, quantity: 2, unitPrice: 80, note: '', optionSummary: '水餃 每份 2 個', options: [{ name: '水餃1顆', quantity: 2 }], selection: { version: 'dumpling', variantRef: '', choices: [{ ref: 'a-774', quantity: 2 }] } }
  expect(window.presentQuantity(binding, product, '我要水餃').question).toBe('周氏水餃基本每份8顆，最少8顆，可以加量。請問「周氏水餃」要幾份？')
  const confirmation = window.presentOrder(binding, [proposal])
  expect(confirmation.question).toContain('周氏水餃 每份 10 顆，2 份')
  expect(confirmation.question).not.toContain('最低')
  expect(confirmation.question).toContain('160 元')
  expect(window.consume(confirmation.questionId, 'confirm', binding)).toMatchObject({ kind: 'order', proposals: [{ productName: product.name, quantity: 2, selection: proposal.selection }] })
})

it('cancels or resets a pending choice without returning any executable proposal', () => {
  const { window, products, snapshot } = setup()
  const question = window.presentProducts(snapshot, products, '我要一份餐點')
  expect(window.consume(question.questionId, 'cancel', snapshot)).toEqual({ kind: 'cancelled' })
  expect(window.pending(snapshot)).toBeUndefined()
  window.presentProducts(snapshot, products, '再看一次')
  window.reset()
  expect(window.pending(snapshot)).toBeUndefined()
})

// Report: this chat, Nov11; PB has no previous/next page controls and the real kiosk is portrait.
it('offers three spoken choices per batch without claiming the PB website has pages', () => {
  const { window, snapshot } = setup()
  const products = Array.from({ length: 19 }, (_, index) => ({ productRef: `p-day-${index}`, name: `每日餐點${index + 1}`, configurationVersion: `revision-${index}`, unitPrice: 20 + index }))
  const current = { ...snapshot, products }
  const first = window.presentProducts(current, products, '有哪些餐點')
  expect(first.choices.filter(choice => choice.id.startsWith('product:'))).toHaveLength(3)
  expect(first.question).not.toContain('頁')
  expect(first.question).not.toContain('其他選項')
  const next = window.consume(first.questionId, 'next', current)
  expect(next.kind).toBe('page')
  if (next.kind !== 'page')
    throw new Error('Expected the observed next page.')
  const second = window.presentProducts(current, next.products, next.request, next.page)
  expect(second.question).toContain('每日餐點4')
  expect(second.question).not.toContain('頁')
  expect(window.consume(second.questionId, 'product:2', { ...current, products: [...products].reverse() })).toEqual({ kind: 'product', product: products[4] })
})

// Report: this chat, Nov15 — checkout assent reached Main without its displayed question.
it.each(['review-checkout', 'cart-review', 'invoice-method', 'submit-order'])('keeps %s bound to the cart rather than unrelated menu configurations', (purpose) => {
  const { window, snapshot } = setup()
  const question = window.presentService(snapshot, { purpose, request: '', question: '繼續嗎？', choices: [{ id: 'yes', description: '繼續目前步驟' }] })
  const fresh = { ...snapshot, products: snapshot.products.map(product => ({ ...product, configurationVersion: 'new-pickup-time' })) }
  expect(window.pending(fresh)?.question.questionId).toBe(question.questionId)
  expect(window.consume(question.questionId, 'yes', fresh)).toMatchObject({ kind: 'service', purpose })
  expect(window.consume(question.questionId, 'yes', fresh)).toEqual({ kind: 'invalid' })
})

it.each(['owner', 'documentId', 'cartVersion', 'expiry'] as const)('still revokes checkout consent after %s changes', (key) => {
  const { window, snapshot, advance } = setup()
  const question = window.presentService(snapshot, { purpose: 'cart-review', request: '', question: '正確嗎？', choices: [{ id: 'yes', description: '核對購物車' }] })
  if (key === 'expiry')
    advance(120_001)
  const fresh = key === 'expiry' ? snapshot : { ...snapshot, [key]: 'different' }
  expect(window.consume(question.questionId, 'yes', fresh)).toEqual({ kind: 'invalid' })
})

// Report: this chat, 2026-11-15; a new pork introduction retained the old chicken checkout question.
it('supersedes a checkout offer with an explicitly presented purchase question', () => {
  const { window, snapshot, products } = setup()
  const checkout = window.presentService(snapshot, { purpose: 'review-checkout', request: '雞腿一份', question: '要結帳嗎？', choices: [{ id: 'yes', description: '核對購物車' }] })
  const input = { purpose: 'purchase-recommendation', name: products[1].name, quantity: 1, request: '餐乙呢？', question: '餐乙要來一份嗎？', choices: [{ id: 'yes', description: '加入餐乙一份' }] }
  const purchase = window.presentService(snapshot, input)
  expect(purchase.questionId).not.toBe(checkout.questionId)
  expect(purchase.question).toBe(input.question)
  expect(window.pending(snapshot)?.question.questionId).toBe(purchase.questionId)
  expect(window.consume(checkout.questionId, 'yes', snapshot)).toEqual({ kind: 'invalid' })
  expect(window.presentService(snapshot, input).questionId).toBe(purchase.questionId)
  window.releaseService(snapshot, purchase.questionId)
  expect(window.pending(snapshot)).toBeUndefined()
})
