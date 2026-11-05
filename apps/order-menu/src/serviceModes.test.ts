import type { OrderingContext } from '@proj-airi/stage-shared/kiosk-service-mode'

import type { CartSnapshot } from './domain/order-machine'

import { describe, expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from './webmcp'

function tableRuntime() {
  let context: OrderingContext = { id: 'round-1', serviceMode: 'table-service', table: { id: 'a03', label: 'a03' }, directSubmissionSupported: true }
  const submit = vi.fn(async (cart: CartSnapshot) => ({ id: 'order-table-1', serviceMode: 'table-service' as const, table: context.table!, cart, receipt: { environment: 'test' as const, status: 'accepted' as const, retryable: false, customerMessage: '本桌訂單已送出。' } }))
  const completed = vi.fn()
  const runtime = createMenuToolRuntime({ serviceContext: () => context, gateway: { submit }, orderingReady: () => false, onSessionReset: () => {
    context = { ...context, id: 'round-2', serviceMode: 'kiosk', table: undefined }
  }, onOrderConfirmed: completed, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  return { runtime, submit, completed }
}

describe('shared Menu service modes', () => {
  it('retains cart tools, removes payment/fulfillment choices and submits only after explicit consent', async () => {
    const { runtime, submit, completed } = tableRuntime()
    expect(runtime.toolDefinitions.some(tool => tool.name === 'order_add_item')).toBe(true)
    expect(runtime.toolDefinitions.some(tool => tool.name === 'checkout_select_payment')).toBe(false)
    expect(runtime.toolDefinitions.some(tool => tool.name === 'order_set_fulfillment')).toBe(false)
    const menu = await runtime.invoke('menu_get') as { items: Array<{ id: string }> }
    await runtime.invoke('order_add_item', { itemId: menu.items[0]!.id, quantity: 1 })
    await expect(runtime.invoke('checkout_start')).rejects.toThrow('confirmedByUser')
    expect(submit).not.toHaveBeenCalled()
    await runtime.invoke('checkout_start', { confirmedByUser: true })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('paymentId')
    expect(completed).toHaveBeenCalledOnce()
  })
  it('applies a mode change on an explicit fresh round and restores Kiosk tools', async () => {
    const { runtime } = tableRuntime()
    await runtime.reset()
    expect(runtime.toolDefinitions.some(tool => tool.name === 'checkout_select_payment')).toBe(true)
    expect(runtime.toolDefinitions.some(tool => tool.name === 'order_set_fulfillment')).toBe(true)
  })
})
