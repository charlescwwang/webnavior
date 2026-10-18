import type { PendingQuestion } from './kiosk-intents'

import { describe, expect, it } from 'vitest'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

describe('visible order actions', () => {
  // Report: this chat, 2026-10-18 — 「還要一份水餃」 adds successfully but leaves the previous dish on screen.
  it.each([
    { source: 'voice', itemId: 'dumplings', name: '水餃' },
    { source: 'agent', itemId: 'dumplings', name: '水餃' },
    { source: 'stepwise', itemId: 'dumplings', name: '水餃' },
    { source: 'voice', itemId: 'beef-noodles', name: '牛肉麵' },
    { source: 'agent', itemId: 'beef-noodles', name: '牛肉麵' },
    { source: 'stepwise', itemId: 'beef-noodles', name: '牛肉麵' },
  ] as const)('focuses newly added $name through $source while preserving the unanswered fulfillment question', async ({ source, itemId, name }) => {
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({
      menu: [
        { ...menu[0]!, id: 'pork-chop-bento', name: '炸排骨便當', aliases: [], optionGroups: [] },
        { ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [] },
        { ...menu[0]!, id: 'beef-noodles', name: '牛肉麵', aliases: [], optionGroups: [] },
      ],
      onAction: (action) => {
        if (action.targetId === itemId)
          expect(shown.at(-1)).toEqual([itemId])
      },
      onCartChange: () => {},
      onMenuSelection: () => {},
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
    expect(shown.at(-1)).toEqual([itemId])
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '這個' })).toMatchObject({ references: expect.arrayContaining([expect.objectContaining({ label: `剛展示的${name}` })]) })
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
    expect(events).toEqual(['review', 'cursor:order:fulfillment:dine-in'])
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
