import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { currentContextInstructions, replyTool, selectReply } from './conversationContext'

const facts = { contextId: 'current', capturedAt: 1, taskId: 'task', sourceUtterance: '可以用哪種方式付款？', phase: 'ordering', entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], paymentMethods: [{ id: 'linepay', label: 'LINE Pay' }], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] }

const result = (args: unknown) => Response.json({ choices: [{ message: { tool_calls: [{ id: 'reply', type: 'function', function: { name: replyTool.function.name, arguments: JSON.stringify(args) } }] } }] })

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct28 no-tool drafts rejected.
it('repairs plain prose using only the current utterance and fresh facts, without the false draft', async () => {
  const context = parse(conversationContextSchema, facts)
  context.sourceUtterance = '可以用哪種方式付款？'
  const complete = vi.fn(async (_body: Record<string, unknown>) => result({ kind: 'payment-methods' }))
  expect(await selectReply({ answer: '支持刷卡。', calls: [], context, complete })).toEqual({ reply: { kind: 'payment-methods' }, repaired: true })
  expect(complete).toHaveBeenCalledTimes(1)
  const body = complete.mock.calls[0]![0]
  expect(JSON.stringify(body)).toContain('可以用哪種方式付款')
  expect(JSON.stringify(body)).not.toContain('支持刷卡')
  expect(body.tools).toEqual([replyTool])
})

it('stops after one malformed repair and clarifies instead of declaring an operation successful', async () => {
  const context = parse(conversationContextSchema, facts)
  const complete = vi.fn(async (_body: Record<string, unknown>) => result({ kind: 'operation-result', answer: '已加入。' }))
  expect(await selectReply({ calls: [], context, complete })).toEqual({ reply: { kind: 'clarification' }, repaired: true })
  expect(complete).toHaveBeenCalledTimes(1)
})

it('keeps provider failure distinct from meaning uncertainty', async () => {
  const context = parse(conversationContextSchema, facts)
  await expect(selectReply({ calls: [], context, complete: async () => new Response('', { status: 503 }) })).rejects.toThrow('provider failed')
})

it('cannot use an information selector to finish a required menu presentation without a receipt', async () => {
  const complete = vi.fn(async (_body: Record<string, unknown>) => result({ kind: 'clarification' }))
  const selected = await selectReply({ context: parse(conversationContextSchema, facts), requireMenuRead: true, calls: [{ id: 'draft', type: 'function', function: { name: replyTool.function.name, arguments: '{"kind":"menu-information","subjects":["水果"]}' } }], complete })
  expect(selected).toEqual({ reply: { kind: 'clarification' }, repaired: true })
  expect(complete).toHaveBeenCalledTimes(1)
  expect(complete.mock.calls[0]![0].tools).toMatchObject([{ function: { parameters: { properties: { kind: { enum: ['clarification'] } } } } }])
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30.
it('does not issue another provider call when a reviewed reply is malformed', async () => {
  const complete = vi.fn(async () => result({ kind: 'payment-methods' }))
  expect(await selectReply({ repair: false, context: parse(conversationContextSchema, facts), calls: [], complete })).toEqual({ reply: { kind: 'clarification' }, repaired: false })
  expect(complete).not.toHaveBeenCalled()
})

// Shared-progress plan: a semantic read-only handoff must not erase known meal slots.
it('retains draft facts in Main instructions when a read-only turn omits the catalog', () => {
  const context = parse(conversationContextSchema, { ...facts, retainedRequests: [{ id: 'draft', itemId: 'meal', status: 'active', quantity: 2, options: [], missing: { quantity: false, optionGroupIds: ['size'] }, expectedRevisions: { menu: 1 } }] })
  const instructions = currentContextInstructions(context)
  const current = JSON.parse(instructions.split('\n').at(-1)!)
  expect(current.retainedRequests).toEqual(context.retainedRequests)
  expect(current).not.toHaveProperty('cart')
  expect(instructions).toContain('本輪只允許資訊查詢')
})
