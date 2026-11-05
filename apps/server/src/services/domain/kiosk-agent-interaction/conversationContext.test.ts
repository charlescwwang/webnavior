import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { currentContextInstructions, preserveRequestedQuantities, replyTool, selectReply } from './conversationContext'

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

// Report: Q01-M-F1 attempts13/14/23; Main silently converted200 servings into20.
it('restores a single explicit oversized count without another provider call', async () => {
  const context = parse(conversationContextSchema, { ...facts, sourceUtterance: '排骨便當200份', quantityPolicy: { maximum: 20, mentionedCounts: [200], message: '最多20份。' } })
  const calls = [{ id: 'pork', type: 'function' as const, function: { name: 'order_add_item', arguments: '{"itemId":"pork","quantity":20}' } }]
  const complete = vi.fn(async () => Response.json({}))
  const checked = await preserveRequestedQuantities(context, calls, complete)
  expect(checked?.[0]?.id).toBe('pork')
  expect(JSON.parse(checked![0]!.function.arguments)).toEqual({ itemId: 'pork', quantity: 200 })
  expect(complete).not.toHaveBeenCalled()
})

it.each([false, true])('binds mixed counts to proposal IDs and rejects an invented20 (invented=%s)', async (invented) => {
  const context = parse(conversationContextSchema, { ...facts, sourceUtterance: '招牌便當200份，排骨便當一份', quantityPolicy: { maximum: 20, mentionedCounts: [200, 1], message: '最多20份。' } })
  const calls = [{ id: 'signature', type: 'function' as const, function: { name: 'order_add_item', arguments: '{"itemId":"signature","quantity":20}' } }, { id: 'pork', type: 'function' as const, function: { name: 'order_add_item', arguments: '{"itemId":"pork","quantity":1,"replaceLineId":"dumplings-line"}' } }]
  const complete = vi.fn(async (_body: Record<string, unknown>) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'preserve_requested_quantities', arguments: JSON.stringify({ quantities: [{ callId: 'pork', quantity: 1, replaceExisting: false }, { callId: 'signature', quantity: invented ? 20 : 200, replaceExisting: false }] }) } }] } }] }))
  const checked = await preserveRequestedQuantities(context, calls, complete)
  if (invented) {
    expect(checked).toBeUndefined()
  }
  else {
    expect(checked?.map(call => JSON.parse(call.function.arguments).quantity)).toEqual([200, 1])
    expect(checked?.map(call => call.id)).toEqual(['signature', 'pork'])
    expect(JSON.parse(checked![1]!.function.arguments)).not.toHaveProperty('replaceLineId')
  }
  expect(complete).toHaveBeenCalledTimes(1)
  expect(complete.mock.calls[0]![0].tools).toMatchObject([{ function: { parameters: { properties: { quantities: { items: { properties: { quantity: { enum: [0, 200, 1] } } } } } } } }])
})

it('adds no provider review to ordinary counts or budget numbers', async () => {
  const context = parse(conversationContextSchema, { ...facts, sourceUtterance: '200元以內排骨便當一份', quantityPolicy: { maximum: 20, mentionedCounts: [1], message: '最多20份。' } })
  const complete = vi.fn(async () => Response.json({}))
  expect(await preserveRequestedQuantities(context, [], complete)).toEqual([])
  expect(complete).not.toHaveBeenCalled()
})

// Report: Q01-M-B3, semantic4: correcting a never-added count replaced existing dumplings.
it.each([false, true])('verifies replacement consent even when all current counts are legal (consent=%s)', async (consent) => {
  const context = parse(conversationContextSchema, { ...facts, readOnly: false, sourceUtterance: consent ? '把原來的水餃換成一份排骨便當' : '不要200份排骨便當，改成一份排骨便當就好', cart: { itemCount: 1, total: 80, lines: [{ id: 'dumplings-line', itemId: 'dumplings', name: '水餃', quantity: 1, unitPrice: 80, options: [] }] }, quantityPolicy: { maximum: 20, mentionedCounts: [1], message: '最多20份。' } })
  const calls = [{ id: 'pork', type: 'function' as const, function: { name: 'order_add_item', arguments: '{"itemId":"pork","quantity":1,"replaceLineId":"dumplings-line"}' } }]
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'preserve_requested_quantities', arguments: JSON.stringify({ quantities: [{ callId: 'pork', quantity: 1, replaceExisting: consent }] }) } }] } }] }))
  const checked = await preserveRequestedQuantities(context, calls, complete)
  expect(complete).toHaveBeenCalledOnce()
  expect(JSON.parse(checked![0]!.function.arguments)).toEqual({ itemId: 'pork', quantity: 1, ...(consent ? { replaceLineId: 'dumplings-line' } : {}) })
})

it('withholds a replacement when its consent review is invalid', async () => {
  const context = parse(conversationContextSchema, { ...facts, readOnly: false, quantityPolicy: { maximum: 20, mentionedCounts: [1], message: '最多20份。' } })
  const calls = [{ id: 'replace', type: 'function' as const, function: { name: 'order_add_item', arguments: '{"itemId":"pork","replaceLineId":"old"}' } }]
  const complete = vi.fn(async () => Response.json({ choices: [] }))
  expect(await preserveRequestedQuantities(context, calls, complete)).toBeUndefined()
  expect(complete).toHaveBeenCalledOnce()
})

// Report: purchase2 C12-A1; “總共兩份” removed the already-correct dumplings line.
it.each([false, true])('checks actual removal consent independently of an explicit serving count (consent=%s)', async (consent) => {
  const context = parse(conversationContextSchema, { ...facts, readOnly: false, sourceUtterance: consent ? '移除水餃兩份' : '是總共兩份，不是再加兩份', quantityPolicy: { maximum: 20, mentionedCounts: [2], message: '最多20份。' }, cart: { itemCount: 2, total: 160, lines: [{ id: 'dumplings-line', itemId: 'dumplings', name: '水餃', quantity: 2, unitPrice: 80, options: [] }] } })
  const calls = [{ id: 'remove', type: 'function' as const, function: { name: 'cart_remove_item', arguments: '{"lineId":"dumplings-line"}' } }]
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'preserve_requested_quantities', arguments: JSON.stringify({ quantities: [{ callId: 'remove', quantity: 0, replaceExisting: false, removeExisting: consent }] }) } }] } }] }))
  const checked = await preserveRequestedQuantities(context, calls, complete)
  expect(complete).toHaveBeenCalledOnce()
  if (consent)
    expect(checked).toEqual(calls)
  else
    expect(checked).toBeUndefined()
})
