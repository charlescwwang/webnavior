import { expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// Plan: docs/plans/2026-10-28-kiosk-conversation-repair.md, Nov1 shared progress.
it('exposes the same known quantity, selected options and missing slots to all conversation readers', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [{ id: 'size', label: '大小', required: true, values: [{ id: 'large', label: '大份', priceDelta: 10 }] }] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '測試餐兩份' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const main = await runtime.invoke('kiosk_conversation_context') as { retainedRequests: unknown[] }
  const host = await runtime.invoke('kiosk_interaction_state') as { retainedRequests: unknown[] }
  const fast = await runtime.invoke('kiosk_fast_path_context', { transcript: '大份' }) as { retainedRequests: unknown[] }
  expect(main.retainedRequests).toMatchObject([{ itemId: 'meal', status: 'active', quantity: 2, options: [], missing: { quantity: false, optionGroupIds: ['size'] }, sourceUtterance: '測試餐兩份' }])
  expect(host.retainedRequests).toEqual(main.retainedRequests)
  expect(fast.retainedRequests).toEqual(main.retainedRequests)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('keeps an unknown quantity explicit and removes the draft only after the real cart effect', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '測試餐' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const before = await runtime.invoke('kiosk_conversation_context') as { retainedRequests: unknown[] }
  expect(before.retainedRequests).toMatchObject([{ itemId: 'meal', options: [], missing: { quantity: true, optionGroupIds: [] } }])
  expect(before.retainedRequests[0]).not.toHaveProperty('quantity')
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string }> }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.candidates.find(choice => choice.id.includes(':quantity:2'))!.id })
  expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ retainedRequests: [], cart: { itemCount: 2 } })
})

it('distinguishes the foreground proposal from the retained meal and preserves both slot sets', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'first', name: '第一餐', aliases: [], optionGroups: [{ id: 'size', label: '大小', required: true, values: [{ id: 'large', label: '大份', priceDelta: 10 }] }] },
    { ...menu[0]!, id: 'next', name: '第二餐', aliases: [], optionGroups: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '第一餐兩份' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '第二餐' }) as { clarificationOffer: { id: string } }
  await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer.id })
  const main = await runtime.invoke('kiosk_conversation_context') as { phase: string, retainedRequests: unknown[] }
  const host = await runtime.invoke('kiosk_interaction_state') as { retainedRequests: unknown[] }
  const fast = await runtime.invoke('kiosk_fast_path_context', { transcript: '對，一份' }) as { retainedRequests: unknown[] }
  expect(main.phase).toBe('meal_confirmation')
  expect(main.retainedRequests).toMatchObject([
    { itemId: 'next', status: 'confirming', missing: { quantity: true } },
    { itemId: 'first', status: 'suspended', quantity: 2, missing: { quantity: false, optionGroupIds: ['size'] } },
  ])
  expect(host.retainedRequests).toEqual(main.retainedRequests)
  expect(fast.retainedRequests).toEqual(main.retainedRequests)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('returns detached draft facts so a reader cannot alter the pending order', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '測試餐' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const first = await runtime.invoke('kiosk_conversation_context') as { retainedRequests: Array<{ quantity?: number, missing: { quantity: boolean } }> }
  first.retainedRequests[0]!.quantity = 10
  first.retainedRequests[0]!.missing.quantity = false
  const next = await runtime.invoke('kiosk_conversation_context') as { retainedRequests: unknown[] }
  expect(next.retainedRequests[0]).not.toHaveProperty('quantity')
  expect(next.retainedRequests[0]).toHaveProperty('missing.quantity', true)
})

it('keeps selected options and the original request when a confirmation answer supplies quantity', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'first', name: '第一餐', aliases: [], optionGroups: [] },
    { ...menu[0]!, id: 'next', name: '第二餐', aliases: [], optionGroups: [
      { id: 'size', label: '大小', required: true, values: [{ id: 'large', label: '大份', priceDelta: 10 }] },
      { id: 'spice', label: '辣度', required: true, values: [{ id: 'mild', label: '小辣', priceDelta: 0 }] },
    ] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '第一餐' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '第二餐' }) as { clarificationOffer: { id: string } }
  await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer.id })
  const confirming = await runtime.invoke('kiosk_conversation_context') as { retainedRequests: Array<{ id: string }> }
  const requestId = confirming.retainedRequests[0]!.id
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '對，兩份' }) as { candidates: Array<{ id: string }> }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.candidates.find(choice => choice.id.endsWith(':yes'))!.id })
  const size = await runtime.invoke('kiosk_fast_path_context', { transcript: '大份' }) as { candidates: Array<{ id: string }> }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: size.candidates.find(choice => choice.id.endsWith(':size:large'))!.id })
  const main = await runtime.invoke('kiosk_conversation_context') as { retainedRequests: unknown[] }
  const host = await runtime.invoke('kiosk_interaction_state') as { retainedRequests: unknown[] }
  expect(main.retainedRequests).toMatchObject([
    { itemId: 'next', status: 'active', sourceUtterance: '第二餐', quantity: 2, options: [{ groupId: 'size', valueId: 'large' }], missing: { quantity: false, optionGroupIds: ['spice'] } },
    { itemId: 'first', status: 'suspended', sourceUtterance: '第一餐', missing: { quantity: true } },
  ])
  expect(host.retainedRequests).toEqual(main.retainedRequests)
  expect(main.retainedRequests[0]).toHaveProperty('id', requestId)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('binds each configuration question and its Main recovery choices to the same retained request', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '測試餐' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { retainedRequests: Array<{ id: string }>, waitingFor: { questionId: string, requestId?: string, choices: Array<{ id: string }> }, intentRecovery?: unknown }
  expect(answer.waitingFor.requestId).toBe(answer.retainedRequests[0]!.id)
  expect(answer.intentRecovery).toEqual({ kind: 'answer', questionId: answer.waitingFor.questionId, requestId: answer.retainedRequests[0]!.id, candidateIds: answer.waitingFor.choices.map(choice => choice.id) })
  expect(await runtime.invoke('kiosk_interaction_state')).toHaveProperty('waitingFor.requestId', answer.retainedRequests[0]!.id)
  expect(await runtime.invoke('kiosk_conversation_context')).toHaveProperty('waitingFor.requestId', answer.retainedRequests[0]!.id)
})

it('issues Main recovery choices at the Menu boundary and withholds them for ambiguous catalog targets', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'first', name: '第一餐', aliases: [], optionGroups: [] },
    { ...menu[0]!, id: 'next', name: '第二餐', aliases: [], optionGroups: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const exact = await runtime.invoke('kiosk_fast_path_context', { transcript: '我要第一餐' }) as { intentRecovery?: { kind: string, candidateIds: string[] } }
  expect(exact.intentRecovery?.kind).toBe('request')
  expect(exact.intentRecovery?.candidateIds).toContain('intent:add-item')
  expect(exact.intentRecovery?.candidateIds).not.toContain('intent:start-checkout')
  expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '第一餐和第二餐' })).not.toHaveProperty('intentRecovery')
})

// Report: live112 C14-F2; a checkout invitation hid an explicit new fulfillment demand.
it('issues an independent request scope for a named fulfillment change while checkout waits', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'meal', quantity: 1 })
  const pickup = await runtime.invoke('order_set_fulfillment', { mode: 'takeout' }) as { customerMessage: string, pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_dialogue_presented', { content: pickup.pendingCustomerChoice.question, questionId: pickup.pendingCustomerChoice.questionId })
  const state = await runtime.invoke('kiosk_fast_path_context', { transcript: '更正，我要內用' }) as { intentRecovery: { kind: string, candidateIds: string[] }, candidates: Array<{ id: string }>, waitingFor?: unknown }
  expect(state.intentRecovery.kind).toBe('request')
  expect(state.intentRecovery.candidateIds).toContain('intent:set-fulfillment:dine-in')
  expect(state.intentRecovery.candidateIds).not.toContain('intent:start-checkout')
  expect(state.candidates.some(candidate => candidate.id === 'intent:start-checkout')).toBe(false)
  expect(state.waitingFor).toBeUndefined()
  await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:start-checkout' })).rejects.toThrow()
  const assent = await runtime.invoke('kiosk_fast_path_context', { transcript: '好' }) as { intentRecovery: { kind: string } }
  expect(assent.intentRecovery.kind).toBe('answer')
})

// Report: live112 C10-F2; named new meal was interpreted as an availability correction of the old draft.
it('keeps a named different meal outside the foreground draft answer lease', async () => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'noodle', name: '牛肉麵', aliases: [], optionGroups: [] },
    { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要牛肉麵' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '先加水餃一份' }) as { phase: string, candidates: Array<{ id: string }> }
  expect(next.phase).toBe('ordering')
  expect(next.candidates.some(candidate => candidate.id === 'intent:add-item')).toBe(true)
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ cart: { lines: [{ itemId: 'dumplings', quantity: 1 }] }, retainedRequests: [{ itemId: 'noodle', missing: { quantity: true } }] })
})
