import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'
import type { CartSnapshot } from './domain/order-machine'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const dishes = [
  { ...menu[0]!, id: 'pork-bento', name: '炸排骨便當', aliases: ['排骨便當'], optionGroups: [] },
  { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [] },
]

// Report: this chat, Nov08; generalization must distinguish a decrement from an absolute count.
it.each([
  { item: { ...dishes[0]!, id: 'rice', name: '雞肉飯', category: '飯', price: 95 }, speech: '少一份', expected: 3 },
  { item: { ...dishes[1]!, id: 'noodles', name: '蔬菜麵', category: '麵', price: 120 }, speech: '減兩份', expected: 2 },
  { item: { ...dishes[0]!, id: 'rice', name: '雞肉飯', category: '飯', price: 95 }, speech: '改成一份', expected: 1 },
  { item: { ...dishes[1]!, id: 'noodles', name: '蔬菜麵', category: '麵', price: 120 }, speech: '多一份', expected: 5 },
])('resolves $speech against the current quantity of $item.name', async ({ item, speech, expected }) => {
  const runtime = createMenuToolRuntime({ menu: [item], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: item.id, quantity: 4 })
  await runtime.invoke('kiosk_fast_path_context', { transcript: `${item.name}${speech}` })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-quantity' })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: expected, lines: [{ itemId: item.id, quantity: expected }] } })
})

describe('cart meal-change diagnosis', () => {
  it('keeps a host-bound menu inquiry read-only until the next customer task', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 1 })
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
    const state = await runtime.invoke('kiosk_interaction_state') as KioskDecisionState
    await runtime.invoke('kiosk_agent_task', { taskId: 'menu-inquiry', action: 'BEGIN', transcript: '查詢餐點', expectedMenuRevision: state.menuRevision, readOnly: true, constraints: {} })
    await runtime.invokeForAgent('menu_get', { query: '水餃' })
    const snapshot = await runtime.invokeForAgent('cart_get')
    expect(snapshot).toEqual({ cart: before.cart, dataOnly: true })
    expect(snapshot).not.toHaveProperty('pendingCustomerChoice')
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 1 })).rejects.toThrow('only authorizes menu reads')
    await expect(runtime.invokeForAgent('cart_remove_item', { lineId: before.cart.lines[0]!.id })).rejects.toThrow('only authorizes menu reads')
    await expect(runtime.invokeForAgent('order_set_fulfillment', { mode: 'takeout' })).rejects.toThrow('only authorizes menu reads')
    await expect(runtime.invokeForAgent('order_defer_question')).rejects.toThrow('only authorizes menu reads')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
    await runtime.invoke('kiosk_agent_task', { taskId: 'menu-inquiry', action: 'END' })
    await runtime.invoke('kiosk_agent_task', { taskId: 'new-purchase', action: 'BEGIN', transcript: '水餃一份', expectedMenuRevision: state.menuRevision, constraints: {} })
    await runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', quantity: 1 })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
  })

  it.each([{ query: '披薩' }, { queries: ['披薩', '水餃'] }, { query: '售完餐點' }])('preserves the cart after an unresolved named lookup %j until a new customer task', async (query) => {
    const runtime = createMenuToolRuntime({ menu: [...dishes, { ...dishes[0]!, id: 'sold-out', name: '售完餐點', available: false }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 1 })
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '排骨便當改披薩' }) as KioskDecisionState
    await runtime.invoke('kiosk_agent_task', { taskId: 'missing-target', action: 'BEGIN', transcript: '查詢餐點', expectedMenuRevision: context.menuRevision, constraints: {} })
    await runtime.invokeForAgent('menu_get', query)
    expect(await runtime.invokeForAgent('cart_remove_item', { lineId: before.cart.lines[0]!.id })).toMatchObject({ ok: false, customerMessage: expect.stringContaining('保留') })
    expect(await runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', replaceLineId: before.cart.lines[0]!.id })).toMatchObject({ ok: false })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
    // A later successful lookup cannot silently substitute a different target
    // within this request. A fresh customer task restores ordinary authority.
    await runtime.invokeForAgent('menu_get', { query: '水餃' })
    expect(await runtime.invokeForAgent('cart_clear')).toMatchObject({ ok: false })
    await runtime.invoke('kiosk_agent_task', { taskId: 'missing-target', action: 'END' })
    await runtime.invoke('kiosk_agent_task', { taskId: 'explicit-removal', action: 'BEGIN', transcript: '查詢餐點', expectedMenuRevision: context.menuRevision, constraints: {} })
    await runtime.invokeForAgent('cart_remove_item', { lineId: before.cart.lines[0]!.id })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [] } })
  })

  it('does not apply an older lookup failure to a successor Agent task', async () => {
    let replaceTask = false
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onMenuPresentationActivity: async (event) => {
      if (event.state === 'idle' && replaceTask) {
        replaceTask = false
        await runtime.invoke('kiosk_agent_task', { taskId: 'old-lookup', action: 'END' })
        const state = await runtime.invoke('kiosk_interaction_state') as KioskDecisionState
        await runtime.invoke('kiosk_agent_task', { taskId: 'new-removal', action: 'BEGIN', transcript: '查詢餐點', expectedMenuRevision: state.menuRevision, constraints: {} })
      }
    } })
    await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 1 })
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
    const state = await runtime.invoke('kiosk_interaction_state') as KioskDecisionState
    await runtime.invoke('kiosk_agent_task', { taskId: 'old-lookup', action: 'BEGIN', transcript: '查詢餐點', expectedMenuRevision: state.menuRevision, constraints: {} })
    replaceTask = true
    await runtime.invokeForAgent('menu_get', { query: '披薩' })
    await runtime.invokeForAgent('cart_remove_item', { lineId: before.cart.lines[0]!.id })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [] } })
  })

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
  it('hands off 改水餃一份 after ordering 排骨便當一份 without executing a partial addition', async () => {
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
      invoke: async (_state, questions) => questions.requestPurpose
        ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
        : questions.route
          ? { answers: { route: { type: 'choice', choice: 'intent:add-item', confidence: 0.6223 } } }
          : questions.service
            ? { answers: { service: { type: 'choice', choice: 'REQUEST', confidence: 0.95 } } }
            : { answers: { cartRequest: { type: 'choice', choice: 'HANDOFF', confidence: 0.95 } } },
      policy: { decisionInstruction: '', storeInstruction: '' },
    })
    expect(decision).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(decision).not.toHaveProperty('answeredQuestionId')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'pork-bento', quantity: 1 }] } })
  })
})

describe('complete cart replacement', () => {
  it('replaces a real line in one cart update and retains its quantity when omitted', async () => {
    const onCartChange = vi.fn()
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 2 }) as { line: { id: string } }
    onCartChange.mockClear()
    const result = await runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', replaceLineId: original.line.id })
    expect(result).toMatchObject({ replacedLine: { id: original.line.id, itemId: 'pork-bento', quantity: 2 }, cart: { itemCount: 2, lines: [{ itemId: 'dumplings', quantity: 2 }] } })
    expect(onCartChange).toHaveBeenCalledTimes(1)
    expect(onCartChange.mock.calls[0]![0].lines).toHaveLength(1)
  })

  it.each(['unknown', 'unavailable', 'selection-failure', 'required-option', 'invalid-option', 'quantity'])('preserves the original cart when replacement fails: %s', async (failure) => {
    const replacement = { ...dishes[1]!, available: failure !== 'unavailable', ...(failure === 'selection-failure' ? { pageState: 'selection-failure' as const } : {}), optionGroups: failure === 'required-option' || failure === 'invalid-option' ? [{ id: 'sauce', label: '醬料', required: true, values: [{ id: 'soy', label: '醬油', priceDelta: 0 }] }] : [] }
    const onCartChange = vi.fn()
    const runtime = createMenuToolRuntime({ menu: [dishes[0]!, replacement], onAction: () => {}, onCartChange, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 2 }) as { line: { id: string } }
    const before = await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }
    onCartChange.mockClear()
    await expect(runtime.invokeForAgent('order_add_item', { itemId: failure === 'unknown' ? 'missing-dish' : 'dumplings', replaceLineId: original.line.id, ...(failure === 'invalid-option' ? { options: [{ groupId: 'sauce', valueId: 'missing' }] } : {}), ...(failure === 'quantity' ? { quantity: 0 } : {}) })).rejects.toThrow()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: before.cart })
    expect(onCartChange).not.toHaveBeenCalled()
  })

  it('merges the replacement into an existing equivalent line without disturbing other meals', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 2 }) as { line: { id: string } }
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    const result = await runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', replaceLineId: original.line.id, quantity: 3 })
    expect(result).toMatchObject({ cart: { itemCount: 4, lines: [{ itemId: 'dumplings', quantity: 4 }] } })
    expect((result as { cart: CartSnapshot }).cart.lines).toHaveLength(1)
  })

  it('does not replace an arbitrarily chosen variant of a meal with multiple cart lines', async () => {
    const originalMeal = { ...dishes[0]!, optionGroups: [{ id: 'sauce', label: '醬料', required: true, values: [{ id: 'soy', label: '醬油', priceDelta: 0 }, { id: 'chili', label: '辣醬', priceDelta: 0 }] }] }
    const runtime = createMenuToolRuntime({ menu: [originalMeal, dishes[1]!], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'pork-bento', options: [{ groupId: 'sauce', valueId: 'soy' }] }) as { line: { id: string } }
    await runtime.invoke('order_add_item', { itemId: 'pork-bento', options: [{ groupId: 'sauce', valueId: 'chili' }] })
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', replaceLineId: original.line.id })).rejects.toThrow('TARGET_MISSING')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'pork-bento', options: { sauce: 'soy' } }, { itemId: 'pork-bento', options: { sauce: 'chili' } }] } })
  })

  it('rejects cart changes during the replacement animation before committing another mutation', async () => {
    let mutateDuringAnimation = false
    let originalId = ''
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: async (action) => {
      if (mutateDuringAnimation && action.label === '加入購物車') {
        mutateDuringAnimation = false
        await runtime.invoke('cart_set_line_quantity', { lineId: originalId, quantity: 3 })
      }
    }, onCartChange: () => {}, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'pork-bento', quantity: 2 }) as { line: { id: string } }
    originalId = original.line.id
    mutateDuringAnimation = true
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', replaceLineId: originalId })).rejects.toThrow('STALE_PLAN')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3, lines: [{ id: originalId, itemId: 'pork-bento', quantity: 3 }] } })
  })

  it('rejects a stale original line without turning the replacement into an extra order', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const original = await runtime.invoke('order_add_item', { itemId: 'pork-bento' }) as { line: { id: string } }
    await runtime.invoke('cart_remove_item', { lineId: original.line.id })
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'dumplings', replaceLineId: original.line.id })).rejects.toThrow()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [], itemCount: 0 } })
  })
})
