import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { createBrowserCartSession } from './browserCartSession'
import { beginBrowserCartTask, executeBrowserCartTool } from './browserCartTask'

const releases: Array<() => void> = []
afterEach(() => releases.splice(0).forEach(release => release()))

// Report: output/playwright/pb-electron/reception-fix-read-diagnostic-2.json.
it('preserves a failed PB context read without parsing it as an empty cart or leaking attached cart data', async () => {
  const setItem = vi.fn()
  const gate = createBrowserCartSession({ getItem: () => null, setItem })
  const context: ServiceTool = { name: 'browser_cart_get', origin: 'https://app.esgpb.com', description: '', inputSchema: { type: 'object' } }
  const raw = { ok: false, source: 'browser', status: 'rejected', customerMessage: 'PB context temporarily unavailable', cart: { lines: [{ name: '前位顧客餐點' }] } }
  const execute = vi.fn(async () => raw)
  const client = { tools: readonly(shallowRef([context])), execute }
  releases.push(beginBrowserCartTask('介紹菜單', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main' }), cartSession: { gate, owner: () => 'new-visitor', serviceUrl: () => 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu', message: '需要交接' } }))
  const result = await executeBrowserCartTool(client, context, { includeCatalog: true })
  expect(result).toMatchObject({ ok: false, status: 'rejected', customerMessage: 'PB context temporarily unavailable' })
  expect(result).not.toHaveProperty('cart')
  expect(setItem).not.toHaveBeenCalled()
})

it('redacts an unowned cart from Agent reads and blocks writes before any vendor mutation', async () => {
  const records = new Map<string, string>()
  const gate = createBrowserCartSession({ getItem: key => records.get(key) ?? null, setItem: (key, value) => {
    records.set(key, value)
  } })
  const context: ServiceTool = { name: 'browser_cart_get', origin: 'https://app.esgpb.com', description: '', inputSchema: { type: 'object' } }
  const add = { ...context, name: 'browser_cart_add' }
  const raw = { ok: true, source: 'browser', cart: { version: 'old-cart', lines: [{ name: '前位顧客餐點', note: '前位私人備註' }] }, products: [{ ref: 'current', name: '今日餐點' }] }
  const execute = vi.fn(async (_tool: ServiceTool) => raw)
  const client = { tools: readonly(shallowRef([context, add])), execute }
  releases.push(beginBrowserCartTask('今日餐點一份', { decide: async () => ({ choice: 'ALLOW', provider: 'main' }), isCurrent: () => true, cartSession: { gate, message: '請由現場人員確認這筆餐點。', owner: () => 'new-visitor', serviceUrl: () => 'https://app.esgpb.com/order/store/test/pick_up/menu' } }))
  const result = await executeBrowserCartTool(client, context, { includeCatalog: true })
  expect(result).not.toHaveProperty('cart')
  expect(JSON.stringify(result)).not.toContain('前位')
  expect(result).toMatchObject({ customerBoundary: 'review-required', products: raw.products })
  expect(await executeBrowserCartTool(client, add, {})).toMatchObject({ status: 'clarification', effect: 'none' })
  expect(execute.mock.calls.every(([tool]) => tool.name === 'browser_cart_get')).toBe(true)
})

it('rechecks the captured visitor after semantic IO instead of borrowing a new visitor identity', async () => {
  const records = new Map<string, string>()
  const gate = createBrowserCartSession({ getItem: key => records.get(key) ?? null, setItem: (key, value) => {
    records.set(key, value)
  } })
  const context: ServiceTool = { name: 'browser_cart_get', origin: 'https://app.esgpb.com', description: '', inputSchema: { type: 'object' } }
  const add = { ...context, name: 'browser_cart_add' }
  const raw = { ok: true, source: 'browser', cart: { version: 'cart', lines: [] }, products: [{ ref: 'current', name: '今日餐點', configurations: [] }] }
  const serviceUrl = 'https://app.esgpb.com/order/store/test/pick_up/menu'
  let owner = 'first'
  const execute = vi.fn(async (_tool: ServiceTool) => raw)
  releases.push(beginBrowserCartTask('今日餐點一份', { isCurrent: () => true, decide: async () => {
    owner = 'next'
    return { choice: 'ALLOW', provider: 'main' }
  }, cartSession: { gate, message: '需要確認', owner: () => owner, serviceUrl: () => serviceUrl } }))
  expect(await executeBrowserCartTool({ tools: readonly(shallowRef([context, add])), execute }, add, { productRef: 'current' })).toMatchObject({ status: 'rejected' })
  expect(execute).toHaveBeenCalledOnce()
})
