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
    { transcript: '酸辣魚便當', label: '泰式酸辣魚便當' },
    { transcript: '招牌便當', label: '周氏蝦捲招牌便當' },
    { transcript: '炸排骨便當', label: '炸排骨便當' },
  ])('confirms $transcript using the real catalog rather than a dish-specific phrase rule', async ({ transcript, label }) => {
    const runtime = await pendingMeal()
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as Snapshot
    expect(snapshot.clarificationOffer).toMatchObject({ label })
    const response = await runtime.invoke('kiosk_fast_path_clarify', { questionId: snapshot.clarificationOffer!.id })
    expect(response).toMatchObject({ customerMessage: `您是要點${label}嗎？` })
  })

  it.each(['便當', '恐龍披薩', '牛肉麵和水餃', '100元以下的餐點', '牛肉麵100元以下', '素食牛肉麵', '不要豬肉的牛肉麵', '略過電話', '你是誰', '手機載具', 'LINE Pay'])('does not invent a single-dish confirmation for %s', async (transcript) => {
    const runtime = await pendingMeal()
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript })).not.toHaveProperty('clarificationOffer')
  })
  it('confirms one dish, adds its requested quantity, then resumes the previous unadded meal', async () => {
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
    expect(result).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup', quantity: 1 }] }, pendingCustomerChoice: { question: '請問水餃要幾份？' } })
    const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as Snapshot
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: resumed.candidates.find(choice => choice.description.includes('2 份'))!.id })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3, lines: [{ itemId: 'beef-noodle-soup' }, { itemId: 'dumplings', quantity: 2 }] } })
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
