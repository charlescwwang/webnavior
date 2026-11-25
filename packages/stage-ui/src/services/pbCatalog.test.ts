import type { CatalogGateway } from './pbCatalog'

import { expect, it, vi } from 'vitest'

import { matchesPreparedConfiguration, readCatalog } from './pbCatalog'
import { resolveSelection } from './pbProduct'

function fixture(day: number) {
  const categories = Array.from({ length: 3 }, (_, index) => ({ id: 100 * day + index + 1, name: `當日分類${index}`, count: 0 }))
  const items = Array.from({ length: 7 }, (_, index) => ({ id: 1000 * day + index + 1, name: `第${day}日餐點${index}`, price: 21 + day + index, price_type: 1 }))
  const responses = new Map(categories.map((category, index) => {
    const products = items.filter((_, position) => position % categories.length === index)
    category.count = products.length
    return [category.id, { products, productGroups: [] as { id: number, name: string, price: number }[] }]
  }))
  return { menu: { menuCategories: categories, defaultPickUpDate: `2026-11-0${day + 1}`, defaultPickUpTime: '11:30' }, responses }
}

// 11:28 lunch regression: the priced meal is already prepared when the clock advances.
it.each(['same', 'price', 'missing', 'fixed', 'options'])('rechecks the meal at the add button across a default minute: %s', async (mode) => {
  const data = fixture(0)
  data.menu.defaultPickUpTime = '11:27'
  const gateway: CatalogGateway = { menu: async () => data.menu, category: async ({ categoryId }) => data.responses.get(categoryId), attributes: async () => ({}) }
  const product = (await readCatalog(gateway, { scope: 'store' })).products[0]
  data.menu.defaultPickUpTime = '11:28'
  if (mode === 'price')
    data.responses.get(1)!.products[0].price++
  if (mode === 'options')
    gateway.attributes = async () => ({ 飯量: [{ id: 3, name: '小', attr_group: { id: 4, required: true, amount: 1 }, attr_item: null, pivot: {} }] })
  const latest = (await readCatalog(gateway, { scope: 'store' })).products[0]
  const before = { ...product.pickup, defaultPickupTime: mode === 'fixed' ? undefined : true as const, manualRevision: 0 }
  expect(product.configurations[0].version).not.toBe(latest.configurations[0].version)
  expect(matchesPreparedConfiguration(product, product.configurations[0], before, mode === 'missing' ? undefined : latest, { ...before, ...latest.pickup })).toBe(mode === 'same')
})

// Report: this chat, Nov14 full Host replay; detail reads lost a supplied combo description.
it('retains merchant descriptions while leaving null or absent descriptions unknown', async () => {
  const data = fixture(0)
  const category: CatalogGateway['category'] = async ({ categoryId }) => {
    const result = data.responses.get(categoryId)!
    return { ...result, products: result.products.map((item, index) => ({ ...item, description: index === 0 ? '水餃12顆 + 蛋花湯' : null })) }
  }
  const result = await readCatalog({ menu: async () => data.menu, category, attributes: async () => ({}) }, { scope: 'local-audit' })
  expect(result.products[0].description).toBe('水餃12顆 + 蛋花湯')
  expect(result.products[1]).not.toHaveProperty('description')
})

it('uses the same reader for entirely new daily names, IDs, categories and more than three products', async () => {
  let data = fixture(0)
  const category = vi.fn<CatalogGateway['category']>(async ({ categoryId }) => data.responses.get(categoryId))
  const gateway: CatalogGateway = { menu: async () => data.menu, category, attributes: async () => ({}) }
  const first = await readCatalog(gateway, { scope: 'approved-store' })
  expect(first.complete).toBe(true)
  expect(first.products).toHaveLength(7)
  expect(first.products[0]).toMatchObject({ ref: 'p-1', name: '第0日餐點0', price: 21 })
  data = fixture(1)
  const next = await readCatalog(gateway, { scope: 'approved-store' })
  expect(next.complete).toBe(true)
  expect(next.products).toHaveLength(7)
  expect(next.products.some(product => first.products.some(previous => previous.ref === product.ref))).toBe(false)
  expect(next.products[0]).toMatchObject({ ref: 'p-1001', name: '第1日餐點0', price: 22 })
  expect(category).toHaveBeenCalledWith({ categoryId: 101, date: '2026-11-02', time: '11:30' })
})

it('invalidates configurations after a pickup day, paid-price or mandatory-option change', async () => {
  const data = fixture(0)
  let attributes = { 加購: [{ id: 4, name: '當日配菜', attr_group: { id: 5, required: false, amount: 1 }, attr_item: { price: 3 }, pivot: {} }] }
  const gateway: CatalogGateway = { menu: async () => data.menu, category: async ({ categoryId }) => data.responses.get(categoryId), attributes: async () => attributes }
  const first = (await readCatalog(gateway, { scope: 'store', configurationRefs: ['p-1'] })).products[0].configurations[0]
  data.menu.defaultPickUpDate = '2026-11-02'
  attributes = { 加購: [{ ...attributes.加購[0], attr_group: { id: 5, required: true, amount: 1 }, attr_item: { price: 5 } }] }
  const next = (await readCatalog(gateway, { scope: 'store', configurationRefs: ['p-1'] })).products[0].configurations[0]
  expect(next.version).not.toBe(first.version)
  expect(() => resolveSelection(next, { version: first.version, variantRef: '', choices: [] }, '')).toThrow('已變更')
  expect(() => resolveSelection(next, { version: next.version, variantRef: '', choices: [] }, '')).toThrow('必選')
})

it('deduplicates the same SKU across categories without caching facts across reads', async () => {
  const product = { id: 3, name: '跨分類商品', price: 25, price_type: 1 }
  const attributes = vi.fn(async () => ({}))
  const gateway: CatalogGateway = { menu: async () => ({ menuCategories: [{ id: 1, name: '甲', count: 1 }, { id: 2, name: '乙', count: 1 }], defaultPickUpDate: '2026-11-01', defaultPickUpTime: '10:00' }), category: async () => ({ products: [product], productGroups: [] }), attributes }
  const first = await readCatalog(gateway, { scope: 'store' })
  expect(first.products).toHaveLength(1)
  expect(first.products[0].categoryIds).toEqual([1, 2])
  expect(attributes).toHaveBeenCalledTimes(1)
  await readCatalog(gateway, { scope: 'store' })
  expect(attributes).toHaveBeenCalledTimes(2)
})

it('retries a moving category count once and reports persistent partial loading explicitly', async () => {
  const data = fixture(0)
  data.menu.menuCategories[0].count++
  const menu = vi.fn(async () => data.menu)
  const result = await readCatalog({ menu, category: async ({ categoryId }) => data.responses.get(categoryId), attributes: async () => ({}) }, { scope: 'store' })
  expect(result.complete).toBe(false)
  expect(result.products).toHaveLength(7)
  expect(menu).toHaveBeenCalledTimes(2)
})

it('retains discovered product groups with distinct identities without inventing basic-product configurations', async () => {
  const gateway: CatalogGateway = { menu: async () => ({ menuCategories: [{ id: 1, name: '餐點', count: 2 }], defaultPickUpDate: '2026-11-01', defaultPickUpTime: '10:00' }), category: async () => ({ products: [{ id: 3, name: '單品', price: 25, price_type: 1 }], productGroups: [{ id: 3, name: '套餐', price: 60 }] }), attributes: async () => ({}) }
  const result = await readCatalog(gateway, { scope: 'store' })
  expect(result.complete).toBe(true)
  expect(result.products.map(product => product.ref)).toEqual(['p-3', 'pg-3'])
  expect(result.products[1].configurations).toEqual([])
  expect(result.products[1].kind).toBe('group')
})
