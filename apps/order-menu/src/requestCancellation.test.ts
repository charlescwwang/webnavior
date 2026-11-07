import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

// Report: docs/plans/2026-10-28-kiosk-conversation-repair.md, P2 change-of-mind control.
it('regression K1107-SWITCH withdraws only the unadded draft before ordering another dish', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { id: 'dumplings', name: '水餃', category: '餐點', description: '', imageUrl: '', price: 80, optionGroups: [], recommendationTags: [] },
    { id: 'noodles', name: '牛肉麵', category: '餐點', description: '', imageUrl: '', price: 150, optionGroups: [], recommendationTags: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const requestId = before.retainedRequests[0]!.id
  expect(before.retainedRequests[0]?.missing.quantity).toBe(true)
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'switch', transcript: '算了，我改吃牛肉麵一碗', expectedMenuRevision: 0, constraints: {} })
  const offered = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(offered.allowedToolNames).toContain('order_cancel_request')
  expect(await runtime.executeTool('order_cancel_request', { requestId })).toMatchObject({ cancelledRequestId: requestId })
  await runtime.invoke('kiosk_conversation_context')
  await runtime.invokeForAgent('order_add_item', { itemId: 'noodles', quantity: 1 })
  const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(after.retainedRequests.some(request => request.id === requestId)).toBe(false)
  expect(after.cart.lines).toMatchObject([{ itemId: 'dumplings', quantity: 1 }, { itemId: 'noodles', quantity: 1 }])
  expect(after.cart.itemCount).toBe(2)
  // With no matching draft the tool is no longer offered. Repeating the
  // request must fail before touching either of the accepted cart lines.
  expect(await runtime.executeTool('order_cancel_request', { requestId })).toMatchObject({ ok: false })
  expect(parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context')).cart).toEqual(after.cart)
})
