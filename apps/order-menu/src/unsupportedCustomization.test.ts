import { expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// Report: this chat, Nov08; unrelated size options do not authorize spice/ingredient edits.
it.each(['蒜', '香菜'])('does not let Main overlook an unavailable adjustment when another option exists: %s', async (adjustment) => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'meal', name: '菇菇飯', aliases: [], optionGroups: [{ id: 'size', label: '份量', required: true, values: [{ id: 'small', label: '小份', priceDelta: 0 }] }] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'partial', transcript: `菇菇飯兩份不要${adjustment}`, expectedMenuRevision: 0, constraints: {} })
  const result = await runtime.invokeForAgent('order_add_item', { itemId: 'meal', quantity: 2, options: [{ groupId: 'size', valueId: 'small' }] })
  expect(result).toMatchObject({ pendingCustomerChoice: { question: `這道餐點不提供${adjustment}調整，還要點嗎？` } })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

interface Snapshot {
  waitingFor: { question: string, choices: Array<{ id: string }> }
}

// Report: this chat, Nov08 — a missing dish must be resolved before preparation requests.
it.each([
  { id: 'noodles', name: '鱔魚炒麵', query: '鱔魚意麵', request: '鱔魚意麵兩份不要辣不要香菜' },
  { id: 'rice', name: '香菇雞便當', query: '香菇雞腿便當', request: '香菇雞腿便當兩份不要蒜' },
])('confirms the alternative identity before its unsupported preparation: $name', async ({ id, name, query, request }) => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id, name, aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'identity-first', transcript: request, expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  expect(await runtime.invokeForAgent('menu_get', { query })).toMatchObject({ possibleItems: [{ id }] })
  await runtime.invoke('kiosk_conversation_context')
  const identity = await runtime.invokeForAgent('menu_confirm_item', { itemId: id }) as { pendingCustomerChoice: Snapshot['waitingFor'] }
  expect(identity.pendingCustomerChoice.question).toContain(name)
  expect(identity.pendingCustomerChoice.question).not.toContain('客製')
  await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'identity-first' })
  const yes = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as Snapshot
  const preparation = await runtime.invoke('kiosk_fast_path_execute', { candidateId: yes.waitingFor.choices[0]!.id })
  expect(preparation).toMatchObject({ pendingCustomerChoice: { question: '這道餐點不提供客製化，還要點嗎？' } })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  const accepted = await runtime.invoke('kiosk_fast_path_context', { transcript: '好' }) as Snapshot
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: accepted.waitingFor.choices[0]!.id })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 2, lines: [{ itemId: id, quantity: 2 }] } })
})

// Report: this chat, Nov5; unsupported removals require consent to the original dish.
it.each(['不要辣', '不要蔥'])('confirms the original dish before adding: %s', async (request) => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'bento', name: '排骨便當', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'custom', transcript: `排骨便當兩份，${request}`, expectedMenuRevision: 0, constraints: {} })
  const proposed = await runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true }) as { pendingCustomerChoice: Snapshot['waitingFor'] }
  expect(proposed.pendingCustomerChoice.question).toBe('這道餐點不提供客製化，還要點嗎？')
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
  expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'bento', originalRecipe: true })).toMatchObject({ pendingCustomerChoice: { question: '這道餐點不提供客製化，還要點嗎？' } })
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
  expect(proposal.pendingCustomerChoice.question).toBe('這道餐點不提供客製化，還要點嗎？')
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

// Report: this chat, Nov5; selecting a dish with no options must not announce nonexistent settings.
it.each(['紅燒牛肉麵', '排骨便當', '水餃'])('asks about adding the named dish without a settings receipt: %s', async (name) => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dish', name, aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const selected = await runtime.invoke('menu_select_item', { itemId: 'dish' })
  expect(selected).toHaveProperty('customerMessage', expect.stringContaining('幾份'))
  expect(selected).toHaveProperty('pendingCustomerChoice.purpose', 'item-order')
  expect(selected).toHaveProperty('customerMessage', expect.not.stringContaining('設定'))
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'custom', transcript: `我要${name}，不要蔥`, expectedMenuRevision: 0, constraints: {} })
  expect(await runtime.invokeForAgent('menu_confirm_item', { itemId: 'dish', originalRecipe: true })).toMatchObject({ pendingCustomerChoice: { question: '這道餐點不提供客製化，還要點嗎？' } })
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
})

// Report: this chat, Nov08 — a plausible alternative without a Menu candidate is not verified identity.
it('does not invent a preparation proposal when the named lookup has no verified alternative', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'rice', name: '香菇雞飯', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'no-alternative', transcript: '香菇雞便當兩份不要蒜', expectedMenuRevision: 0, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  expect(await runtime.invokeForAgent('menu_get', { query: '香菇雞便當' })).toMatchObject({ items: [], matchKind: 'none' })
  await runtime.invoke('kiosk_conversation_context')
  await expect(runtime.invokeForAgent('menu_confirm_item', { itemId: 'rice' })).rejects.toThrow()
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})
