import { expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

interface Snapshot {
  waitingFor: { question: string, choices: Array<{ id: string }> }
}

// Report: this chat, Nov5; unsupported removals require consent to the original dish.
it.each(['不要辣', '不要蔥'])('confirms the original dish before adding: %s', async (request) => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'custom', transcript: `排骨便當兩份，${request}`, expectedMenuRevision: 0, constraints: {} })
  const proposed = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true }) as { pendingCustomerChoice: Snapshot['waitingFor'] }
  expect(proposed.pendingCustomerChoice.question).toBe('目前不提供客製化服務，還要 2 份排骨便當嗎？')
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'custom' })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '好' }) as Snapshot
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.waitingFor.choices[0]!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: 'bento', quantity: 2, options: {} }] } })
})

it('does not silently add an original recipe when Main overlooks the customization', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'custom', transcript: '排骨便當一份，不要蔥', expectedMenuRevision: 0, constraints: {} })
  expect(await runtime.invokeForAgent('order_add_item', { itemId: 'bento', quantity: 1 })).toMatchObject({ pendingCustomerChoice: { purpose: 'confirm-meal' } })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('routes unsupported preparation to Main instead of losing it in a fast add', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '排骨便當一份，不要蔥' })
  expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).toMatchObject({ needsAssistant: true })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('cancels the original-recipe proposal without removing existing cart items', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'bento', quantity: 1 })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'custom', transcript: '再來排骨便當兩份，不要辣', expectedMenuRevision: 0, constraints: {} })
  await runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'custom' })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '不要了' }) as Snapshot
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.waitingFor.choices[1]!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
})

it('asks the missing quantity after accepting an original recipe, without guessing one', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'custom', transcript: '我要排骨便當，不要辣', expectedMenuRevision: 0, constraints: {} })
  expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true })).toMatchObject({ pendingCustomerChoice: { question: '目前不提供客製化服務，還要排骨便當嗎？' } })
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'custom' })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: '好' }) as Snapshot
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.waitingFor.choices[0]!.id })
  expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'configuration' })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('never converts allergy safety into an original-recipe promise', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'custom', transcript: '排骨便當一份，我對蔥過敏', expectedMenuRevision: 0, constraints: {} })
  await expect(runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true })).rejects.toThrow('preparation')
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it.each([true, false])('allows a presented original-recipe answer only in a later Main task: %s', async (accepted) => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'proposal', transcript: '排骨便當兩份，不要辣', expectedMenuRevision: 0, constraints: {} })
  const proposal = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  const question = proposal.pendingCustomerChoice
  await runtime.invoke('kiosk_dialogue_presented', { questionId: question.questionId, content: question.question })
  await expect(runtime.invokeForAgent('order_answer_confirmation', { confirmationId: question.questionId, confirmedByUser: accepted })).rejects.toThrow('STALE_PLAN')
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'proposal' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'answer', transcript: accepted ? '好，那就原本的' : '那不要了', expectedMenuRevision: 0, constraints: {} })
  await runtime.invokeForAgent('order_answer_confirmation', { confirmationId: question.questionId, confirmedByUser: accepted })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: accepted ? 2 : 0 } })
  await expect(runtime.invokeForAgent('order_answer_confirmation', { confirmationId: question.questionId, confirmedByUser: accepted })).rejects.toThrow('STALE_PLAN')
})

it.each([true, false])('handles a preparation request while answering a missing quantity: %s', async (accept) => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要排骨便當' })
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'custom', transcript: '兩份，不要辣', expectedMenuRevision: 0, constraints: {} })
  const context = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(context.allowedToolNames).toContain('menu_confirm_item')
  expect(context.allowedToolNames).not.toContain('menu_recommend')
  const proposal = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true }) as { pendingCustomerChoice: { questionId: string, question: string } }
  expect(proposal.pendingCustomerChoice.question).toContain('2 份排骨便當')
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'custom' })
  const answer = await runtime.invoke('kiosk_fast_path_context', { transcript: accept ? '好' : '不要了' }) as Snapshot
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: answer.waitingFor.choices[accept ? 0 : 1]!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: accept ? 2 : 0 } })
  expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
})

it('does not accept a model-invented serving count for a named meal', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'meal', transcript: '我要排骨便當', expectedMenuRevision: 0, constraints: {} })
  expect(await runtime.invokeForAgent('order_add_item', { itemId: 'bento', quantity: 1 })).toMatchObject({ pendingCustomerChoice: { purpose: 'item-configuration' } })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

it('does not offer original-recipe confirmation for a fresh normal meal order', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'plain', transcript: '我要排骨便當一份', expectedMenuRevision: 0, constraints: {} })
  const context = await runtime.invoke('kiosk_conversation_context') as { allowedToolNames: string[] }
  expect(context.allowedToolNames).not.toContain('menu_confirm_item')
  await expect(runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true })).rejects.toThrow('not available in the current task context')
  await runtime.invokeForAgent('order_add_item', { itemId: 'bento', quantity: 1 })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
})
