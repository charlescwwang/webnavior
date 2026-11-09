import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'

import { describe, expect, it, vi } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { createMenuToolRuntime } from './webmcp'

async function pendingMeal() {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  return runtime
}

interface Snapshot {
  clarificationOffer?: { id: string, label: string }
  waitingFor: { questionId: string, question: string, choices: Array<{ id: string }> }
  candidates: Array<{ id: string, description: string }>
}

describe('simple meal confirmation', () => {
  // Report: this chat Nov09 — a reroute probe erased the target for 對一份
  // before the second decision could establish any independent new request.
  it('retains the original proposal while a new-request interpretation is only being probed', async () => {
    const runtime = await pendingMeal()
    const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '排骨便當' }) as Snapshot
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer!.id })
    const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '對一份' }) as Snapshot
    await runtime.invoke('kiosk_fast_path_context', { transcript: '對一份', newRequestQuestionId: answer.waitingFor.questionId })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'unissued' })).rejects.toThrow('expired')
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'meal_confirmation', waitingFor: { question: answer.waitingFor.question } })
    expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
    // A later independently verified answer gets its own lease for this target.
    const retried = await runtime.invoke('kiosk_fast_path_context', { transcript: '對，一份' }) as Snapshot
    const yes = retried.candidates.find(candidate => candidate.id.endsWith(':yes'))!
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: yes.id })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'fried-pork-chop-bento', quantity: 1 }] } })
  })

  it('allows Agent reads but blocks mutations and host-only tools during confirmation', async () => {
    const runtime = await pendingMeal()
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '牛肉麵' }) as Snapshot
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: context.clarificationOffer!.id })
    expect(await runtime.invokeForAgent('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 1 })).rejects.toThrow('active meal confirmation')
    await expect(runtime.invokeForAgent('kiosk_fast_path_clarify', { questionId: context.clarificationOffer!.id })).rejects.toThrow('unavailable to the Agent')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('repeats missing information when the customer only repeats the current dish', async () => {
    const runtime = await pendingMeal()
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃' }) as Snapshot
    expect(await runtime.invoke('kiosk_fast_path_clarify', { questionId: context.clarificationOffer!.id })).toMatchObject({ customerMessage: '請問水餃要幾份？', pendingCustomerChoice: { purpose: 'item-configuration' } })
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'configuration' })
  })

  it('keeps an explicit quantity answer on its existing path and revokes the previous proposal', async () => {
    const runtime = await pendingMeal()
    const old = await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃' }) as Snapshot
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃兩份' })).not.toHaveProperty('clarificationOffer')
    await expect(runtime.invoke('kiosk_fast_path_clarify', { questionId: old.clarificationOffer!.id })).rejects.toThrow('STALE')
  })
  it.each([
    { transcript: '泰式酸辣魚便當', label: '泰式酸辣魚便當' },
    { transcript: '招牌便當', label: '周氏蝦捲招牌便當' },
    { transcript: '炸排骨便當', label: '炸排骨便當' },
  ])('confirms $transcript using the real catalog rather than a dish-specific phrase rule', async ({ transcript, label }) => {
    const runtime = await pendingMeal()
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as Snapshot
    expect(snapshot.clarificationOffer).toMatchObject({ label })
    const response = await runtime.invoke('kiosk_fast_path_clarify', { questionId: snapshot.clarificationOffer!.id })
    expect(response).toMatchObject({ customerMessage: `您是要點${label}嗎？` })
  })

  it.each(['酸辣魚便當', '改排骨飯', '便當', '恐龍披薩', '牛肉麵和水餃', '100元以下的餐點', '牛肉麵100元以下', '素食牛肉麵', '不要豬肉的牛肉麵', '略過電話', '你是誰', '手機載具', 'LINE Pay'])('does not invent a single-dish confirmation for %s', async (transcript) => {
    const runtime = await pendingMeal()
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript })).not.toHaveProperty('clarificationOffer')
  })
  it('confirms one dish and never automatically resumes a superseded meal', async () => {
    const runtime = await pendingMeal()
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '牛肉麵' }) as Snapshot
    expect(context.clarificationOffer).toMatchObject({ label: '紅燒牛肉麵' })
    const question = await runtime.invoke('kiosk_fast_path_clarify', { questionId: context.clarificationOffer!.id }) as { pendingCustomerChoice: Snapshot['waitingFor'] }
    expect(question.pendingCustomerChoice.question).toBe('您是要點紅燒牛肉麵嗎？')
    expect(question.pendingCustomerChoice.choices).toHaveLength(2)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    const yes = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as Snapshot
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: yes.candidates.find(choice => choice.id.endsWith(':yes'))!.id })).toMatchObject({ customerMessage: '請問紅燒牛肉麵要幾份？' })
    const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' }) as Snapshot
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.candidates.find(choice => choice.description.includes('1 份'))!.id })
    expect(result).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup', quantity: 1 }] }, pendingCustomerChoice: { purpose: 'fulfillment' } })
    const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as Snapshot
    expect(next.candidates.some(choice => choice.id.startsWith('configure:'))).toBe(false)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup' }] } })
  })

  it('declines a proposed dish without cancelling the original meal or replaying the answer', async () => {
    const runtime = await pendingMeal()
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '牛肉麵' }) as Snapshot
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: context.clarificationOffer!.id })
    const no = await runtime.invoke('kiosk_fast_path_context', { transcript: '不是' }) as Snapshot
    const candidateId = no.candidates.find(choice => choice.id.endsWith(':no'))!.id
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId })).toMatchObject({ customerMessage: expect.stringContaining('水餃要幾份') })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId })).rejects.toThrow()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('rejects expired confirmation answers and stale proposals', async () => {
    vi.useFakeTimers()
    try {
      const runtime = await pendingMeal()
      const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '牛肉麵' }) as Snapshot
      await runtime.invoke('kiosk_fast_path_clarify', { questionId: context.clarificationOffer!.id })
      const yes = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as Snapshot
      vi.advanceTimersByTime(31_000)
      await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: yes.candidates.find(choice => choice.id.endsWith(':yes'))!.id })).rejects.toThrow('STALE')
      await expect(runtime.invoke('kiosk_fast_path_clarify', { questionId: context.clarificationOffer!.id })).rejects.toThrow('STALE')
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    }
    finally { vi.useRealTimers() }
  })

  it('suspends confirmation for a price query without losing its bounds or the previous meal', async () => {
    const runtime = await pendingMeal()
    const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '牛肉麵' }) as Snapshot
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer!.id })
    const question = await runtime.invoke('kiosk_fast_path_context', { transcript: '100元以下的便當' }) as Snapshot
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '100元以下的便當', newRequestQuestionId: question.waitingFor.questionId }) as Snapshot
    expect(context.clarificationOffer).toBeUndefined()
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', priceChoiceId: 'UPPER_INCLUSIVE' }) as { appliedPriceConditions: { maxPrice: number }, items: Array<{ price: number }> }
    expect(result.appliedPriceConditions).toEqual({ maxPrice: 100 })
    expect(result.items.every(item => item.price <= 100)).toBe(true)
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' })).toMatchObject({ phase: 'configuration', waitingFor: { question: '請問水餃要幾份？' } })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: `confirm-meal:${question.waitingFor.questionId}:yes` })).rejects.toThrow('STALE')
  })

  it('rejects confirmation after a cart write and clears every pending meal on reset', async () => {
    const runtime = await pendingMeal()
    const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '牛肉麵' }) as Snapshot
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer!.id })
    const question = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as Snapshot
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: question.candidates.find(choice => choice.id.endsWith(':yes'))!.id })).rejects.toThrow('STALE')
    await runtime.reset()
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('keeps voice choices without directing the customer to removed buttons and bounds spoken repeats', async () => {
    const runtime = await pendingMeal()
    const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '牛肉麵' }) as Snapshot
    const first = await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer!.id }) as { pendingCustomerChoice: Snapshot['waitingFor'] }
    const questionId = first.pendingCustomerChoice.questionId
    const repeated = await runtime.invoke('kiosk_fast_path_clarify', { questionId }) as { silent: boolean, pendingCustomerChoice: { question: string } }
    expect(repeated.silent).toBe(false)
    expect(repeated.pendingCustomerChoice.question).not.toContain('畫面')
    expect(await runtime.invoke('kiosk_fast_path_clarify', { questionId })).toMatchObject({ silent: true, pendingCustomerChoice: { choices: expect.arrayContaining([expect.objectContaining({ id: `confirm-meal:${questionId}:yes` })]) } })
  })
})

// Report: Nov1 field: 排骨便當 confirmation -> 對，一份 was lost to menu clarification.
it('retains quantity supplied together with the affirmative meal confirmation', async () => {
  const runtime = await pendingMeal()
  const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '排骨便當' }) as Snapshot
  await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer!.id })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '對，一份' }) as Snapshot
  const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.candidates.find(choice => choice.id.endsWith(':yes'))!.id })
  expect(result).toMatchObject({ cart: { lines: [{ itemId: 'fried-pork-chop-bento', quantity: 1 }], itemCount: 1 } })
})

// Affirmative/negative interpretation must not convert a denied proposal into an order.
it('does not carry a quantity from a declined confirmation into the resumed meal', async () => {
  const runtime = await pendingMeal()
  const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '排骨便當' }) as Snapshot
  await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer!.id })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '不是，一份' }) as Snapshot
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.candidates.find(choice => choice.id.endsWith(':no'))!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'configuration', waitingFor: { question: '請問水餃要幾份？' } })
})

it('keeps the meal need after ticket expiry and gives a new answer its own lease', async () => {
  vi.useFakeTimers()
  try {
    const runtime = await pendingMeal()
    const offer = await runtime.invoke('kiosk_fast_path_context', { transcript: '牛肉麵' }) as Snapshot
    await runtime.invoke('kiosk_fast_path_clarify', { questionId: offer.clarificationOffer!.id })
    const first = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as Snapshot
    const oldChoice = first.candidates.find(choice => choice.id.endsWith(':yes'))!.id
    const progress = await runtime.invoke('kiosk_conversation_context') as { retainedRequests: Array<{ id: string, status: string }> }
    const requestId = progress.retainedRequests.find(request => request.status === 'confirming')!.id
    vi.advanceTimersByTime(31_000)
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: oldChoice })).rejects.toThrow('STALE')
    expect(await runtime.invoke('kiosk_conversation_context')).toMatchObject({ retainedRequests: expect.arrayContaining([{ ...progress.retainedRequests.find(request => request.status === 'confirming') }]) })
    const next = await runtime.invoke('kiosk_fast_path_context', { transcript: '對，兩份' }) as Snapshot
    expect(next.waitingFor.questionId).not.toBe(first.waitingFor.questionId)
    expect(next.waitingFor).toHaveProperty('requestId', requestId)
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: oldChoice })).rejects.toThrow('STALE')
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: next.candidates.find(choice => choice.id.endsWith(':yes'))!.id })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'beef-noodle-soup', quantity: 2 }] } })
  }
  finally { vi.useRealTimers() }
})

// Report: this chat Nov8 — 「不要了」 after an alternative must preserve the cart.
it.each([
  { original: '魚便當', replacement: '豬肉便當' },
  { original: '雞肉便當', replacement: '牛肉便當' },
])('declines $replacement as a replacement for $original without changing the cart', async ({ original, replacement }) => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const template = catalog.items[0]!
  const runtime = createMenuToolRuntime({ menu: [{ ...template, id: 'original', name: original, aliases: [], optionGroups: [] }, { ...template, id: 'replacement', name: replacement, aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'original', quantity: 1 })
  const before = await runtime.invoke('cart_get', { display: false }) as { cart: { lines: Array<{ id: string }> } }
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'replacement-task', transcript: `${original}換成${replacement}`, expectedMenuRevision: 0, constraints: {} })
  await runtime.invokeForAgent('menu_confirm_item', { itemId: 'replacement', replaceLineId: before.cart.lines[0]!.id })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'replacement-task' })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '不要了' }) as Snapshot
  const decline = answer.candidates.find(choice => choice.id.endsWith(':no'))!
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: decline.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'original', quantity: 1 }] } })
})

// Report: Nov09 real replay — a verified ingredient match proposed by Main
// was rejected as unsupported preparation while compiling its confirmation.
it('can propose a composition-verified dish without treating its ingredient as customization', async () => {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 3 })
  const before = await runtime.invoke('cart_get', { display: false })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'fish-proposal', transcript: '我想吃魚', expectedMenuRevision: 0, constraints: { includeIngredients: ['fish'] } })
  await runtime.invokeForAgent('menu_get', { query: '魚', display: true })
  const proposal = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'thai-sour-spicy-fish-bento' })
  expect(proposal).toHaveProperty('pendingCustomerChoice.purpose', 'confirm-meal')
  expect(await runtime.invoke('cart_get', { display: false })).toEqual(before)
})
