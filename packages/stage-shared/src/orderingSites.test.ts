import { expect, it } from 'vitest'

import { orderingSites, selectOrderingSite } from './orderingSites'

const first = { id: 'first', title: '原店家', url: 'https://menu.test/menu/', description: '' }
const second = { id: 'second', title: '新店家', url: 'https://menu.test/menu/supplier.html', description: '' }

it('keeps new merchants separate and selects only configured pages', () => {
  const profile = { interactiveService: first, orderingSites: [second] }
  expect(orderingSites(profile)).toEqual([first, second])
  expect(selectOrderingSite(profile)).toEqual(first)
  expect(selectOrderingSite(profile, 'second')).toEqual(second)
  expect(() => selectOrderingSite(profile, 'removed')).toThrow('no longer published')
  expect(() => orderingSites({ interactiveService: first, orderingSites: [first] })).toThrow('unique')
})
