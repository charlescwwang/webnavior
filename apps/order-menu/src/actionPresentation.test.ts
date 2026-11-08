import type { PendingQuestion } from './kiosk-intents'

import { describe, expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

describe('visible order actions', () => {
  it('reveals and animates the exact removed line before returning to the menu', async () => {
    const events: string[] = []
    const runtime = createMenuToolRuntime({
      onAction: (action) => { events.push(`cursor:${action.controlId ?? action.targetId}`) },
      onReviewRequested: () => { events.push('review') },
      onMenuRequested: () => { events.push('menu') },
      onMenuSelection: () => {},
      onCartChange: () => { events.push('cart') },
    })
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { line: { id: string } }
    events.length = 0
    await runtime.invoke('cart_remove_item', { lineId: added.line.id })
    expect(events).toEqual(['cursor:order:view', 'review', `cursor:cart:remove:${encodeURIComponent(added.line.id)}`, 'cart', 'menu'])
  })
  // Report: this chat, 2026-10-18 — 「還要一份水餃」 adds successfully but leaves the previous dish on screen.
  it.each([
    { source: 'voice', itemId: 'dumplings', name: '水餃' },
    { source: 'agent', itemId: 'dumplings', name: '水餃' },
    { source: 'stepwise', itemId: 'dumplings', name: '水餃' },
    { source: 'voice', itemId: 'beef-noodles', name: '牛肉麵' },
    { source: 'agent', itemId: 'beef-noodles', name: '牛肉麵' },
    { source: 'stepwise', itemId: 'beef-noodles', name: '牛肉麵' },
  ] as const)('closes newly added $name through $source while preserving the menu and unanswered fulfillment question', async ({ source, itemId, name }) => {
    const shown: string[][] = []
    let visibleItemId: string | undefined
    const runtime = createMenuToolRuntime({
      menu: [
        { ...menu[0]!, id: 'pork-chop-bento', name: '炸排骨便當', aliases: [], optionGroups: [] },
        { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [] },
        { ...menu[0]!, id: 'beef-noodles', name: '牛肉麵', aliases: [], optionGroups: [] },
      ],
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: (id) => { visibleItemId = id },
      onRecommendationsChange: presentation => shown.push(presentation.itemIds),
    })
    await runtime.invoke('menu_get', { query: '炸排骨便當', display: true })
    const first = await runtime.invoke('order_add_item', { itemId: 'pork-chop-bento', quantity: 2 }) as { pendingCustomerChoice: PendingQuestion }
    await runtime.invoke('kiosk_dialogue_presented', { questionId: first.pendingCustomerChoice.questionId, content: first.pendingCustomerChoice.question })
    if (source === 'voice') {
      await runtime.invoke('kiosk_fast_path_context', { transcript: `還要一份${name}` })
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    }
    else if (source === 'agent') {
      await runtime.invokeForAgent('order_add_item', { itemId, quantity: 1 })
    }
    else {
      await runtime.invokeForAgent('menu_select_item', { itemId })
      await runtime.invokeForAgent('menu_set_quantity', { quantity: 1 })
      await runtime.invokeForAgent('cart_add_item')
    }
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3, lines: [{ itemId: 'pork-chop-bento', quantity: 2 }, { itemId, quantity: 1 }] } })
    expect(visibleItemId).toBeUndefined()
    expect(shown).toEqual([['pork-chop-bento']])
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '內用' })).toMatchObject({ waitingFor: { purpose: 'fulfillment' } })
  })

  it('moves to the order button before opening review to choose fulfillment', async () => {
    const events: string[] = []
    const runtime = createMenuToolRuntime({
      onAction: (action) => { events.push(`cursor:${action.controlId ?? action.targetId}`) },
      onReviewRequested: () => { events.push('review') },
      onMenuSelection: () => {},
      onCartChange: () => {},
    })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    events.length = 0
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    expect(events).toEqual(['cursor:order:view', 'review', 'cursor:order:fulfillment:takeout'])
  })

  it('does not reopen review or animate a hidden order button when review is already visible', async () => {
    const events: string[] = []
    const runtime = createMenuToolRuntime({
      screen: () => 'cart_review',
      onAction: (action) => { events.push(`cursor:${action.controlId ?? action.targetId}`) },
      onReviewRequested: () => { events.push('review') },
      onMenuSelection: () => {},
      onCartChange: () => {},
    })
    await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
    expect(events).toEqual(['cursor:order:fulfillment:dine-in'])
  })

  it('keeps the cart intact if the exact removal presentation fails', async () => {
    const runtime = createMenuToolRuntime({ onAction: (action) => {
      if (action.controlId?.startsWith('cart:remove:'))
        throw new Error('Missing removal control')
    }, onCartChange: () => {}, onMenuSelection: () => {} })
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { line: { id: string } }
    await expect(runtime.invoke('cart_remove_item', { lineId: added.line.id })).rejects.toThrow('Missing removal control')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1 } })
  })

  it('preserves the accepted removal receipt if returning to the menu fails', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onMenuRequested: () => {
      throw new Error('Unavailable screen')
    } })
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { line: { id: string } }
    expect(await runtime.invoke('cart_remove_item', { lineId: added.line.id })).toMatchObject({ presentationFailed: true, outcome: { status: 'completed', intent: 'REMOVE_ITEM' }, cart: { itemCount: 0 } })
  })

  it('releases a completed compound removal even when its final menu transition fails', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onMenuRequested: () => {
      throw new Error('Unavailable screen')
    } })
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { line: { id: string } }
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'remove', transcript: '蝦捲不要了', expectedMenuRevision: 0, constraints: {} })
    expect(await runtime.invokeForAgent('cart_remove_item', { lineId: added.line.id })).toMatchObject({ outcome: { status: 'completed' } })
    expect(await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'remove' })).toMatchObject({ ok: true, presentationFailed: true })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    expect(await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'remove' })).toEqual({ ok: true })
  })

  it.each(['checkout', 'menu'] as const)('preserves %s during a data-only cart read', async (screen) => {
    const events: string[] = []
    const runtime = createMenuToolRuntime({
      screen: () => screen,
      onAction: () => { events.push('cursor') },
      onReviewRequested: () => { events.push('review') },
      onMenuSelection: () => {},
      onCartChange: () => {},
    })
    await runtime.invoke('cart_get', screen === 'checkout' ? {} : { display: false })
    expect(events).toEqual([])
  })
})
