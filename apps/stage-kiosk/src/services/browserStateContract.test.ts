import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { beginBrowserCartTask, executeBrowserCartTool, readBrowserConversation, readBrowserOrderingFacts } from './browserCartTask'
import { createBrowserFastPathSource } from './browserFastPath'

const tools: ServiceTool[] = ['browser_state_get', 'browser_cart_get', 'browser_cart_review', 'browser_cart_add', 'browser_cart_quantity', 'browser_return_menu'].map(name => ({ name, description: name, origin: 'https://app.esgpb.com', inputSchema: { type: 'object' } }))
const releases: Array<() => void> = []
afterEach(() => releases.splice(0).forEach(release => release()))

function facts() {
  return {
    ok: true,
    source: 'browser',
    page: 'menu',
    cart: { version: 'cart-current', lines: [{ ref: 'line', productRef: 'p-1', name: '雞腿飯', quantity: 3 }] },
    products: [{ ref: 'p-1', name: '雞腿飯', price: 80, kind: 'product', priceType: 1, configurations: [{ version: 'configuration-current', variantRef: '', name: '標準', unitPrice: 80, groups: [] }] }],
  }
}

// Report: this chat, 2026-11-23. Missing receipt fields were accepted by some
// planners; in particular cart.lines defaulted to [], hiding existing rows.
// These mutations must fail before any candidate or operation can be issued.
const invalidStates = [
  ['missing-source', { source: undefined }],
  ['wrong-source', { source: 'host' }],
  ['missing-success', { ok: undefined }],
  ['missing-page', { page: undefined }],
  ['unknown-page', { page: 'unknown' }],
  ['missing-cart', { cart: undefined }],
  ['missing-version', { cart: { lines: [] } }],
  ['empty-version', { cart: { version: '', lines: [] } }],
  ['missing-lines', { cart: { version: 'cart-current' } }],
  ['blank-version', { cart: { version: '   ', lines: [] } }],
  ['missing-row-reference', { cart: { version: 'cart-current', lines: [{ name: '雞腿飯', quantity: 3 }] } }],
  ['invalid-row-quantity', { cart: { version: 'cart-current', lines: [{ ref: 'line', name: '雞腿飯', quantity: 0 }] } }],
  ['fractional-row-quantity', { cart: { version: 'cart-current', lines: [{ ref: 'line', name: '雞腿飯', quantity: 1.5 }] } }],
] as const

it.each(invalidStates)('rejects %s consistently before navigation, purchase and quantity planning', async (_name, patch) => {
  for (const transcript of ['看購物車', '我要雞腿飯兩份', '雞腿飯改成兩份']) {
    const execute = vi.fn(async () => ({}))
    const source = createBrowserFastPathSource({ tools, read: async () => ({ ...facts(), ...patch }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
    expect(await source.context({ transcript })).toHaveProperty('contextError')
    expect(execute).not.toHaveBeenCalled()
    expect(await source.execute({ candidateId: 'intent:add-item' })).toMatchObject({ ok: false, effect: 'none' })
    expect(execute).not.toHaveBeenCalled()
  }
})

it.each(invalidStates)('rejects %s before Main receives ordering facts', async (_name, patch) => {
  releases.push(beginBrowserCartTask('雞腿飯改成兩份', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main' }) }))
  const execute = vi.fn(async () => ({ ...facts(), ...patch }))
  await expect(readBrowserOrderingFacts({ tools: readonly(shallowRef(tools)), execute })).rejects.toThrow()
  expect(execute).toHaveBeenCalledOnce()
})

it('keeps catalog-free navigation valid without manufacturing an empty menu', async () => {
  const execute = vi.fn(async () => ({ ok: true }))
  const { products: _products, ...state } = facts()
  const read = vi.fn(async () => state)
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  expect(await source.context({ transcript: '看購物車' })).toMatchObject({ candidates: [{ id: 'intent:view-cart' }] })
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_state_get' }), { includeCatalog: false })
  expect(execute).not.toHaveBeenCalled()
})

it('does not let a pending answer bypass invalid cart facts', async () => {
  const question = { questionId: 'current-question', purpose: 'browser-confirm-add', question: '要加入嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'yes', description: '確認加入' }] }
  const source = createBrowserFastPathSource({ tools, read: async () => ({ ...facts(), cart: { version: 'cart-current' } }), execute: vi.fn(), hasPendingQuestion: () => true, pendingQuestion: () => question })
  expect(await source.context({ transcript: '好' })).toHaveProperty('contextError')
})

// Report: this chat, 2026-11-23. Main writes must not bypass the read contract.
it.each(invalidStates)('blocks Main writes and conversation context with %s', async (_name, patch) => {
  releases.push(beginBrowserCartTask('雞腿飯改成兩份', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }) }))
  const execute = vi.fn(async () => ({ ...facts(), ...patch }))
  const client = { tools: readonly(shallowRef(tools)), execute }
  await expect(executeBrowserCartTool(client, tools.find(tool => tool.name === 'browser_cart_quantity')!, { version: 'cart-current', lineRef: 'line', quantity: 2 })).rejects.toThrow()
  expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'browser_cart_get' }), { includeCatalog: false })
  execute.mockClear()
  await expect(readBrowserConversation(client, 'current-task', ['list_cart_items'])).rejects.toThrow()
  expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'browser_state_get' }), { includeCatalog: true })
})

it.each([
  { products: undefined },
  { products: [{ ...facts().products[0], configurations: undefined }] },
])('rejects missing full-catalog data without presenting it as an empty menu: %j', async (patch) => {
  releases.push(beginBrowserCartTask('雞腿飯兩份', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main' }) }))
  const execute = vi.fn(async () => ({ ...facts(), ...patch }))
  await expect(readBrowserOrderingFacts({ tools: readonly(shallowRef(tools)), execute })).rejects.toThrow()
  expect(execute).toHaveBeenCalledOnce()
})

it('revokes an earlier candidate when the next observation is incomplete', async () => {
  let raw: unknown = facts()
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools, read: async () => raw, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  expect(await source.context({ transcript: '雞腿飯改成兩份' })).toHaveProperty('candidates')
  raw = { ...facts(), cart: { version: 'cart-current' }, search: '雞腿飯' }
  expect(await source.context({ transcript: '取消搜尋' })).toHaveProperty('contextError')
  expect(await source.execute({ candidateId: 'intent:set-quantity' })).toMatchObject({ ok: false, effect: 'none' })
  expect(execute).not.toHaveBeenCalled()
})

it.each(invalidStates)('rejects incomplete navigation receipts with %s before reporting cart contents', async (_name, patch) => {
  releases.push(beginBrowserCartTask('看購物車', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main' }) }))
  const execute = vi.fn(async () => ({ ...facts(), ...patch }))
  await expect(executeBrowserCartTool({ tools: readonly(shallowRef(tools)), execute }, tools.find(tool => tool.name === 'browser_cart_review')!, {})).rejects.toThrow()
  expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'browser_cart_review' }), {})
})
