import { describe, expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

describe('visible ordering screen context', () => {
  it('retains actually presented item references across idle and clears them for a new order', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.invoke('menu_get', { query: '蝦捲', display: true })
      const shown = await runtime.invoke('kiosk_fast_path_context', { transcript: '這個' }) as { references: Array<{ refId: string, label: string }> }
      expect(shown.references.length).toBeGreaterThan(0)
      vi.advanceTimersByTime(300_000)
      const resumed = await runtime.invoke('kiosk_fast_path_context', { transcript: '這個' }) as { references: Array<{ refId: string, label: string }> }
      expect(resumed.references).toEqual(shown.references)
      await runtime.reset()
      expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '這個' })).toMatchObject({ references: [] })
    }
    finally { vi.useRealTimers() }
  })
  it('reads the current browser screen on each snapshot without changing the ordering phase', async () => {
    let screen: 'menu' | 'cart_review' | 'item_configuration' = 'cart_review'
    const runtime = createMenuToolRuntime({
      screen: () => screen,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '我還要點菜' })).toMatchObject({ phase: 'ordering', interactionState: { screen: 'cart_review' } })
    screen = 'menu'
    expect(await runtime.invoke('kiosk_interaction_state', {})).toMatchObject({ phase: 'ordering', interactionState: { screen: 'menu' } })
    screen = 'item_configuration'
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '改兩份' })).toMatchObject({ phase: 'ordering', interactionState: { screen: 'item_configuration' } })
  })

  it('does not invent a visible screen when no browser owner supplies it', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const snapshot = await runtime.invoke('kiosk_interaction_state', {})
    expect(snapshot).toMatchObject({ phase: 'ordering' })
    expect(snapshot).not.toHaveProperty('interactionState.screen')
  })
})
