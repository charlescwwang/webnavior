import { expect, it } from 'vitest'

import { productMentions } from './productDiscovery'

const a = { name: 'A套餐', aliases: [] }
const b = { name: 'B 套餐', aliases: ['套餐'] }

// Report: this chat; the B alias 套餐 hid the explicit A套餐 fast-path target.
it('suppresses an alias contained inside a more specific spoken label', () => {
  expect(productMentions([a, b], '看A套餐')).toEqual([{ product: a, label: 'A套餐' }])
})

it('keeps separately mentioned dishes regardless of label length', () => {
  expect(productMentions([a, b], 'A套餐跟B 套餐各一份')).toEqual([{ product: a, label: 'A套餐' }, { product: b, label: 'B 套餐' }])
})

it('retains a later independent occurrence of the shorter alias', () => {
  expect(productMentions([a, b], 'A套餐，還有套餐')).toEqual([{ product: a, label: 'A套餐' }, { product: b, label: '套餐' }])
})

it('does not guess between products sharing the same alias', () => {
  const other = { name: 'C套餐', aliases: ['套餐'] }
  expect(productMentions([b, other], '有什麼套餐')).toEqual([{ product: b, label: '套餐' }, { product: other, label: '套餐' }])
})
