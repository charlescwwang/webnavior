import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { currentContextInstructions, preserveRequestedQuantities, replyTool, reviewOperations, selectReply } from './conversationContext'

const facts = { contextId: 'current', capturedAt: 1, taskId: 'task', sourceUtterance: '可以用哪種方式付款？', phase: 'ordering', entryComplete: true, readOnly: true, constraints: { excludeIngredients: [], includeIngredients: [] }, revisions: { menu: 1, cart: 0, selectedItem: 0, checkout: 0 }, cart: { itemCount: 0, total: 0, lines: [] }, paymentState: 'idle', allowedPaymentMethods: [], paymentMethods: [{ id: 'linepay', label: 'LINE Pay' }], fulfillmentModes: [], retainedRequests: [], allowedToolNames: [] }

const result = (args: unknown) => Response.json({ choices: [{ message: { tool_calls: [{ id: 'reply', type: 'function', function: { name: replyTool.function.name, arguments: JSON.stringify(args) } }] } }] })

// Report: this chat, Nov08 — both assistants share a role but retain service-mode boundaries.
it.each(['kiosk', 'table-service'] as const)('states the shared assistant role and the current fulfillment policy: %s', (serviceMode) => {
  const instructions = currentContextInstructions(parse(conversationContextSchema, { ...facts, serviceMode }))
  expect(instructions).toContain('統一稱為點餐助手')
  if (serviceMode === 'table-service') {
    expect(instructions).toContain('不詢問內用／外帶')
    expect(instructions).toContain('目前綁定桌位')
    expect(instructions).not.toContain('本輪為Kiosk點餐')
  }
  else {
    expect(instructions).toContain('本輪fulfillmentModes')
    expect(instructions).not.toContain('本輪為桌邊服務')
  }
})

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
  expect(complete.mock.calls[0]![0].tools).toMatchObject([{ function: { parameters: { properties: { kind: { enum: ['clarification', 'service-information', 'staff-assistance'] } } } } }])
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

// Report: Nov5 live — 哪一個餐點點的人數最多 was repeatedly treated as incomprehensible.
it('keeps missing ranking/promotion data separate from unclear meaning and unsupported services', () => {
  const context = parse(conversationContextSchema, facts)
  const instruction = currentContextInstructions(context)
  expect(instruction).toContain('意思清楚但缺少資料不是聽不懂')
  expect(instruction).toContain('不編造排名或優惠')
  expect(instruction).toContain('真正品名／數量或意圖未明才釐清')
})

// Report: Nov5 isolated N05-UX-RANKING/PROMOTION — read-required schema forced clarification.
it('permits a missing-data reply without treating it as a menu receipt', async () => {
  const complete = vi.fn()
  const reply = { kind: 'service-information', topic: 'other' }
  const selected = await selectReply({ context: parse(conversationContextSchema, facts), requireMenuRead: true, calls: [{ id: 'missing-data', type: 'function', function: { name: replyTool.function.name, arguments: JSON.stringify(reply) } }], complete })
  expect(selected).toEqual({ reply, repaired: false })
  expect(complete).not.toHaveBeenCalled()
})

// Report: this chat, 2026-11-06 — a scope refusal must not be rewritten as a request to repeat the question.
it('accepts a generic scope refusal before a menu read without invoking repair or commerce', async () => {
  const complete = vi.fn(async () => result({ kind: 'clarification' }))
  const reply = { kind: 'service-information', topic: 'out-of-scope' }
  const selected = await selectReply({ context: parse(conversationContextSchema, facts), requireMenuRead: true, calls: [{ id: 'outside', type: 'function', function: { name: replyTool.function.name, arguments: JSON.stringify(reply) } }], complete })
  expect(selected).toEqual({ reply, repaired: false })
  expect(complete).not.toHaveBeenCalled()
})

// Report: Nov6 hA7/I_A7; cart display is an effect even without a pending question.
it.each([
  { text: '不知道收了什麼印進去', choice: 'UNSUPPORTED', allowed: false },
  { text: '警戒風雲影響廠商的餐點 更要調整訂單內容', choice: 'UNSUPPORTED', allowed: false },
  { text: '幫我看一下購物車', choice: 'SUPPORTED', allowed: true },
])('regression K1107-CART verifies display intent without a pending question: $text', async ({ text, choice, allowed }) => {
  const context = parse(conversationContextSchema, { ...facts, sourceUtterance: text })
  const complete = vi.fn(async (_body: Record<string, unknown>) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'verify_customer_operation', arguments: JSON.stringify({ choice }) } }] } }] }))
  const accepted = await reviewOperations({ context, calls: [{ id: 'cart', type: 'function', function: { name: 'cart_get', arguments: '{"display":true}' } }], complete })
  expect(accepted).toBe(allowed)
  expect(complete).toHaveBeenCalledOnce()
  expect(JSON.stringify(complete.mock.calls[0]![0])).toContain(text)
  expect(JSON.stringify(complete.mock.calls[0]![0])).toContain('cart_get')
})

// Report: this chat Nov7; a broken reviewer response cannot become consent.
it.each([
  { label: 'missing call', payload: { choices: [] }, error: 'invalid format' },
  { label: 'wrong function', payload: { choices: [{ message: { tool_calls: [{ function: { name: 'other', arguments: '{"choice":"SUPPORTED"}' } }] } }] }, error: 'invalid format' },
  { label: 'broken JSON', payload: { choices: [{ message: { tool_calls: [{ function: { name: 'verify_customer_operation', arguments: '{broken' } }] } }] }, error: 'invalid JSON' },
  { label: 'extra argument', payload: { choices: [{ message: { tool_calls: [{ function: { name: 'verify_customer_operation', arguments: '{"choice":"SUPPORTED","confirmed":true}' } }] } }] }, error: 'invalid choice' },
])('regression K1107-CONFIRM rejects malformed review: $label', async ({ payload, error }) => {
  const context = parse(conversationContextSchema, facts)
  await expect(reviewOperations({ context, calls: [{ id: 'cart', type: 'function', function: { name: 'cart_get', arguments: '{"display":true}' } }], complete: async () => Response.json(payload) })).rejects.toThrow(error)
})

// Report: this chat, Nov7 — confirming a special request must not authorize a staff call.
it('validates special-order clarification separately from staff-call consent', async () => {
  const base = parse(conversationContextSchema, { ...facts, sourceUtterance: '對', orderAssistance: { questionId: 'intent', expiresAt: Date.now() + 30000 } })
  const select = (action: string, context = base) => selectReply({ context, repair: false, calls: [{ id: 'reply', type: 'function', function: { name: replyTool.function.name, arguments: JSON.stringify({ kind: 'staff-assistance', action }) } }], complete: async () => {
    throw new Error('No provider repair expected')
  } })
  expect((await select('offer')).reply).toEqual({ kind: 'staff-assistance', action: 'offer' })
  expect((await select('accept')).reply).toEqual({ kind: 'clarification' })
  expect((await select('offer', { ...base, orderAssistance: { questionId: 'expired', expiresAt: Date.now() - 1 } })).reply).toEqual({ kind: 'clarification' })
  expect((await select('confirm-order', { ...base, orderAssistance: undefined, entryComplete: false })).reply).toEqual({ kind: 'clarification' })
})

// Report: this chat, Nov08 configured replay accepted a removal as a replacement pre-step.
it.each([false, true])('keeps cart removal separate from atomic replacement (replacement=%s)', async (replacement) => {
  const context = parse(conversationContextSchema, { ...facts, readOnly: false, sourceUtterance: replacement ? '牛肉麵不要了，改水餃一份' : '把牛肉麵移除', cart: { itemCount: 1, total: 150, lines: [{ id: 'old', itemId: 'beef', name: '牛肉麵', quantity: 1, unitPrice: 150, options: [] }] } })
  const calls = [{ id: 'remove', type: 'function' as const, function: { name: 'cart_remove_item', arguments: '{"lineId":"old"}' } }]
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'preserve_requested_quantities', arguments: JSON.stringify({ quantities: [{ callId: 'remove', quantity: 0, replaceExisting: replacement, removeExisting: true }] }) } }] } }] }))
  const checked = await preserveRequestedQuantities(context, calls, complete)
  if (replacement)
    expect(checked).toBeUndefined()
  else
    expect(checked).toEqual(calls)
})

// Report: this chat, Nov08 fuzzy purchase incorrectly selected originalRecipe:true.
it('does not label ordinary configuration as an unsupported preparation request', () => {
  const context = parse(conversationContextSchema, { ...facts, phase: 'configuration', readOnly: false, allowedToolNames: ['menu_confirm_item'] })
  expect(currentContextInstructions(context)).not.toContain('本輪正在補齊未入車餐點的份數，並有未支援的製作調整')
})
