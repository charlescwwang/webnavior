import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { createBrowserCartSession } from './browserCartSession'
import { beginBrowserCartTask, executeBrowserCartTool, executeBrowserReply } from './browserCartTask'

const releases: Array<() => void> = []
afterEach(() => releases.splice(0).forEach(release => release()))

function replySetup() {
  const serviceUrl = 'https://app.esgpb.com/order/store/test/pick_up/menu'
  const records = new Map<string, string>()
  const gate = createBrowserCartSession({ getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) })
  gate.check('previous', serviceUrl, { cart: { version: 'empty-before', lines: [] } })
  gate.resetView()
  const raw = { ok: true, source: 'browser', cart: { version: 'unfinished', lines: [{ name: '上一筆餐點', quantity: 1, note: '私人備註' }] } }
  const context: ServiceTool = { name: 'browser_cart_get', origin: 'https://app.esgpb.com', description: '', inputSchema: { type: 'object' } }
  const review = { ...context, name: 'browser_cart_review' }
  const execute = vi.fn(async (_tool: ServiceTool): Promise<unknown> => raw)
  const informationUnavailable = vi.fn(() => '這項資訊我目前查不到，請現場人員幫您確認。')
  const checkoutGuidance = vi.fn((empty: boolean) => empty ? '購物車目前沒有餐點。' : '請核對購物車，再依畫面提示完成結帳；目前尚未送出訂單或付款。')
  let current = true
  let owner = 'new'
  releases.push(beginBrowserCartTask('幫我結帳', { isCurrent: () => current, decide: async () => ({ choice: 'ALLOW', provider: 'main' }), informationUnavailable, checkoutGuidance, cartSession: { gate, message: '購物車裡還留著未完成的餐點，需要請現場人員先確認。', owner: () => owner, serviceUrl: () => serviceUrl } }))
  return {
    gate,
    raw,
    context,
    review,
    execute,
    informationUnavailable,
    checkoutGuidance,
    client: { tools: readonly(shallowRef([context, review])), execute },
    serviceUrl,
    retire: () => { current = false },
    changeOwner: () => { owner = 'third' },
  }
}

// Report: this chat, Nov11; new-chat checkout skipped cart reads and used a menu-information fallback.
it.each(['acknowledgement', 'clarification', 'information-unavailable', 'checkout-guidance'])('checks the unfinished previous cart before a direct %s reply', async (kind) => {
  const { client, gate, raw, context, execute, informationUnavailable, checkoutGuidance, serviceUrl } = replySetup()
  expect(gate.blocked.value).toBe(false)
  const result = await executeBrowserReply(client, kind)
  expect(result).toMatchObject({ customerBoundary: 'review-required', effect: 'none', customerMessage: '購物車裡還留著未完成的餐點，需要請現場人員先確認。' })
  expect(JSON.stringify(result)).not.toContain('上一筆餐點')
  expect(JSON.stringify(result)).not.toContain('私人備註')
  expect(result).not.toHaveProperty('cart')
  expect(execute).toHaveBeenCalledExactlyOnceWith(context, { includeCatalog: false })
  expect(informationUnavailable).not.toHaveBeenCalled()
  expect(checkoutGuidance).not.toHaveBeenCalled()
  expect(gate.owns('new', serviceUrl)).toBe(false)
  expect(raw.cart.lines).toHaveLength(1)
})

it('rechecks a manually emptied cart instead of keeping a stale handoff block', async () => {
  const { client, gate, serviceUrl, execute, informationUnavailable } = replySetup()
  gate.check('new', serviceUrl, { cart: { version: 'old', lines: [{}] } })
  execute.mockResolvedValue({ ok: true, source: 'browser', cart: { version: 'cleared-by-staff', lines: [] } })
  expect(await executeBrowserReply(client, 'information-unavailable')).toMatchObject({ customerMessage: '這項資訊我目前查不到，請現場人員幫您確認。' })
  expect(informationUnavailable).toHaveBeenCalledOnce()
  expect(gate.blocked.value).toBe(false)
  expect(gate.owns('new', serviceUrl)).toBe(true)
})

it('keeps a fresh sign-in failure typed without pretending the cart is empty or requiring handoff', async () => {
  const { client, execute, gate, serviceUrl } = replySetup()
  const failure = { ok: false, source: 'browser', status: 'rejected', effect: 'none', code: 'sign-in-required', error: 'PB requires manual sign-in.' }
  execute.mockResolvedValue(failure)
  expect(await executeBrowserReply(client, 'information-unavailable')).toEqual(failure)
  expect(gate.owns('new', serviceUrl)).toBe(false)
})

it('discards a late read after the visitor turn has ended', async () => {
  const { client, execute, retire, gate, serviceUrl } = replySetup()
  execute.mockImplementation(async () => {
    retire()
    return { ok: true, source: 'browser', cart: { version: 'empty', lines: [] } }
  })
  expect(await executeBrowserReply(client, 'acknowledgement')).toMatchObject({ ok: false, status: 'rejected', effect: 'none' })
  expect(gate.owns('new', serviceUrl)).toBe(false)
})

it.each(['acknowledgement', 'checkout-guidance'])('does not borrow another visitor identity while reading for %s', async (kind) => {
  const { client, execute, changeOwner, gate, serviceUrl } = replySetup()
  execute.mockImplementation(async () => {
    changeOwner()
    return { ok: true, source: 'browser', cart: { version: 'empty', lines: [] } }
  })
  expect(await executeBrowserReply(client, kind)).toMatchObject({ ok: false, status: 'rejected', effect: 'none' })
  expect(gate.owns('third', serviceUrl)).toBe(false)
})

it.each([false, true])('gives manual checkout guidance only after reviewing this visitor cart (empty=%s)', async (empty) => {
  const { client, execute, gate, raw, serviceUrl, checkoutGuidance, review } = replySetup()
  const fresh = { ...raw, cart: { ...raw.cart, lines: empty ? [] : raw.cart.lines } }
  gate.resume('new', serviceUrl, raw.cart.version, raw)
  execute.mockResolvedValue(fresh)
  const result = await executeBrowserReply(client, 'checkout-guidance')
  expect(result).toMatchObject({ ok: true, source: 'browser', status: 'checkout-guidance', effect: 'none' })
  expect(checkoutGuidance).toHaveBeenCalledExactlyOnceWith(empty)
  expect(execute).toHaveBeenLastCalledWith(review, {})
  expect(execute.mock.calls.every(([tool]) => ['browser_cart_get', 'browser_cart_review'].includes(tool.name))).toBe(true)
})

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
