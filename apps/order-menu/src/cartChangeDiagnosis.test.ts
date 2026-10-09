import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'

import { describe, expect, it } from 'vitest'

import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const dishes = [
  { ...menu[0]!, id: 'pork-bento', name: '炸排骨便當', aliases: ['排骨便當'], optionGroups: [] },
  { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [] },
]

describe('cart meal-change diagnosis', () => {
  it('authorizes the recorded addition without checking whether it replaces the prior cart meal', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 1 })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '改水餃一份' }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    expect(context.candidates.some(choice => choice.id === 'intent:add-item')).toBe(true)
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    expect(result).toMatchObject({ decisionTrace: { authorize: { kind: 'EXECUTE' }, operationPlan: { intent: 'ADD_ITEM', input: { itemId: 'dumplings', quantity: 1 } } } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'pork-bento', quantity: 1 }, { itemId: 'dumplings', quantity: 1 }] } })
  })
  it('supports a quantity edit of an existing named meal, unlike replacing it with a different meal', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 1 })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '排骨便當改兩份' })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-quantity' })
    expect(result).toMatchObject({ decisionTrace: { operationPlan: { intent: 'SET_QUANTITY', toolName: 'cart_set_line_quantity' } } })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'pork-bento', quantity: 2 }] } })
  })
  // Local replay of attachment addd9b21's observed decision, not a live model
  // accuracy test. No customer dialogue or identifiers are sent to a provider.
  it.skipIf(process.env.KIOSK_CART_CHANGE_DIAGNOSIS !== '1')('does not silently add a second meal for 改水餃一份 after ordering 排骨便當一份', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const first = await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 1 }) as { pendingCustomerChoice: { question: string, questionId: string } }
    await runtime.invoke('kiosk_dialogue_presented', { content: first.pendingCustomerChoice.question, questionId: first.pendingCustomerChoice.questionId })
    const transcript = '改水餃一份'
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    expect(snapshot).toMatchObject({ productResolution: { status: 'exact', count: 1 }, waitingFor: { purpose: 'fulfillment' } })
    const decision = await decideInteraction({
      candidates: snapshot.candidates,
      decisionState: snapshot,
      conversation: { messages: [{ role: 'user', content: '排骨便當一份' }, { role: 'assistant', content: '已將炸排骨便當加入購物車，共 1 份。請問要內用還是自取？' }] },
      transcript,
      invoke: async () => ({ answers: { route: { type: 'choice', choice: 'intent:add-item', confidence: 0.6223 } } }),
      policy: { decisionInstruction: '', storeInstruction: '' },
    })
    expect(decision.kind).toBe('FAST_ACTION')
    if (decision.kind !== 'FAST_ACTION')
      throw new Error(JSON.stringify(decision))
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId })
    expect(await runtime.invoke('cart_get', { display: false })).not.toMatchObject({ cart: { lines: [{ itemId: 'pork-bento' }, { itemId: 'dumplings' }] } })
  })
})
