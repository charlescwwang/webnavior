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
  const { gate, records } = setup()
  const raw = { cart: { version: 'cart', lines: [{}] } }
  gate.resume('first', service, 'cart', raw)
  expect(gate.check('first', service.replace('/test/', '/other/'), raw)).toBe(false)
  for (const key of records.keys()) records.set(key, '{broken')
  expect(gate.check('first', service, raw)).toBe(false)
})

it('does not admit an empty cart if its ownership cannot be persisted', () => {
  const gate = createBrowserCartSession({ getItem: () => null, setItem: () => {
    throw new Error('storage unavailable')
  } })
  expect(() => gate.check('first', service, { cart: { version: 'empty', lines: [] } })).toThrow('storage unavailable')
  expect(gate.owns('first', service)).toBe(false)
})
