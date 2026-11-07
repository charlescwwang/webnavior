import { expect, it } from 'vitest'

import { cartConfiguration, describeConfiguration, prepareAddition, resolveSelection } from './pbProduct'

function attributes(required = false, amount = 1) {
  return { 加購: [{ id: 774, name: '白飯', attr_group: { id: 256, required, amount }, attr_item: { price: 5 }, pivot: {} }] }
}

const product = { productRef: 'p-today', variantRef: '', name: '每日新品', unitPrice: 10, scope: 'store/pickup-day/time' }

it('matches the observed PB paid option receipt, excluding row IDs and timestamps', async () => {
  const configuration = await describeConfiguration(product, attributes())
  const selected = resolveSelection(configuration, { version: configuration.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 1 }] }, '')
  expect(selected.unitPrice).toBe(15)
  expect(selected.configuration).toBe(cartConfiguration('', [{ id: 7564, item_type: 'product', item_id: 2503, parent_id: null, product_attrs: [{ id: 12969, attr_id: 774, amount: 1, unit_price: 5, created_at: 'vendor-time' }] }]))
})

it('requires explicit mandatory selections instead of accepting the vendor default', async () => {
  const configuration = await describeConfiguration(product, attributes(true))
  expect(() => resolveSelection(configuration, { version: configuration.version, variantRef: '', choices: [] }, '')).toThrow('必選')
  expect(resolveSelection(configuration, { version: configuration.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 1 }] }, '').unitPrice).toBe(15)
})

it('enforces group and per-option limits independently of serving quantity', async () => {
  const raw = attributes(true, 2)
  raw.加購.push({ ...raw.加購[0], id: 775, name: '配菜' })
  const configuration = await describeConfiguration(product, raw)
  expect(() => resolveSelection(configuration, { version: configuration.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 1 }] }, '')).toThrow('必選 2')
  expect(() => resolveSelection(configuration, { version: configuration.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 2 }, { ref: 'a-775', quantity: 1 }] }, '')).toThrow('必選 2')
  expect(resolveSelection(configuration, { version: configuration.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 1 }, { ref: 'a-775', quantity: 1 }] }, '').unitPrice).toBe(20)
})

it('invalidates daily product, pickup, price, label and required-option changes', async () => {
  const original = await describeConfiguration(product, attributes())
  const versions = [
    await describeConfiguration({ ...product, productRef: 'new-id' }, attributes()),
    await describeConfiguration({ ...product, scope: 'next-day' }, attributes()),
    await describeConfiguration({ ...product, unitPrice: 12 }, attributes()),
    await describeConfiguration({ ...product, name: '明日新品' }, attributes()),
    await describeConfiguration(product, attributes(true)),
  ]
  for (const current of versions) {
    expect(current.version).not.toBe(original.version)
    expect(() => resolveSelection(current, { version: original.version, variantRef: '', choices: [] }, '')).toThrow('已變更')
  }
})

it('discovers arbitrary daily option IDs and ignores administrative updates', async () => {
  const raw = { 自選: [{ id: 9823, name: '今日配菜', attr_group: { id: 873, required: false, amount: 1 }, attr_item: null, pivot: {}, updated_at: 'first' }] }
  const first = await describeConfiguration(product, raw)
  raw.自選[0].updated_at = 'second'
  expect((await describeConfiguration(product, raw)).version).toBe(first.version)
  expect(resolveSelection(first, { version: first.version, variantRef: '', choices: [{ ref: 'a-9823', quantity: 1 }] }, '少鹽').unitPrice).toBe(10)
  expect(() => resolveSelection(first, { version: first.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 1 }] }, '')).toThrow('不存在')
})

it('refuses duplicate selection IDs and retains variant identity in receipts', async () => {
  const configuration = await describeConfiguration({ ...product, variantRef: 'v-9' }, attributes())
  expect(() => resolveSelection(configuration, { version: configuration.version, variantRef: 'v-9', choices: [{ ref: 'a-774', quantity: 1 }, { ref: 'a-774', quantity: 1 }] }, '')).toThrow('重複')
  const selected = resolveSelection(configuration, { version: configuration.version, variantRef: 'v-9', choices: [] }, '')
  expect(selected.configuration).toBe(cartConfiguration('', [{ item_type: 'product_price', item_id: 9, parent_id: null, product_attrs: [] }]))
  expect(() => resolveSelection(configuration, { version: configuration.version, variantRef: '', choices: [] }, '')).toThrow('已變更')
})

// Report: this chat, 2026-10-30; a long-lived PB menu can retain yesterday's Vue product cache.
it('encodes the observed native fixed-product form without relying on a rendered card', async () => {
  const configuration = await describeConfiguration(product, attributes())
  const result = prepareAddition(configuration, { version: configuration.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 1 }] }, { productId: 99001, quantity: 2, note: '飯少' })
  expect(result.form).toEqual({ productGroupId: null, productId: 99001, priceId: null, attrs: { 256: { 774: 1 } }, subProductPrices: [], amount: 2, unit_price: 10, note: '飯少' })
  expect(result.unitPrice).toBe(15)
  expect(result.configuration).toBe(resolveSelection(configuration, { version: configuration.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 1 }] }, '飯少').configuration)
})

it('encodes required radios, optional zeros and arbitrary next-day group IDs', async () => {
  const raw = { 主食: [{ id: 88101, name: '明日主食', attr_group: { id: 91001, required: true, amount: 1 }, attr_item: null, pivot: {} }], 加購: [{ id: 88102, name: '明日加購', attr_group: { id: 91002, required: false, amount: 2 }, attr_item: { price: 7 }, pivot: {} }] }
  const configuration = await describeConfiguration({ ...product, scope: 'tomorrow', name: '新菜名', unitPrice: 33 }, raw)
  const result = prepareAddition(configuration, { version: configuration.version, variantRef: '', choices: [{ ref: 'a-88101', quantity: 1 }] }, { productId: 88100, quantity: 1, note: '' })
  expect(result.form.attrs).toEqual({ 91001: 88101, 91002: { 88102: 0 } })
  expect(result.form.unit_price).toBe(33)
  expect(result.unitPrice).toBe(33)
  expect(() => prepareAddition(configuration, { version: configuration.version, variantRef: '', choices: [] }, { productId: 88100, quantity: 1, note: '' })).toThrow('必選')
  expect(() => prepareAddition(configuration, { version: 'yesterday', variantRef: '', choices: [{ ref: 'a-88101', quantity: 1 }] }, { productId: 88100, quantity: 1, note: '' })).toThrow('已變更')
})
