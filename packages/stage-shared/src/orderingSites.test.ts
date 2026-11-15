import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { labelCatalog, orderingSites, orderingSiteSchema, selectOrderingSite } from './orderingSites'

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

it('attaches configured discovery labels only to unique, exact current product names', () => {
  const labels = [{ name: '炸雞腿便當', aliases: ['雞腿飯', '雞腿'], category: '便當' }, { name: '已下架餐點', aliases: ['招牌'], category: '套餐' }]
  const products = [{ ref: 'p1', name: '炸雞腿便當', price: 130 }, { ref: 'p2', name: '雞肉飯', price: 60 }]
  const enriched = labelCatalog(products, labels)
  expect(enriched[0]).toMatchObject({ ref: 'p1', price: 130, aliases: ['雞腿飯', '雞腿'], category: '便當' })
  expect(enriched[1].aliases).toEqual([])
  expect(enriched.some(product => product.aliases.includes('招牌'))).toBe(false)
  expect(products[0]).not.toHaveProperty('aliases')
  expect(labelCatalog([...products, { ...products[0], ref: 'duplicate' }], labels).every(product => product.aliases.length === 0)).toBe(true)
})

it('keeps shared aliases ambiguous and validates labels with the published merchant', () => {
  const labels = [{ name: '炸雞腿便當', aliases: ['招牌'], category: '便當' }, { name: '炸排骨便當', aliases: ['招牌'], category: '便當' }]
  const site = parse(orderingSiteSchema, { ...first, catalogLabels: labels })
  expect(site.catalogLabels).toEqual(labels)
  expect(labelCatalog(labels.map((label, i) => ({ ref: `p${i}`, name: label.name })), labels).filter(product => product.aliases.includes('招牌'))).toHaveLength(2)
  expect(() => parse(orderingSiteSchema, { ...first, catalogLabels: [labels[0], labels[0]] })).toThrow()
  expect(parse(orderingSiteSchema, first)).toEqual(first)
})
