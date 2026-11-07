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
  const proposal = { productRef: products[1].productRef, productName: products[1].name, quantity: 2, unitPrice: 25, note: '', optionSummary: '', selection: { version: 'b', variantRef: '', choices: [] } }
  const confirm = window.presentAddition(snapshot, proposal)
  proposal.quantity = 9
  expect(confirm.question).toContain('2 份')
  expect(confirm.question).toContain('50 元')
  expect(window.consume(confirm.questionId, 'confirm', snapshot)).toMatchObject({ kind: 'addition', proposal: { quantity: 2 } })
  expect(window.consume(confirm.questionId, 'confirm', snapshot)).toEqual({ kind: 'invalid' })
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

it('keeps every daily candidate while paging bounded spoken choices', () => {
  const { window, snapshot } = setup()
  const products = Array.from({ length: 19 }, (_, index) => ({ productRef: `p-day-${index}`, name: `每日餐點${index + 1}`, configurationVersion: `revision-${index}`, unitPrice: 20 + index }))
  const current = { ...snapshot, products }
  const first = window.presentProducts(current, products, '有哪些餐點')
  expect(first.choices).toHaveLength(10)
  const next = window.consume(first.questionId, 'next', current)
  expect(next.kind).toBe('page')
  if (next.kind !== 'page')
    throw new Error('Expected the observed next page.')
  const second = window.presentProducts(current, next.products, next.request, next.page)
  expect(second.question).toContain('每日餐點9')
  expect(window.consume(second.questionId, 'product:2', { ...current, products: [...products].reverse() })).toEqual({ kind: 'product', product: products[9] })
})
