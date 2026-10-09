import { describe, expect, it } from 'vitest'

import { beginCheckout } from './domain/checkout-flow'
import { createMenuToolRuntime } from './webmcp'

describe('bounded menu viewport navigation', () => {
  it('rejects viewport navigation after checkout starts without dispatching browser movement', async () => {
    let moved = false
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onMenuScroll: () => {
        moved = true
        return { status: 'BOUNDARY', position: 0 }
      },
      checkout: {
        snapshot: () => beginCheckout(),
        revision: () => 1,
        paymentStatus: () => undefined,
        assertCanRestart: () => {},
        restart: () => {},
        cancel: () => {},
        start: () => { throw new Error('Unexpected checkout write') },
        skipMembership: () => { throw new Error('Unexpected checkout write') },
        chooseInvoice: () => { throw new Error('Unexpected checkout write') },
        requestTaxId: () => { throw new Error('Unexpected checkout write') },
        setTaxId: () => { throw new Error('Unexpected checkout write') },
        confirmTaxId: () => { throw new Error('Unexpected checkout write') },
        selectPayment: async () => { throw new Error('Unexpected payment write') },
      },
    })
    await expect(runtime.invokeForAgent('menu_scroll', { direction: 'DOWN' })).rejects.toThrow('INVALID_PHASE')
    expect(moved).toBe(false)
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '往下看' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.some(candidate => candidate.id.startsWith('intent:scroll-menu'))).toBe(false)
  })
  it('offers finite directions only when the browser supplies scrolling and dispatches the authorized choice', async () => {
    const directions: string[] = []
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onMenuScroll: (direction) => {
        directions.push(direction)
        return { status: 'MOVED', position: 800 }
      },
    })
    expect(runtime.toolDefinitions.find(tool => tool.name === 'menu_scroll')?.inputSchema).toMatchObject({ required: ['direction'], properties: { direction: { enum: ['UP', 'DOWN'] } } })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '往下看' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.map(candidate => candidate.id)).toContain('intent:scroll-menu:down')
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:scroll-menu:down' })).toMatchObject({ status: 'MOVED' })
    expect(directions).toEqual(['DOWN'])
    await expect(runtime.invokeForAgent('menu_scroll', { direction: 'NEXT' })).rejects.toThrow('INVALID_SLOTS')
    const headless = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(headless.toolDefinitions.some(tool => tool.name === 'menu_scroll')).toBe(false)
  })
})
