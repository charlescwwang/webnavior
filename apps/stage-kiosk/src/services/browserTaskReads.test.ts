import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { beginBrowserCartTask, executeBrowserCartTool, readBrowserConversation, readBrowserOrderingFacts } from './browserCartTask'

const releases: Array<() => void> = []
afterEach(() => releases.splice(0).forEach(release => release()))
function setup() {
  const tools = shallowRef<ServiceTool[]>(['browser_state_get', 'browser_cart_get', 'browser_cart_quantity', 'browser_cart_review'].map(name => ({ name, description: name, origin: 'https://app.esgpb.com', inputSchema: { type: 'object' } })))
  const facts = { ok: true, source: 'browser', page: 'menu', documentId: 'document', observedAt: 1, cart: { version: 'before', subtotal: 240, lines: [{ ref: 'line', productRef: 'p-1', name: '雞腿飯', quantity: 3, unitPrice: 80, configuration: 'plain', note: '' }] }, products: [{ ref: 'p-1', name: '雞腿飯', price: 80, configurations: [{ version: 'config', variantRef: '', name: '標準', unitPrice: 80, groups: [] }] }] }
  const execute = vi.fn(async (_tool: ServiceTool, _input: Record<string, unknown>): Promise<unknown> => structuredClone(facts))
  const client = { tools: readonly(tools), execute }
  const begin = () => releases.push(beginBrowserCartTask('雞腿飯改成兩份', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }) }))
  begin()
  return { client, tools, facts, execute, begin }
}

// Report: this chat, 2026-11-23. Agent-only operation: model preparation and
// tool planning read the same unchanged page independently before any effect.
it('shares an unchanged full snapshot across model rounds and tool planning', async () => {
  const { client, execute } = setup()
  await readBrowserConversation(client, 'task', ['list_cart_items'])
  await readBrowserOrderingFacts(client)
  await readBrowserConversation(client, 'task', ['list_cart_items'])
  expect(execute).toHaveBeenCalledTimes(1)
})

it('coalesces overlapping model and tool reads', async () => {
  const { client, execute } = setup()
  await Promise.all([readBrowserConversation(client, 'task', []), readBrowserOrderingFacts(client)])
  expect(execute).toHaveBeenCalledTimes(1)
})

it('updates the next model round from a complete verified cart receipt', async () => {
  const { client, execute, tools, facts } = setup()
  const cart = { ...facts.cart, version: 'after', subtotal: 160, lines: [{ ...facts.cart.lines[0], quantity: 2 }] }
  execute.mockImplementation(async tool => tool.name === 'browser_cart_quantity' ? { ok: true, status: 'verified', cart, customerMessage: '已調整' } : structuredClone(facts))
  await readBrowserConversation(client, 'task', [])
  expect(await executeBrowserCartTool(client, tools.value[2], { version: 'before', lineRef: 'line', quantity: 2 })).toMatchObject({ status: 'verified' })
  expect(await readBrowserConversation(client, 'task', [])).toMatchObject({ cart: { version: 'after', lines: [{ quantity: 2 }] } })
  expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_state_get', 'browser_cart_quantity'])
})

it('rereads after an uncertain write without replaying the write', async () => {
  const { client, execute, tools, facts } = setup()
  execute.mockImplementation(async tool => tool.name === 'browser_cart_quantity' ? { ok: false, status: 'unknown', effect: 'unknown' } : structuredClone(facts))
  await readBrowserConversation(client, 'task', [])
  await executeBrowserCartTool(client, tools.value[2], { version: 'before', lineRef: 'line', quantity: 2 })
  await readBrowserOrderingFacts(client)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_quantity')).toHaveLength(1)
  expect(execute.mock.calls.filter(([tool]) => ['browser_cart_get', 'browser_state_get'].includes(tool.name))).toHaveLength(2)
})

it('does not reuse a previous turn or replacement document snapshot', async () => {
  const { client, execute, begin, tools } = setup()
  await readBrowserConversation(client, 'task', [])
  begin()
  await readBrowserOrderingFacts(client)
  tools.value = tools.value.map(tool => ({ ...tool }))
  await readBrowserOrderingFacts(client)
  expect(execute).toHaveBeenCalledTimes(3)
})

it('never caches failed reads as usable state', async () => {
  const { client, execute, facts } = setup()
  execute.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(facts)
  await expect(readBrowserOrderingFacts(client)).rejects.toThrow()
  expect(await readBrowserOrderingFacts(client)).toHaveProperty('products')
  expect(execute).toHaveBeenCalledTimes(2)
})

// Report: this chat, 2026-11-23. Cache reuse must not weaken authentication
// handling when the native executor discovers expiry during an effect attempt.
it('preserves a sign-in refusal returned by the native write without replay', async () => {
  const { client, execute, tools, facts } = setup()
  execute.mockImplementation(async tool => tool.name === 'browser_cart_quantity'
    ? { ok: false, source: 'browser', status: 'rejected', effect: 'none', code: 'sign-in-required', error: 'PB requires manual sign-in.' }
    : structuredClone(facts))
  await readBrowserConversation(client, 'task', [])
  expect(await executeBrowserCartTool(client, tools.value[2], { version: 'before', lineRef: 'line', quantity: 2 })).toMatchObject({ code: 'sign-in-required', effect: 'none' })
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_quantity')).toHaveLength(1)
  await readBrowserOrderingFacts(client)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_get')).toHaveLength(1)
})

it('uses the navigation receipt for cart state while retaining the unchanged store catalog', async () => {
  const { client, execute, tools, facts } = setup()
  const { products: _products, ...cartPage } = { ...facts, page: 'cart', customerMessage: '雞腿飯三份' }
  execute.mockImplementation(async tool => tool.name === 'browser_cart_review' ? cartPage : { ...facts, page: 'cart' })
  await readBrowserConversation(client, 'task', [])
  expect(await executeBrowserCartTool(client, tools.value[3], {})).toMatchObject({ page: 'cart' })
  await readBrowserOrderingFacts(client)
  await readBrowserConversation(client, 'task', [])
  expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_state_get', 'browser_cart_review'])
})

it('does not reuse a verified receipt that lacks a complete cart', async () => {
  const { client, execute, tools, facts } = setup()
  execute.mockImplementation(async tool => tool.name === 'browser_cart_quantity' ? { ok: true, status: 'verified', cart: { version: 'after' } } : structuredClone(facts))
  await readBrowserConversation(client, 'task', [])
  await executeBrowserCartTool(client, tools.value[2], { version: 'before', lineRef: 'line', quantity: 2 })
  await readBrowserOrderingFacts(client)
  expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_state_get', 'browser_cart_quantity', 'browser_cart_get'])
})

it('keeps externally changing payment results live within the same turn', async () => {
  const { client, execute } = setup()
  const order = { reference: 'TEST-READS', status: 20, total: 240, paymentStatus: 'pending', paymentMethods: ['信用卡'], invoice: { method: 'none' } }
  execute.mockResolvedValueOnce({ ok: true, source: 'browser', page: 'payment', observedAt: 1, order })
  execute.mockResolvedValueOnce({ ok: true, source: 'browser', page: 'order-result', observedAt: 2, order: { ...order, paymentStatus: 'paid' } })
  expect(await readBrowserConversation(client, 'task', [])).toMatchObject({ page: 'payment' })
  expect(await readBrowserConversation(client, 'task', [])).toMatchObject({ page: 'order-result' })
  expect(execute).toHaveBeenCalledTimes(2)
})

it('rejects an in-flight read from a replaced document and reads the replacement', async () => {
  const { client, execute, tools, facts } = setup()
  let resolve!: (value: unknown) => void
  execute.mockImplementationOnce(() => new Promise(ready => resolve = ready))
  const pending = readBrowserOrderingFacts(client)
  tools.value = tools.value.map(tool => ({ ...tool }))
  resolve(facts)
  await expect(pending).rejects.toThrow()
  await readBrowserOrderingFacts(client)
  expect(execute).toHaveBeenCalledTimes(2)
})

it('uses observed checkout fields from a successful form receipt without rereading the catalog', async () => {
  const { client, execute, tools, facts } = setup()
  tools.value.push({ ...tools.value[0], name: 'browser_invoice_select' })
  const checkout = { methods: [{ method: 'none', label: '無載具', selected: true }], fields: [], missing: [], ready: true, orderNote: '' }
  execute.mockImplementation(async tool => tool.name === 'browser_invoice_select'
    ? { ok: true, source: 'browser', page: 'cart', cart: facts.cart, checkout }
    : structuredClone(facts))
  await readBrowserConversation(client, 'task', [])
  await executeBrowserCartTool(client, tools.value[4], { method: 'none' })
  expect(await readBrowserConversation(client, 'task', [])).toMatchObject({ page: 'cart', checkout, catalog: { complete: true } })
  expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_state_get', 'browser_invoice_select'])
})

it.each(['checkout', 'itemSelectionOpen'])('refreshes %s after a cart edit rather than retaining old form state', async (field) => {
  const { client, execute, tools, facts } = setup()
  const checkout = { methods: [], fields: [], missing: [], ready: true, orderNote: '', total: 240, confirmationToken: 'old-consent' }
  execute.mockImplementation(async tool => tool.name === 'browser_cart_quantity'
    ? { ok: true, status: 'verified', cart: { ...facts.cart, version: 'after', subtotal: 160, lines: [{ ...facts.cart.lines[0], quantity: 2 }] } }
    : { ...structuredClone(facts), ...(field === 'checkout' ? { checkout } : { itemSelectionOpen: true }) })
  await readBrowserConversation(client, 'task', [])
  await executeBrowserCartTool(client, tools.value[2], { version: 'before', lineRef: 'line', quantity: 2 })
  await readBrowserOrderingFacts(client)
  expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_state_get', 'browser_cart_quantity', 'browser_cart_get'])
})

it.each([true, false])('uses the initial editor read for retry evidence only when the document matches (%s)', async (matches) => {
  const { client, facts, execute } = setup()
  const recovery = { source: 'browser', documentId: matches ? facts.documentId : 'replaced', contextKey: 'before', canRetry: true, canReset: true }
  execute.mockResolvedValueOnce({ ...facts, recovery })
  const capture = vi.fn()
  await readBrowserConversation(client, 'task', [], capture)
  expect(capture).toHaveBeenCalledWith(matches ? JSON.stringify(['browser', facts.documentId, 'before']) : undefined)
  expect(execute).toHaveBeenCalledTimes(1)
})
