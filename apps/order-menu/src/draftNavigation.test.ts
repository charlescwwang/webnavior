import { expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { closeItemControlId, createMenuToolRuntime } from './webmcp'

// Report: this chat, Nov08 — switching surfaces must not silently discard an unadded meal.
it.each(['cart', 'fulfillment'] as const)('asks before cancelling a draft to switch %s, then clicks close before navigating', async (destination) => {
  let visibleItemId: string | undefined
  const actions: string[] = []
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, optionGroups: [] }], visibleItemId: () => visibleItemId, onMenuSelection: (id) => {
    visibleItemId = id
  }, onCartChange: () => {}, onReviewRequested: () => {
    actions.push('review')
  }, onAction: (action) => {
    actions.push(action.controlId ?? '')
  } })
  await runtime.invoke('kiosk_fast_path_context', { transcript: `我要${menu[0]!.name}` })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  actions.length = 0
  const name = destination === 'cart' ? 'cart_get' : 'order_set_fulfillment'
  const result = await runtime.invoke(name, destination === 'cart' ? { display: true } : { mode: 'takeout' }) as { pendingCustomerChoice: { questionId: string, question: string, choices: Array<{ id: string }> } }
  expect(result.pendingCustomerChoice.question).toContain('先完成')
  expect(visibleItemId).toBe(menu[0]!.id)
  expect(actions).toEqual([])
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '取消這道再切換' }) as { waitingFor: { choices: Array<{ id: string }> } }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.waitingFor.choices[1]!.id })
  expect(actions[0]).toBe(closeItemControlId(menu[0]!.id))
  expect(actions).toContain('review')
  expect(visibleItemId).toBeUndefined()
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0, ...(destination === 'fulfillment' ? { fulfillmentMode: 'takeout' } : {}) } })
})

// Report: this chat, Nov08 — choosing to finish is not consent to a default serving.
it('waits for the actual quantity and add before executing the deferred cart display', async () => {
  let visibleItemId: string | undefined
  let reviewCount = 0
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, optionGroups: [] }], visibleItemId: () => visibleItemId, onMenuSelection: (id) => {
    visibleItemId = id
  }, onCartChange: () => {}, onReviewRequested: () => {
    reviewCount++
  }, onAction: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: `我要${menu[0]!.name}` })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  await runtime.invoke('cart_get', { display: true })
  const choice = await runtime.invoke('kiosk_fast_path_context', { transcript: '先完成這道' }) as { waitingFor: { choices: Array<{ id: string }> } }
  expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.waitingFor.choices[0]!.id })).toMatchObject({ pendingCustomerChoice: { purpose: 'item-configuration' } })
  expect(reviewCount).toBe(0)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '兩份' }) as { candidates: Array<{ id: string }> }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.candidates.find(choice => choice.id.includes(':quantity:2'))!.id })
  expect(reviewCount).toBe(1)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2 } })
  await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.waitingFor.choices[0]!.id })).rejects.toThrow('STALE_PLAN')
})

it('revokes the deferred switch when a manual close cancels its meal', async () => {
  let visibleItemId: string | undefined
  let reviewCount = 0
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, optionGroups: [] }], visibleItemId: () => visibleItemId, onMenuSelection: (id) => {
    visibleItemId = id
  }, onCartChange: () => {}, onReviewRequested: () => {
    reviewCount++
  }, onAction: () => {} })
  await runtime.invokeManual('menu_select_item', { itemId: menu[0]!.id })
  await runtime.invoke('cart_get', { display: true })
  const choice = await runtime.invoke('kiosk_fast_path_context', { transcript: '先完成' }) as { waitingFor: { choices: Array<{ id: string }> } }
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: choice.waitingFor.choices[0]!.id })
  expect(runtime.closeSelection(menu[0]!.id)).toBe(true)
  await runtime.invokeManual('menu_select_item', { itemId: menu[0]!.id })
  await runtime.invokeManual('cart_add_item')
  expect(reviewCount).toBe(0)
})

// Report: this chat, Nov08 — Main cannot answer its own newly created choice.
it('requires a presented choice and a later Main task before accepting cancel-and-switch', async () => {
  let visibleItemId: string | undefined
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, optionGroups: [] }], visibleItemId: () => visibleItemId, onMenuSelection: (id) => {
    visibleItemId = id
  }, onCartChange: () => {}, onReviewRequested: () => {}, onAction: () => {} })
  await runtime.invokeManual('menu_select_item', { itemId: menu[0]!.id })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'proposing', transcript: '查看購物車', expectedMenuRevision: 0, constraints: {} })
  const proposed = await runtime.invokeForAgent('cart_get', { display: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  await runtime.invoke('kiosk_dialogue_presented', { content: proposed.pendingCustomerChoice.question, questionId: proposed.pendingCustomerChoice.questionId })
  const ownContext = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(ownContext.allowedToolNames).not.toContain('order_answer_confirmation')
  await expect(runtime.invokeForAgent('order_answer_confirmation', { confirmationId: proposed.pendingCustomerChoice.questionId, confirmedByUser: false })).rejects.toThrow('not available in the current task context')
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'proposing' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'answering', transcript: '取消再看購物車', expectedMenuRevision: 0, constraints: {} })
  const answerContext = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(answerContext.allowedToolNames).toContain('order_answer_confirmation')
  await runtime.invokeForAgent('order_answer_confirmation', { confirmationId: proposed.pendingCustomerChoice.questionId, confirmedByUser: false })
  expect(visibleItemId).toBeUndefined()
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})
