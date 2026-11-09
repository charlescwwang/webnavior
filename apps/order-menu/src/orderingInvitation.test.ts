import type { ConversationQuestion } from '@proj-airi/stage-shared/kiosk-conversation'

import { expect, it, vi } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

function setup() {
  return createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'meal', name: '測試雞肉餐', aliases: [], optionGroups: [], composition: { ingredients: ['chicken'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    { ...menu[0]!, id: 'other', name: '另一道牛肉餐', aliases: [], optionGroups: [], composition: { ingredients: ['beef'], complete: true, source: 'merchant', revision: '1', removals: [] } },
  ], onAction: () => {}, onMenuRequested: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => {} })
}

// Report: this chat Nov8 23:01 — the assistant asked 幾份 but 一份 had waitingFor:null.
it.each(['lookup', 'filtered-lookup', 'recommendation', 'redisplay'] as const)('binds the %s quantity question only after presentation', async (path) => {
  const runtime = setup()
  const receipt = await runtime.invoke(path === 'lookup' || path === 'filtered-lookup' ? 'menu_get' : path === 'recommendation' ? 'menu_recommend' : 'menu_show_recommendations', path === 'lookup' ? { query: '測試雞肉餐' } : path === 'filtered-lookup' ? { includeIngredients: ['chicken'], display: true } : path === 'recommendation' ? { action: 'update', includeIngredients: ['chicken'] } : { itemIds: ['meal'] }) as { customerMessage: string, pendingCustomerChoice?: ConversationQuestion }
  expect(receipt.pendingCustomerChoice?.purpose).toBe('item-order')
  expect(receipt.customerMessage).toContain(receipt.pendingCustomerChoice!.question)
  expect(await runtime.invoke('kiosk_interaction_state')).not.toHaveProperty('waitingFor')
  await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice!.questionId })
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' }) as { waitingFor: ConversationQuestion, candidates: Array<{ id: string }> }
  expect(context.waitingFor.purpose).toBe('item-order')
  expect(context.candidates).toContainEqual(expect.objectContaining({ id: 'intent:add-item' }))
  const added = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(added).not.toHaveProperty('ok', false)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'meal', quantity: 1 }] } })
  expect(await runtime.invoke('kiosk_interaction_state')).not.toHaveProperty('waitingFor.purpose', 'item-order')
})

it.each(['return', 'other', 'redisplay', 'cart', 'decline', 'timeout', 'reset'] as const)('does not reuse the old meal after %s', async (change) => {
  const runtime = setup()
  const receipt = await runtime.invoke('menu_get', { query: '測試雞肉餐' }) as { customerMessage: string, pendingCustomerChoice?: ConversationQuestion }
  expect(receipt.pendingCustomerChoice?.purpose).toBe('item-order')
  await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice!.questionId })
  if (change === 'return')
    await runtime.invoke('menu_open')
  if (change === 'other')
    await runtime.invoke('menu_get', { query: '另一道牛肉餐' })
  if (change === 'redisplay')
    await runtime.invoke('menu_show_recommendations', { itemIds: ['other'] })
  if (change === 'cart')
    await runtime.invoke('cart_get', { display: true })
  if (change === 'decline') {
    await runtime.invoke('kiosk_fast_path_context', { transcript: '不要了' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:defer-question' })
  }
  if (change === 'reset')
    await runtime.invoke('kiosk_ordering_reset')
  if (change === 'timeout') {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 90_000)
  }
  try {
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: change === 'other' ? '另一道牛肉餐兩份' : '一份' }) as { waitingFor?: ConversationQuestion }
    if (change === 'timeout') {
      expect(context.waitingFor?.purpose).toBe('item-order')
      expect(context.waitingFor?.expiresAt).toBeGreaterThan(Date.now())
    }
    else {
      expect(context.waitingFor?.questionId).not.toBe(receipt.pendingCustomerChoice!.questionId)
    }
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  }
  finally { vi.restoreAllMocks() }
})

it('ignores a late lookup invitation after another task presents a different meal', async () => {
  let finish!: () => void
  let started!: () => void
  const painting = new Promise<void>(resolve => started = resolve)
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'meal', name: '測試餐', aliases: [], optionGroups: [] },
    { ...menu[0]!, id: 'other', name: '另一餐', aliases: [], optionGroups: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: (presentation) => {
    if (presentation.itemIds[0] === 'meal') {
      started()
      return new Promise<void>(resolve => finish = resolve)
    }
  } })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'old', transcript: '測試餐有嗎', readOnly: true, expectedMenuRevision: 0, constraints: {} })
  const old = runtime.invokeForAgent('menu_get', { query: '測試餐' })
  await painting
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'old' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'new', transcript: '另一餐有嗎', readOnly: true, expectedMenuRevision: 0, constraints: {} })
  const current = await runtime.invokeForAgent('menu_get', { query: '另一餐' }) as { customerMessage: string, pendingCustomerChoice: ConversationQuestion }
  await runtime.invoke('kiosk_dialogue_presented', { content: current.customerMessage, questionId: current.pendingCustomerChoice.questionId })
  finish()
  expect(await old).not.toHaveProperty('pendingCustomerChoice.purpose', 'item-order')
  expect(await runtime.invoke('kiosk_interaction_state')).toHaveProperty('waitingFor.questionId', current.pendingCustomerChoice.questionId)
})

// Report: Nov09 real replay — Agent recommendations painted one dish without
// issuing its quantity question, because the query lost its owning task.
it.each([{ ingredient: 'chicken', itemId: 'meal' }, { ingredient: 'beef', itemId: 'other' }])('binds an Agent $ingredient recommendation to its quantity question', async ({ ingredient, itemId }) => {
  const runtime = setup()
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'recommendation-owner', transcript: ingredient === 'chicken' ? '我想吃雞肉' : '我想吃牛肉', expectedMenuRevision: 0, readOnly: true, constraints: { includeIngredients: [ingredient] } })
  const receipt = await runtime.invokeForAgent('menu_recommend', { action: 'update', includeIngredients: [ingredient] }) as { customerMessage: string, pendingCustomerChoice?: ConversationQuestion }
  expect(receipt.pendingCustomerChoice?.purpose).toBe('item-order')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  await runtime.invoke('kiosk_dialogue_presented', { content: receipt.customerMessage, questionId: receipt.pendingCustomerChoice!.questionId })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'recommendation-owner' })
  const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' }) as { waitingFor: ConversationQuestion }
  expect(next.waitingFor.purpose).toBe('item-order')
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId, quantity: 1 }] } })
})
