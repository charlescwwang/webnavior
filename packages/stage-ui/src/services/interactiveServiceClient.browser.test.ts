import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { readInteractionLifecycle } from '@proj-airi/stage-shared/interaction-lifecycle'
import { discoverService, executeServiceTool, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'
import { afterEach, expect, it } from 'vitest'
import { readonly } from 'vue'

import { createInteractiveServiceClient } from './interactiveServiceClient'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).reverse().forEach(cleanup => cleanup()))

// Report: this chat, 2026-10-26; recover a lost receipt without replaying its write.
it('blocks recovery while an accepted write is pending and reconnects the same cart only after it settles', async () => {
  const { client, tool } = await setup('?slow')
  const events: string[] = []
  client.onExecution(event => events.push(event.phase))
  await expect(client.execute(tool('order_add_item'), { itemId: 'dish-0', quantity: 1 }, AbortSignal.timeout(30))).rejects.toBeDefined()
  expect(client.availability.value).toBe('unavailable')
  await expect(client.recover()).rejects.toBeDefined()
  expect(client.tools.value).toEqual([])
  await new Promise(resolve => setTimeout(resolve, 400))
  await client.recover()
  expect(client.availability.value).toBe('ready')
  expect(events).toEqual(['called', 'failed'])
  const cart = client.tools.value.find(candidate => candidate.name === 'cart_get')!
  expect(await client.execute(cart, { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dish-0', quantity: 1 }] } })
})

it('refuses to recover an uncertain operation into a replacement document', async () => {
  const { client, frame, url, tool } = await setup('?slow')
  await expect(client.execute(tool('order_add_item'), { itemId: 'dish-0', quantity: 1 }, AbortSignal.timeout(30))).rejects.toBeDefined()
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }))
  frame.src = url.href
  await loaded
  await expect(client.recover()).rejects.toBeDefined()
  expect(client.availability.value).toBe('unavailable')
  expect(client.tools.value).toEqual([])
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md; first tool never returned.
it('keeps a never-settling presentation blocked across recovery attempts without replaying the action', async () => {
  const { client, frame, url, tool } = await setup('?hang')
  const actions: unknown[] = []
  const onMessage = (event: MessageEvent) => {
    if (event.source === frame.contentWindow && event.origin === url.origin && event.data?.source === 'menu-test-action')
      actions.push(event.data.action)
  }
  window.addEventListener('message', onMessage)
  cleanups.push(() => window.removeEventListener('message', onMessage))
  await expect(client.execute(tool('order_add_item'), { itemId: 'dish-0', quantity: 1 }, AbortSignal.timeout(100))).rejects.toBeDefined()
  expect(actions).toHaveLength(1)
  await expect(client.recover()).rejects.toBeDefined()
  await expect(client.recover()).rejects.toBeDefined()
  expect(client.availability.value).toBe('unavailable')
  expect(client.tools.value).toEqual([])
  expect(actions).toHaveLength(1)
})

it('recovers a definitive presentation refusal after a lost response while retaining an empty cart', async () => {
  const { client, tool } = await setup('?slow&reject-action')
  await expect(client.execute(tool('order_add_item'), { itemId: 'dish-0', quantity: 1 }, AbortSignal.timeout(30))).rejects.toBeDefined()
  await new Promise(resolve => setTimeout(resolve, 150))
  await client.recover()
  const cart = client.tools.value.find(candidate => candidate.name === 'cart_get')!
  expect(await client.execute(cart, { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

async function setup(query = '', fixture = 'menuFrame') {
  const url = new URL(`/src/services/fixtures/${fixture}.html${query}`, window.location.href)
  url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost'
  const frame = document.createElement('iframe')
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }))
  frame.src = url.href
  document.body.append(frame)
  cleanups.push(() => frame.remove())
  await loaded
  const client = createInteractiveServiceClient()
  cleanups.push(() => client.activate())
  client.activate(url.href, frame.contentWindow)
  await client.waitUntilReady()
  const tool = (name: string): ServiceTool => {
    const tool = client.tools.value.find(candidate => candidate.name === name)
    if (!tool)
      throw new Error(`Missing tool: ${name}`)
    return tool
  }
  const execute = (name: string, input: Record<string, unknown> = {}) => client.execute(tool(name), input)
  return { client, frame, url, execute, tool }
}

it('publishes one matching completion receipt and rejects malformed discovered tool schemas', async () => {
  const { client, execute } = await setup('', 'eventaProbe')
  const events: string[] = []
  client.onExecution(event => events.push(event.phase))
  expect(await execute('complete')).toMatchObject({ interaction: { status: 'completed' } })
  expect(events).toEqual(['called', 'resolved'])
  expect(client.completionRevision.value).toBe(1)
  await expect(setup('?malformed', 'eventaProbe')).rejects.toBeDefined()
})

// Report: this chat, 2026-10-20 — the replacement must retain the native JSON input/result boundary.
it('accepts JSON-compatible Vue inputs and preserves JSON receipt semantics', async () => {
  const { execute } = await setup()
  const state = await execute('kiosk_interaction_state')
  expect(state).toStrictEqual(JSON.parse(JSON.stringify(state)))
  const input = readonly({ itemId: 'dish-0', quantity: 1, omitted: undefined })
  expect(await execute('order_add_item', input)).toMatchObject({ cart: { itemCount: 1 } })
})

// Report: this chat, 2026-10-20 — preserve combined tools and multi-tool work when replacing native WebMCP.
it('preserves combined add, Main quantity-plus-add sequence, options and domain refusal under a strict script CSP', async () => {
  const { execute } = await setup()
  const first = await execute('order_add_item', { itemId: 'dish-0', quantity: 2 }) as { line: { id: string } }
  expect(first.line.id).toBeTypeOf('string')
  await execute('cart_set_line_quantity', { lineId: first.line.id, quantity: 1 })
  expect(await execute('order_add_item', { itemId: 'dish-1', quantity: 1, options: [{ groupId: 'spice', valueId: 'hot' }] })).toMatchObject({ cart: { itemCount: 2 } })
  expect(await execute('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: 'dish-0', quantity: 1 }, { itemId: 'dish-1', quantity: 1, options: { spice: 'hot' } }] } })
  expect(await execute('order_add_item', { itemId: 'missing', quantity: 1 })).toMatchObject({ ok: false, recovery: expect.any(String) })
  expect(await execute('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
})

it('preserves recommendation actions, batch history and current domain revisions', async () => {
  const { client, frame, url, execute } = await setup()
  expect(await execute('menu_recommend', { action: 'update', category: '便當', maxPrice: 120 })).toMatchObject({ items: [{ id: 'dish-0' }, { id: 'dish-1' }, { id: 'dish-2' }] })
  const before = await execute('kiosk_interaction_state')
  client.activate(url.href, frame.contentWindow)
  await client.waitUntilReady()
  expect(await execute('kiosk_interaction_state')).toEqual(before)
  expect(await execute('menu_recommend', { action: 'continue' })).toMatchObject({ items: [{ id: 'dish-3' }, { id: 'dish-4' }] })
  expect(await execute('menu_recommend', { action: 'clarify' })).toMatchObject({ queryAction: 'clarify', items: [] })
})

it('rejects malformed parameters and unavailable POS enum values before any cart mutation', async () => {
  const { execute } = await setup()
  for (const input of [{ itemId: 'dish-0', quantity: '2' }, { itemId: 'dish-0', quantity: 1.5 }, { itemId: 'dish-0', quantity: 0 }, { itemId: 'dish-0', extra: true }])
    expect(await execute('order_add_item', input)).toMatchObject({ ok: false, error: 'INVALID_TOOL_INPUT' })
  expect(await execute('menu_recommend', { action: 'update', category: 'invented' })).toMatchObject({ ok: false, error: 'INVALID_TOOL_INPUT' })
  expect(await execute('order_set_fulfillment', { mode: 'delivery' })).toMatchObject({ ok: false, error: 'INVALID_TOOL_INPUT' })
  expect(await execute('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('retains host task ownership, read-only authority and phone skip effects', async () => {
  const { execute } = await setup('?phone')
  expect(await execute('customer_skip_phone', { confirmedByUser: true })).toMatchObject({ customerMessage: '已略過手機登記，現在可以直接點餐。' })
  const state = await execute('kiosk_interaction_state') as { menuRevision: number }
  expect(await execute('kiosk_agent_task', { taskId: 'read-task', action: 'BEGIN', transcript: '有什麼便當', expectedMenuRevision: state.menuRevision, readOnly: true, constraints: {} })).toMatchObject({ ok: true })
  expect(await execute('kiosk_conversation_context')).toMatchObject({ taskId: 'read-task', readOnly: true, entryComplete: true, catalog: { complete: true, itemCount: 6 } })
  expect(await execute('order_add_item', { itemId: 'dish-0', quantity: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('not available in the current task context') })
  await execute('kiosk_agent_task', { taskId: 'next-task', action: 'BEGIN', transcript: '有什麼便當', expectedMenuRevision: state.menuRevision, readOnly: true, constraints: {} })
  await execute('kiosk_agent_task', { taskId: 'read-task', action: 'END' })
  expect(await execute('kiosk_conversation_context')).toMatchObject({ taskId: 'next-task', readOnly: true })
  expect(await execute('order_add_item', { itemId: 'dish-0', quantity: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('not available in the current task context') })
  await execute('kiosk_agent_task', { taskId: 'next-task', action: 'END' })
  expect(await execute('order_add_item', { itemId: 'dish-0', quantity: 1 })).toMatchObject({ cart: { itemCount: 1 } })
})

it('waits for a late Menu listener and revokes old descriptors after reconnecting', async () => {
  const { client, frame, url, tool } = await setup('?late')
  const old = tool('cart_get')
  client.activate(url.href, frame.contentWindow)
  await client.waitUntilReady()
  await expect(client.execute(old, { display: false })).rejects.toThrow('工具已失效')
  expect(await client.execute(tool('cart_get'), { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it.each(['origin', 'window'] as const)('ignores actual cross-frame replies with an incorrect expected %s', async (mismatch) => {
  const { frame, url } = await setup()
  const connection = createContext({ channel: interactiveServiceChannel, currentWindow: window, expectedOrigin: mismatch === 'origin' ? window.location.origin : url.origin, targetOrigin: url.origin, expectedSource: () => mismatch === 'window' ? window : frame.contentWindow, targetWindow: () => frame.contentWindow })
  cleanups.push(() => connection.dispose())
  await expect(defineInvoke(connection.context, discoverService)({ version: 1, connectionId: 'unaccepted-reply', challenge: 'ignored' }, { signal: AbortSignal.timeout(200) })).rejects.toBeDefined()
})

it.each(['parent-origin', 'menu-origin'] as const)('rejects a sibling iframe attempting an otherwise valid mutation from %s', async (sourceOrigin) => {
  const { client, frame, url } = await setup()
  client.activate()
  const connection = createContext({ channel: interactiveServiceChannel, currentWindow: window, expectedOrigin: url.origin, targetOrigin: url.origin, expectedSource: () => frame.contentWindow, targetWindow: () => frame.contentWindow })
  cleanups.push(() => connection.dispose())
  const binding = await defineInvoke(connection.context, discoverService)({ version: 1, challenge: 'source-test', connectionId: 'approved-parent' })
  const request = { connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: 'unapproved-write', name: 'order_add_item', input: { itemId: 'dish-0', quantity: 1 } }
  const actorUrl = new URL('/src/services/fixtures/sourceProbe.html', sourceOrigin === 'parent-origin' ? window.location.origin : url.origin)
  actorUrl.searchParams.set('request', JSON.stringify(request))
  actorUrl.searchParams.set('targetOrigin', url.origin)
  const actor = document.createElement('iframe')
  const finished = new Promise<void>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.source === actor.contentWindow && event.origin === actorUrl.origin && event.data?.source === 'source-probe-finished') {
        window.removeEventListener('message', listener)
        resolve()
      }
    }
    window.addEventListener('message', listener)
    cleanups.push(() => window.removeEventListener('message', listener))
  })
  actor.src = actorUrl.href
  document.body.append(actor)
  cleanups.push(() => actor.remove())
  await finished
  const cart = await defineInvoke(connection.context, executeServiceTool)({ ...request, operationId: 'approved-read', name: 'cart_get', input: { display: false } })
  expect(cart.result).toMatchObject({ cart: { itemCount: 0 } })
})

it('deduplicates in-flight operation IDs and rejects old binding/document IDs', async () => {
  const { client, frame, url } = await setup('?slow')
  client.activate()
  const connection = createContext({ channel: interactiveServiceChannel, currentWindow: window, expectedOrigin: url.origin, targetOrigin: url.origin, expectedSource: () => frame.contentWindow, targetWindow: () => frame.contentWindow })
  cleanups.push(() => connection.dispose())
  const discover = defineInvoke(connection.context, discoverService)
  const invoke = defineInvoke(connection.context, executeServiceTool)
  const binding = await discover({ version: 1, challenge: 'challenge', connectionId: 'binding-1' })
  const request = { connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: 'add-once', name: 'order_add_item', input: { itemId: 'dish-0', quantity: 1 } }
  const [first, second] = await Promise.all([invoke(request), invoke(request)])
  expect(second).toEqual(first)
  const cart = await invoke({ ...request, operationId: 'read-cart', name: 'cart_get', input: { display: false } })
  expect(cart.result).toMatchObject({ cart: { itemCount: 1 } })
  await expect(invoke({ ...request, input: { itemId: 'dish-0', quantity: 2 } })).rejects.toThrow('OPERATION_CONFLICT')
  await discover({ version: 1, challenge: 'new', connectionId: 'binding-2' })
  await expect(invoke({ ...request, operationId: 'old' })).rejects.toThrow('STALE_CONNECTION')
  await expect(invoke({ ...request, connectionId: 'binding-2', documentId: 'old-document' })).rejects.toThrow('STALE_CONNECTION')
})

it('settles an old call on deactivation and suppresses late execution notifications', async () => {
  const { client, frame, url, execute } = await setup('?slow')
  const events: string[] = []
  client.onExecution(event => events.push(event.phase))
  const entered = new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.contentWindow && event.origin === url.origin && event.data?.source === 'menu-test-action') {
        window.removeEventListener('message', onMessage)
        resolve()
      }
    }
    window.addEventListener('message', onMessage)
    cleanups.push(() => window.removeEventListener('message', onMessage))
  })
  const pending = expect(execute('order_add_item', { itemId: 'dish-0', quantity: 1 })).rejects.toBeDefined()
  await entered
  client.activate()
  await pending
  await new Promise(resolve => setTimeout(resolve, 500))
  expect(events).toEqual(['called'])
  expect(client.completionRevision.value).toBe(0)
  expect(client.tools.value).toEqual([])
})

it('preserves checkout/payment restrictions, accepted completion and a fresh document for the next order', async () => {
  const { client, frame, url, execute } = await setup()
  await execute('order_add_item', { itemId: 'dish-0', quantity: 1 })
  await execute('order_set_fulfillment', { mode: 'takeout' })
  expect(await execute('checkout_start', { confirmedByUser: true })).toMatchObject({ checkout: { stage: 'invoice' } })
  expect(await execute('checkout_choose_invoice', { method: 'donation' })).toMatchObject({ checkout: { stage: 'payment' } })
  expect(await execute('checkout_select_payment', { method: 'linepay' })).toMatchObject({ payment: { status: 'selected' } })
  expect(await execute('kiosk_interaction_state')).toMatchObject({ paymentState: 'pending' })
  frame.contentWindow!.postMessage({ source: 'menu-test-terminal', status: 'uncertain' }, url.origin)
  await expect.poll(() => execute('kiosk_interaction_state')).toMatchObject({ paymentState: 'uncertain' })
  expect(await execute('order_add_item', { itemId: 'dish-0', quantity: 1 })).toMatchObject({ ok: false })
  expect(await execute('checkout_cancel')).toMatchObject({ ok: false })
  const completed = new Promise<unknown>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== url.origin)
        return
      const message = readInteractionLifecycle(event.data)
      if (message?.type === 'completed') {
        window.removeEventListener('message', listener)
        resolve(message.orderResult)
      }
    }
    window.addEventListener('message', listener)
    cleanups.push(() => window.removeEventListener('message', listener))
  })
  frame.contentWindow!.postMessage({ source: 'menu-test-terminal', status: 'authorized' }, url.origin)
  expect(await completed).toMatchObject({ environment: 'test', status: 'accepted', itemCount: 1, fulfillmentMode: 'takeout' })
  client.activate()
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }))
  frame.src = url.href
  await loaded
  client.activate(url.href, frame.contentWindow)
  await client.waitUntilReady()
  expect(await execute('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})
