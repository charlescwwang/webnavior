import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { readInteractionLifecycle } from '@proj-airi/stage-shared/interaction-lifecycle'
import { discoverService, executeServiceTool, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'
import { conversationContextSchema, decisionRevisionsSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { afterEach, expect, it } from 'vitest'
import { readonly } from 'vue'

import { ingredientDefinitions } from '../../../../apps/order-menu-server/src/domain/composition'
import { createMenuReplyWindow, questionReceiptFrom, replyFromConversation } from '../../../../apps/stage-kiosk/src/services/questionPresentation'
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

// Report: this chat Nov7/8 — food queries fail after BEGIN before Main/context projection.
it.each(['我想吃豬肉', '我要吃魚', '有虱目魚嗎'])('reads the real iframe context after starting an ingredient task: %s', async (transcript) => {
  const { execute, client } = await setup()
  const state = await execute('kiosk_interaction_state') as { menuRevision: number }
  await execute('kiosk_agent_task', { taskId: 'ingredient', action: 'BEGIN', transcript, expectedMenuRevision: state.menuRevision, readOnly: true, constraints: {} })
  expect(await execute('kiosk_conversation_context', { includeCatalog: true })).toMatchObject({ taskId: 'ingredient', readOnly: true, catalog: { complete: true } })
  expect(client.availability.value).toBe('ready')
  await execute('kiosk_agent_task', { taskId: 'ingredient', action: 'END' })
  expect(await execute('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

// Report: this chat, Nov8 — generalize the discovery invariant beyond three recorded utterances.
it.each([true, false])('keeps one iframe binding valid across ingredient and preparation task transitions (readOnly=%s)', async (readOnly) => {
  const { execute, client, tool } = await setup()
  const contextTool = tool('kiosk_conversation_context')
  const state = await execute('kiosk_interaction_state') as { menuRevision: number }
  await execute('menu_recommend', { action: 'update', category: '便當', limit: 1 })
  const utterances = [...new Set([
    ...ingredientDefinitions.flatMap(ingredient => ingredient.aliases.flatMap(alias => [`我想吃${alias}`, `不要${alias}`])),
    '不要雞肉，改推薦豬肉',
    '飯不要了，改看麵',
    '水餃兩份不要辣',
    '不用換了，照原本',
    '有沒有鴨肉',
    '我想要打拋牛便當',
    '我想先看看菜單',
  ])]
  for (const [index, transcript] of utterances.entries()) {
    const taskId = `generalized-${index}`
    await execute('kiosk_agent_task', { taskId, action: 'BEGIN', transcript, expectedMenuRevision: state.menuRevision, readOnly, constraints: {} })
    // Reuse the descriptor from original discovery. Rediscovering on every turn
    // would hide the exact revision mismatch under investigation.
    expect(await client.execute(contextTool, { includeCatalog: true }), transcript).toMatchObject({ taskId, readOnly, catalog: { complete: true, itemCount: 6 } })
    expect(client.availability.value, transcript).toBe('ready')
    if (readOnly)
      expect(await execute('order_add_item', { itemId: 'dish-0', quantity: 1 }), transcript).toMatchObject({ ok: false })
    await execute('kiosk_agent_task', { taskId, action: 'END' })
    expect(await client.execute(contextTool, { includeCatalog: true }), transcript).not.toHaveProperty('taskId')
    expect(await execute('cart_get', { display: false }), transcript).toMatchObject({ cart: { itemCount: 0 } })
  }
}, 30_000)

// Report: this chat Nov8 — missing subjects in the iframe schema rejected every qualified add before Main.
it('binds consecutive named requests through the iframe validator after returning to the menu', async () => {
  const { execute } = await setup()
  const state = await execute('kiosk_interaction_state') as { menuRevision: number }
  expect(await execute('menu_get', { query: '蝨目魚粥' })).toMatchObject({ pendingCustomerChoice: { purpose: 'menu-return-invitation' } })
  expect(await execute('menu_open')).toMatchObject({ pendingCustomerChoice: { purpose: 'recommendation-invitation' } })
  for (const [index, subject] of ['鱔魚意麵', '蝨目魚粥', '雞腿飯'].entries()) {
    const taskId = `named-${index}`
    expect(await execute('kiosk_agent_task', { taskId, action: 'BEGIN', transcript: `我想吃${subject}`, expectedMenuRevision: state.menuRevision, readOnly: false, constraints: {}, handoff: { intent: 'ADD_ONLY', subjects: [subject], status: 'ambiguous', itemIds: [], lineIds: [] } })).toMatchObject({ ok: true })
    expect(await execute('menu_get', { query: subject })).toMatchObject({ matchKind: 'none', requestedQueries: [subject] })
    expect(await execute('kiosk_conversation_context')).toMatchObject({ taskId, handoff: { intent: 'ADD_ONLY', subjects: [subject] } })
    expect(await execute('kiosk_agent_task', { taskId, action: 'END' })).toMatchObject({ ok: true })
  }
  expect(await execute('kiosk_agent_task', { taskId: 'available', action: 'BEGIN', transcript: '水餃一份', expectedMenuRevision: state.menuRevision, constraints: {}, handoff: { intent: 'ADD_ONLY', subjects: ['水餃'], status: 'ambiguous', itemIds: [], lineIds: [] } })).toMatchObject({ ok: true })
  expect(await execute('menu_get', { query: '水餃' })).toMatchObject({ items: [{ id: 'dish-0' }] })
  expect(await execute('kiosk_agent_task', { taskId: 'available', action: 'END' })).toMatchObject({ ok: true })
  expect(await execute('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

// Report: this chat Nov8 — returning to all dishes must retire the old recommendation's ambiguous scope.
it('applies new conditions to the full menu after recommendation and absent lookup navigation', async () => {
  const { execute } = await setup()
  await execute('menu_recommend', { action: 'update', maxPrice: 90 })
  await execute('menu_get', { query: '蝨目魚' })
  expect(await execute('menu_open')).toHaveProperty('pendingCustomerChoice.purpose', 'recommendation-invitation')
  const result = await execute('menu_recommend', { action: 'update', maxPrice: 130 })
  expect(result).not.toHaveProperty('pendingCustomerChoice.purpose', 'menu-query-scope')
  expect(result).toHaveProperty('items', expect.arrayContaining([expect.objectContaining({ id: 'dish-2' })]))
  expect(await execute('kiosk_fast_path_context', { transcript: '查看菜單' })).not.toHaveProperty('phase', 'query_scope')
  expect(await execute('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})

// Report: this chat Nov8 — every concrete quantity prompt must survive the real iframe boundary as a question.
it('continues a displayed meal inquiry with quantity and retires its question after adding', async () => {
  const { execute } = await setup()
  const receipt = await execute('menu_get', { query: '水餃' }) as { customerMessage: string, pendingCustomerChoice: { questionId: string, purpose: string } }
  expect(receipt.pendingCustomerChoice.purpose).toBe('item-order')
  expect(await execute('kiosk_interaction_state')).not.toHaveProperty('waitingFor')
  await execute('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice.questionId })
  expect(await execute('kiosk_fast_path_context', { transcript: '一份' })).toMatchObject({ waitingFor: { purpose: 'item-order' }, intentRecovery: { kind: 'answer', questionId: receipt.pendingCustomerChoice.questionId } })
  expect(await execute('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).not.toHaveProperty('ok', false)
  expect(await execute('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'dish-0', quantity: 1 }] } })
  expect(await execute('kiosk_interaction_state')).not.toHaveProperty('waitingFor.purpose', 'item-order')
})

// Report: this chat, Nov09 — new conditions use the full menu without reviving an old scope question.
it('carries the same fresh query state and versions through the actual iframe for all readers', async () => {
  const { execute } = await setup()
  await execute('kiosk_fast_path_context', { transcript: '推薦餐點' })
  await execute('kiosk_fast_path_execute', { candidateId: 'intent:recommend' })
  await execute('kiosk_fast_path_context', { transcript: '120元以下有什麼' })
  const offered = await execute('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', priceChoiceId: 'UPPER_INCLUSIVE' })
  expect(offered).not.toHaveProperty('pendingCustomerChoice.purpose', 'menu-query-scope')
  expect(offered).toHaveProperty('appliedPriceConditions', { maxPrice: 120 })
  const decision = await execute('kiosk_fast_path_context', { transcript: '還有其他的嗎' }) as { revisions: unknown }
  const passive = await execute('kiosk_interaction_state') as { revisions: unknown }
  const conversation = parse(conversationContextSchema, await execute('kiosk_conversation_context'))
  expect(parse(decisionRevisionsSchema, decision.revisions)).toEqual(conversation.revisions)
  expect(passive.revisions).toEqual(conversation.revisions)
  expect(conversation.phase).toBe('ordering')
  expect(decision).not.toHaveProperty('waitingFor.purpose', 'menu-query-scope')
  expect(passive).not.toHaveProperty('waitingFor.purpose', 'menu-query-scope')
  expect(conversation.waitingFor?.purpose).not.toBe('menu-query-scope')
  expect(conversation.queryState?.prices).toEqual({ maxPrice: 120 })
  expect(conversation.cart.itemCount).toBe(0)
})

// Report: DEV-810280 — real iframe receipts must lead to review, then allow adding more.
it('summarizes multi-add and returns from table review to selecting more without submitting', async () => {
  const { execute } = await setup('?table')
  const receipts = createMenuReplyWindow()
  receipts.record('menu_get', await execute('menu_get', { queries: ['水餃', '便當2'], display: true }))
  receipts.record('order_add_item', await execute('order_add_item', { itemId: 'dish-0', quantity: 1 }))
  const added = await execute('order_add_item', { itemId: 'dish-2', quantity: 1 })
  receipts.record('order_add_item', added)
  const question = questionReceiptFrom(added)!
  const rendered = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_get', 'order_add_item', 'order_add_item'] }, { menu: receipts, question, handoff: { intent: 'ADD_ONLY' }, failureMessage: '失敗' })
  expect(rendered.content).not.toContain('目前可以點')
  expect(rendered.content).not.toContain('80元')
  expect(rendered.content.match(/加入購物車/g)).toHaveLength(1)
  expect(rendered.content).toContain(question.question)
  expect(question.purpose).toBe('cart-review')
  await execute('kiosk_dialogue_presented', { content: rendered.content, questionId: question.questionId })
  await execute('kiosk_fast_path_context', { transcript: '好' })
  const review = await execute('kiosk_fast_path_execute', { candidateId: 'intent:view-cart' })
  expect(review).toHaveProperty('pendingCustomerChoice.purpose', 'checkout-entry')
  await execute('menu_open')
  expect(await execute('cart_get', { display: false })).toHaveProperty('cart.itemCount', 2)
  expect(await execute('kiosk_interaction_state')).not.toHaveProperty('waitingFor.purpose', 'checkout-entry')
})

// Report: this chat, Nov09 — a new preference turn must replace, not patch, old positive filters.
it('replaces an earlier price cap on the actual iframe while combining current category and price', async () => {
  const { execute } = await setup()
  expect(await execute('menu_recommend', { action: 'update', category: '便當', maxPrice: 80 })).toHaveProperty('items', [expect.objectContaining({ id: 'dish-0' })])
  const next = await execute('menu_recommend', { action: 'update', category: '便當' })
  expect(next).toMatchObject({ appliedPriceConditions: {}, items: [{ id: 'dish-0' }, { id: 'dish-1' }, { id: 'dish-2' }] })
  const combined = await execute('menu_recommend', { action: 'update', category: '便當', minPrice: 100, maxPrice: 120 })
  expect(combined).toMatchObject({ appliedPriceConditions: { minPrice: 100, maxPrice: 120 }, items: [{ id: 'dish-2' }, { id: 'dish-3' }, { id: 'dish-4' }] })
  const context = parse(conversationContextSchema, await execute('kiosk_conversation_context'))
  expect(context.queryState?.category).toBe('便當')
  expect(context.queryState?.prices).toEqual({ minPrice: 100, maxPrice: 120 })
  expect(context.cart.itemCount).toBe(0)
})
