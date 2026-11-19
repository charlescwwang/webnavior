import { expect, it } from 'vitest'

import { approximateTables, createTableSelection } from './tableSelection'

const entry = () => ({ page: 'table', tableChoices: ['A3-1 桌', 'A3-2 桌'], selectedTable: 'A3-2 桌', observedAt: 1 })

// Report: this chat, Nov19 — a missing separator is a suggestion, not table-selection consent.
it('suggests only omitted-separator split codes and preserves exact table precedence', () => {
  expect(approximateTables('我要A31', entry().tableChoices)).toEqual(['A3-1 桌'])
  expect(approximateTables('A32開始點餐', entry().tableChoices)).toEqual(['A3-2 桌'])
  expect(approximateTables('A三十二', entry().tableChoices)).toEqual(['A3-2 桌'])
  expect(approximateTables('A31', [...entry().tableChoices, 'A31 桌'])).toEqual([])
  expect(approximateTables('A31', [...entry().tableChoices, 'A31 桌', 'A031 桌'])).toEqual([])
  expect(approximateTables('A3之一', entry().tableChoices)).toEqual([])
  expect(approximateTables('A3之二', entry().tableChoices)).toEqual([])
  expect(approximateTables('A3', entry().tableChoices)).toEqual([])
  expect(approximateTables('A99', entry().tableChoices)).toEqual([])
  expect(approximateTables('不是A31', entry().tableChoices)).toEqual([])
  expect(approximateTables('A31或A32', entry().tableChoices)).toEqual([])
  expect(approximateTables('A31我要水餃', entry().tableChoices)).toEqual([])
})

it('requires a fresh one-use answer and ignores changing observation timestamps', () => {
  const tables = createTableSelection({ owner: () => 'visitor', documentId: () => 'table-document' })
  const raw = entry()
  const question = tables.offer(raw, 'A31')!
  expect(question.purpose).toBe('browser-table-confirmation')
  expect(tables.pending({ ...raw, observedAt: 2 })).toEqual(question)
  expect(tables.answer(raw, '對，還要兩份水餃')).toBeUndefined()
  expect(tables.hasPending()).toBe(true)
  expect(tables.answer(raw, '就是那一桌')).toEqual({ name: 'A3-1 桌' })
  expect(tables.answer(raw, '對')).toBeUndefined()
  expect(tables.hasPending()).toBe(false)
})

it.each(['visitor', 'document', 'selection', 'choices', 'route', 'expiry', 'reset'] as const)('revokes a previous confirmation after %s changes', (change) => {
  let owner = 'visitor'
  let documentId = 'table-document'
  let now = 1
  const raw = entry()
  const tables = createTableSelection({ owner: () => owner, documentId: () => documentId }, () => now)
  const question = tables.offer(raw, 'A31')!
  if (change === 'visitor')
    owner = 'next-visitor'
  if (change === 'document')
    documentId = 'replacement-document'
  if (change === 'selection')
    raw.selectedTable = 'A3-1 桌'
  if (change === 'choices')
    raw.tableChoices.reverse()
  if (change === 'route')
    raw.page = 'menu'
  if (change === 'expiry')
    now = question.expiresAt
  if (change === 'reset')
    tables.reset()
  expect(tables.answer(raw, '對', { questionId: question.questionId, choiceId: 'yes' })).toBeUndefined()
  expect(tables.hasPending()).toBe(false)
})

it('asks between colliding split codes and never treats a bare yes as a unique choice', () => {
  const raw = { page: 'table', tableChoices: ['A3-12 桌', 'A31-2 桌'] }
  const tables = createTableSelection({ owner: () => 'visitor', documentId: () => 'table-document' })
  const question = tables.offer(raw, 'A312')!
  expect(question.question).toContain('A3-12 桌、A31-2 桌')
  expect(question.choices.map(choice => choice.id)).toEqual(['table:0', 'table:1', 'no'])
  expect(tables.answer(raw, '對')).toBeUndefined()
  expect(tables.answer(raw, '第二個')).toEqual({ name: 'A31-2 桌' })
})

it('accepts only the issued Jev question and choice and supports declining without a table', () => {
  const raw = entry()
  const tables = createTableSelection({ owner: () => 'visitor', documentId: () => 'table-document' })
  const question = tables.offer(raw, 'A31')!
  expect(tables.answer(raw, '就是那桌', { questionId: 'old', choiceId: 'yes' })).toBeUndefined()
  expect(tables.answer(raw, '就是那桌', { questionId: question.questionId, choiceId: 'table:0' })).toBeUndefined()
  expect(tables.answer(raw, '不是')).toEqual({ declined: true })
  expect(tables.hasPending()).toBe(false)
  const next = tables.offer(raw, 'A32')!
  expect(tables.answer(raw, '就是那桌', { questionId: next.questionId, choiceId: 'yes' })).toEqual({ name: 'A3-2 桌' })
})
