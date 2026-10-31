import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30 addition.
it.each(['unique', 'none', 'multiple', 'late-read', 'different-item', 'acknowledgement'] as const)('binds only a unique pre-task domain target: %s', async (scenario) => {
  const runtime = createMenuToolRuntime({ menu: [
    { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], category: '點心', optionGroups: [] },
    { ...menu[0]!, id: 'noodles', name: '牛肉麵', aliases: [], category: '麵食', optionGroups: [] },
  ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  if (scenario === 'unique' || scenario === 'different-item' || scenario === 'acknowledgement')
    await runtime.invoke('menu_get', { query: '水餃' })
  if (scenario === 'multiple')
    await runtime.invoke('menu_get', { queries: ['水餃', '牛肉麵'] })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'reference', transcript: scenario === 'acknowledgement' ? '對' : '那我要三份', expectedMenuRevision: before.revisions.menu, constraints: {} })
  await runtime.invoke('kiosk_conversation_context')
  if (scenario === 'late-read')
    await runtime.invokeForAgent('menu_get', { query: '水餃' })
  if (scenario === 'different-item')
    await runtime.invokeForAgent('menu_get', { query: '牛肉麵' })
  await runtime.invoke('kiosk_conversation_context')
  const result = await runtime.invokeForAgent('order_add_item', { itemId: scenario === 'different-item' ? 'noodles' : 'dumplings', quantity: 3 })
  if (scenario === 'unique') {
    expect(result).not.toHaveProperty('ok', false)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3, lines: [{ itemId: 'dumplings', quantity: 3 }] } })
  }
  else {
    expect(result).toMatchObject({ ok: false })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }
})
