import { expect, it } from 'vitest'

import { createBrowserCartSession } from './browserCartSession'

const service = 'https://app.esgpb.com/order/store/test/pick_up/menu'
function setup() {
  const records = new Map<string, string>()
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => {
    records.set(key, value)
  } }
  return { records, storage, gate: createBrowserCartSession(storage) }
}

it('does not inherit or erase a nonempty cart when the visitor is unknown or changed', () => {
  const { gate, records } = setup()
  const cart = { cart: { version: 'before', lines: [{ name: '原客餐點', note: '私密備註' }] } }
  expect(gate.check('first', service, cart)).toBe(false)
  expect(records.size).toBe(0)
  gate.resume('first', service, 'before', cart)
  expect(gate.check('first', service, cart)).toBe(true)
  expect(gate.check('next', service, cart)).toBe(false)
  expect(gate.blocked.value).toBe(true)
  expect(JSON.stringify([...records])).not.toContain('私密備註')
  expect(cart.cart.lines).toHaveLength(1)
})

it('automatically admits an actually empty cart and retains the boundary across Host reloads', () => {
  const { gate, storage } = setup()
  expect(gate.check('first', service, { cart: { version: 'empty', lines: [] } })).toBe(true)
  const nonempty = { cart: { version: 'added', lines: [{}] } }
  expect(createBrowserCartSession(storage).check('next', service, nonempty)).toBe(false)
  expect(gate.check('next', service, { cart: { version: 'cleared', lines: [] } })).toBe(true)
  expect(createBrowserCartSession(storage).check('next', service, nonempty)).toBe(true)
})

it('does not let pickup-query changes or screen resets bypass the previous visitor boundary', () => {
  const { gate } = setup()
  const raw = { cart: { version: 'cart', lines: [{}] } }
  gate.resume('first', service, 'cart', raw)
  gate.resetView()
  expect(gate.check('next', `${service}?pickUpDate=tomorrow`, raw)).toBe(false)
  expect(() => gate.resume('next', service, 'stale', raw)).toThrow('CART_REVIEW_CHANGED')
  expect(gate.owns('next', service)).toBe(false)
})

it('keeps each service isolated and refuses corrupt persisted ownership', () => {
  const { gate, records, storage } = setup()
  const raw = { cart: { version: 'cart', lines: [{}] } }
  gate.resume('first', service, 'cart', raw)
  expect(gate.check('first', service.replace('/test/', '/other/'), raw)).toBe(false)
  for (const key of records.keys()) records.set(key, '{broken')
  expect(createBrowserCartSession(storage).check('first', service, raw)).toBe(false)
})

it('does not admit an empty cart if its ownership cannot be persisted', () => {
  const gate = createBrowserCartSession({ getItem: () => null, setItem: () => {
    throw new Error('storage unavailable')
  } })
  expect(() => gate.check('first', service, { cart: { version: 'empty', lines: [] } })).toThrow('storage unavailable')
  expect(gate.owns('first', service)).toBe(false)
})

it('retains the same visitor boundary across the guest table/menu/cart journey', () => {
  const { gate } = setup()
  const entry = 'https://app-205-rd.esgpb.com/order/store/1kAMNok/internal_use/menu/select-table'
  expect(gate.check('first', entry, { cart: { version: 'empty', lines: [] } })).toBe(true)
  const cart = { cart: { version: 'one', lines: [{ name: '蛋花湯' }] } }
  expect(gate.check('first', entry.replace('/menu/select-table', '/orders/create'), cart)).toBe(true)
  expect(gate.check('next', entry.replace('/select-table', ''), cart)).toBe(false)
  expect(gate.check('first', 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu', cart)).toBe(false)
})

it('retains existing old-site menu ownership when normalizing journey pages', () => {
  const { records, gate } = setup()
  const menu = 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu'
  records.set(`webnavior:browser-cart-owner:${menu}`, JSON.stringify({ owner: 'existing' }))
  expect(gate.owns('existing', menu)).toBe(true)
  expect(gate.check('existing', menu.replace('/menu', '/orders/create'), { cart: { version: 'existing-cart', lines: [{}] } })).toBe(true)
  expect(gate.owns('next', menu)).toBe(false)
})

// Report: this chat, Nov13; active ordering must not be blocked by changed local persistence.
it('keeps an admitted visitor ordering when persisted ownership disappears mid-session', () => {
  const { gate, records } = setup()
  expect(gate.check('current', service, { cart: { version: 'empty', lines: [] } })).toBe(true)
  records.clear()
  expect(gate.owns('current', service)).toBe(true)
  expect(gate.check('current', service, { cart: { version: 'added', lines: [{}] } })).toBe(true)
  expect(gate.blocked.value).toBe(false)
  expect(gate.check('next', service, { cart: { version: 'added', lines: [{}] } })).toBe(false)
})

it('prepares admission before opening a fresh menu and rejects a late old-document result', async () => {
  const { gate } = setup()
  const read = async () => ({ ok: true, cart: { version: 'empty', lines: [] } })
  expect(await gate.prepare('current', service, read, () => true)).toBe('ready')
  expect(gate.owns('current', service)).toBe(true)
  expect(await gate.prepare('next', service, async () => ({ ok: true, cart: { version: 'old', lines: [{}] } }), () => true)).toBe('blocked')
  expect(gate.owns('next', service)).toBe(false)
  expect(await gate.prepare('late', service, read, () => false)).toBe('stale')
  expect(gate.owns('late', service)).toBe(false)
})
it('does not infer an empty cart from table entry or a failed lookup', async () => {
  const { gate } = setup()
  await expect(gate.prepare('current', service, async () => ({ ok: true, page: 'table' }), () => true)).rejects.toThrow()
  expect(gate.owns('current', service)).toBe(false)
  await expect(gate.prepare('current', service, async () => ({ ok: false }), () => true)).rejects.toThrow()
  expect(gate.owns('current', service)).toBe(false)
})

// Report: this chat, Nov15 — actual PB rejects cart reads before the first table entry.
it('allows only table entry while cart admission is deferred and still blocks an old cart afterwards', async () => {
  const { gate } = setup()
  const entry = 'https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table'
  const deferred = { ok: true, page: 'table', cartAdmission: 'after-table-entry' }
  expect(await gate.prepare('current', entry, async () => deferred, () => true)).toBe('table-only')
  expect(gate.owns('current', entry)).toBe(false)
  expect(await gate.prepare('current', entry, async () => ({ ok: true, cart: { version: 'old', lines: [{}] } }), () => true)).toBe('blocked')
  expect(gate.owns('current', entry)).toBe(false)
  await expect(gate.prepare('current', entry, async () => ({ ...deferred, page: 'menu' }), () => true)).rejects.toThrow()
})

// Report: this chat, Nov15; Start revealed a blank area because cart admission ran only after entry.
it('checks a fresh Host-only table cart before exposing Start and retains that reception on the menu', async () => {
  const { gate } = setup()
  const entry = 'https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table'
  const occupied = { ok: true, page: 'table', cart: { version: 'old', lines: [{ name: '原客餐點' }] } }
  expect(await gate.prepare('current', entry, async () => occupied, () => true)).toBe('blocked')
  expect(gate.owns('current', entry)).toBe(false)
  expect(await gate.prepare('current', entry, async () => ({ ...occupied, cart: { version: 'empty', lines: [] } }), () => true)).toBe('ready')
  expect(gate.check('current', entry.replace('/select-table', ''), occupied)).toBe(true)
  expect(gate.blocked.value).toBe(false)
})
