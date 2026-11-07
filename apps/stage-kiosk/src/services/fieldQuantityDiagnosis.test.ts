import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { menu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { selectReply } from '../../../server/src/services/domain/kiosk-agent-interaction/conversationContext'
import { createMenuReplyWindow, replyFromConversation } from './questionPresentation'

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30, seq111–138.
it('keeps read receipts factual without pretending an unexecuted addition succeeded', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], category: '點心', price: 80, optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const replies = createMenuReplyWindow()
  replies.record('menu_get', await runtime.invoke('menu_get', { query: '水餃' }))
  replies.record('cart_get', await runtime.invoke('cart_get', { display: false }))
  const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: ['menu_get', 'cart_get'], answer: '水餃每份80元，您點三份，總共240元。請問需要內用還是自取？' }, { menu: replies, failureMessage: '未完成。' })
  expect(result.role).toBe('assistant')
  expect(result.content).toContain('水餃目前可以點')
  expect(replies.hasOperation('ADD_ITEM')).toBe(false)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0, lines: [] } })
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30, seq160–175.
it('keeps the non-operation reply selector unable to mutate the cart', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], category: '點心', price: 80, optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 3 })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'quantity-diagnosis', transcript: '改成兩份', expectedMenuRevision: parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context')).revisions.menu, constraints: {} })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const complete = vi.fn(async (_body: Record<string, unknown>) => Response.json({ choices: [{ message: { tool_calls: [{ id: 'clarify', type: 'function', function: { name: 'respond_to_customer', arguments: '{"kind":"clarification"}' } }] } }] }))
  const selected = await selectReply({ answer: '已將水餃改為 2 份。請問要內用還是自取？', calls: [], context, complete })
  expect(context.allowedToolNames).toContain('cart_set_line_quantity')
  expect(complete.mock.calls[0]![0].tools).toMatchObject([{ function: { name: 'respond_to_customer' } }])
  expect(selected.reply.kind).toBe('clarification')
  const result = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], reply: selected.reply }, { menu: createMenuReplyWindow(), context, failureMessage: '未完成。' })
  expect(result.content).toContain('剛才沒有理解清楚')
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3 } })
})
