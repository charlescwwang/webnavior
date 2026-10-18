import { describe, expect, it } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

describe('kiosk customer entry and seating capabilities', () => {
  it('can browse and recommend food during optional phone entry without silently skipping or writing an order', async () => {
    let ready = false
    const runtime = createMenuToolRuntime({
      orderingReady: () => ready,
      onCustomerEntrySkipped: () => ready = true,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    const menu = await runtime.invokeForAgent('menu_get', { display: true }) as { items: unknown[] }
    expect(menu.items.length).toBeGreaterThan(0)
    const lookup = await runtime.invokeForAgent('menu_get', { query: '周氏蝦捲', display: true }) as { items: Array<{ id: string }> }
    expect(lookup.items.map(item => item.id)).toContain('chous-shrimp-roll')
    const recommendations = await runtime.invokeForAgent('menu_recommend', {}) as { items: Array<{ id: string }> }
    expect(recommendations.items.length).toBeGreaterThan(0)
    await runtime.invokeForAgent('menu_show_recommendations', { itemIds: recommendations.items.map(item => item.id) })
    expect(ready).toBe(false)
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'customer_entry' })
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'chous-shrimp-roll', quantity: 1 })).rejects.toThrow('INVALID_PHASE')
  })

  it('delegates entry presentation without unlocking ordering or exposing a model capability', async () => {
    let hostView = false
    const runtime = createMenuToolRuntime({
      orderingReady: () => false,
      onCustomerEntryRequested: () => hostView = true,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    expect(await runtime.invoke('kiosk_customer_entry_start', {})).toMatchObject({ phase: 'customer_entry' })
    expect(hostView).toBe(true)
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'customer_entry' })
    await expect(runtime.invokeManual('order_add_item', { itemId: 'chous-shrimp-roll' })).rejects.toThrow('手機號碼')
    await expect(runtime.invokeForAgent('kiosk_customer_entry_start', {})).rejects.toThrow('unavailable to the Agent')
  })
  it('accepts a manually entered phone only through the host capability, without exposing it in decision state', async () => {
    let phone: string | undefined
    const runtime = createMenuToolRuntime({
      orderingReady: () => phone !== undefined,
      onCustomerPhoneProvided: value => phone = value,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await expect(runtime.invoke('kiosk_customer_phone', { phone: '123' })).rejects.toThrow()
    expect(phone).toBeUndefined()
    await expect(runtime.invokeForAgent('kiosk_customer_phone', { phone: '0900000000' })).rejects.toThrow('unavailable to the Agent')
    expect(await runtime.invoke('kiosk_customer_phone', { phone: '0900000000' })).toMatchObject({ customerMessage: expect.any(String) })
    expect(phone).toBe('0900000000')
    const snapshot = await runtime.invoke('kiosk_interaction_state')
    expect(snapshot).toMatchObject({ phase: 'ordering' })
    expect(JSON.stringify(snapshot)).not.toContain('0900000000')
    await expect(runtime.invoke('kiosk_customer_phone', { phone: '0911111111' })).rejects.toThrow()
    expect(phone).toBe('0900000000')
  })
  it('lets Jev skip the optional phone page through a phase-legal choice', async () => {
    let ready = false
    const runtime = createMenuToolRuntime({
      orderingReady: () => ready,
      onCustomerEntrySkipped: () => ready = true,
      onSessionReset: () => ready = false,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '略過電話，我要直接點餐' }) as { phase: string, candidates: Array<{ id: string }> }
    expect(context.phase).toBe('customer_entry')
    expect(context.candidates.map(candidate => candidate.id)).toEqual(['intent:skip-customer-entry'])
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:skip-customer-entry' })).toMatchObject({ customerMessage: '已略過手機登記，現在可以直接點餐。' })
    expect(ready).toBe(true)
    expect(await runtime.invokeManual('order_add_item', { itemId: 'chous-shrimp-roll' })).toMatchObject({ cart: { itemCount: 1 } })
    await expect(runtime.invokeManual('customer_skip_phone', { confirmedByUser: true })).rejects.toThrow('電話頁')
    await runtime.reset()
    expect(ready).toBe(false)
    await runtime.invokeForAgent('customer_skip_phone', { confirmedByUser: true })
    expect(ready).toBe(true)
  })

  it('offers a phone-or-skip question while retaining the entry gate for meal operations', async () => {
    const runtime = createMenuToolRuntime({
      orderingReady: () => false,
      onCustomerEntrySkipped: () => {},
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    const question = await runtime.invoke('order_ask_question', { purpose: 'customer-entry' }) as { pendingCustomerChoice: { question: string } }
    expect(question.pendingCustomerChoice.question).toContain('略過')
    await expect(runtime.invokeManual('order_add_item', { itemId: 'chous-shrimp-roll' })).rejects.toThrow('略過')
  })

  it('requires customer entry before ordering and clears it on a host session reset', async () => {
    let ready = false
    const runtime = createMenuToolRuntime({
      orderingReady: () => ready,
      onSessionReset: () => ready = false,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await expect(runtime.invokeManual('order_add_item', { itemId: 'chous-shrimp-roll' })).rejects.toThrow('手機號碼')
    ready = true
    expect(await runtime.invokeManual('order_add_item', { itemId: 'chous-shrimp-roll' })).toMatchObject({ cart: { itemCount: 1 } })
    await runtime.reset()
    await expect(runtime.invokeManual('order_add_item', { itemId: 'chous-shrimp-roll' })).rejects.toThrow('手機號碼')
  })

  it('does not advertise table-selection tools when the menu has no seating-selection capability', () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(runtime.toolDefinitions.some(tool => tool.name === 'seating_reserve')).toBe(false)
    expect(runtime.toolDefinitions.some(tool => tool.name === 'order_set_party_size')).toBe(false)
    expect(runtime.toolDefinitions.find(tool => tool.name === 'order_ask_question')?.inputSchema).toMatchObject({ properties: { purpose: { enum: expect.not.arrayContaining(['tables']) } } })
    expect(runtime.toolDefinitions.find(tool => tool.name === 'order_ask_question')?.inputSchema).toMatchObject({ properties: { purpose: { enum: expect.not.arrayContaining(['party-size']) } } })
  })
})
