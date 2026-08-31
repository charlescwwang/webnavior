import { describe, expect, it } from 'vitest'

import { createMenuToolRuntime } from '../webmcp'
import { catalogInfo, createOrderMachine, defaultOptionsFor, menu } from './order-machine'

describe('createOrderMachine', () => {
  it('creates a configurable shrimp-roll cart line and submits only after the cart is populated', async () => {
    const machine = createOrderMachine()

    machine.selectMenuItem('chous-shrimp-roll')
    machine.setItemOption('ginger', 'without-ginger')
    machine.setQuantity(2)
    machine.addToCart()

    expect(machine.getCart()).toMatchObject({
      itemCount: 2,
      total: 150,
      lines: [{ itemId: 'chous-shrimp-roll', quantity: 2, options: { ginger: 'without-ginger' } }],
    })
    await expect(machine.confirmOrder()).resolves.toMatchObject({ status: 'simulated' })
  })

  it('exposes a varied, source-inspired menu through stable opaque IDs', () => {
    expect(menu).toHaveLength(16)
    expect(new Set(menu.map(item => item.category))).toEqual(new Set([
      '招牌小吃',
      '麵飯主食',
      '湯品',
      '炸物小點',
      '甜品',
      '飲品',
    ]))
    expect(menu.find(item => item.id === 'chous-shrimp-roll')).toMatchObject({ name: '周氏蝦捲', price: 75 })
    expect(menu.find(item => item.id === 'danzai-noodles')).toMatchObject({ name: '周氏擔仔麵', price: 65 })
    expect(menu.find(item => item.id === 'almond-red-bean-tofu')).toMatchObject({ name: '杏仁紅豆豆腐', price: 55 })
    expect(menu.find(item => item.id === 'cuttlefish-ball')?.imageUrl).toMatch(/^data:image\/svg\+xml/)
    expect(defaultOptionsFor(menu[0]!)).toEqual({ ginger: 'with-ginger' })
    expect(catalogInfo).toMatchObject({ isSimulated: true, sourceName: '周氏蝦捲公開產品資料' })
  })
})

describe('createMenuToolRuntime', () => {
  it('drives the same visible action sequence and cart state used by WebMCP', async () => {
    const actions: Array<{ expandCustomization?: boolean, label: string, targetId?: string }> = []
    const carts: number[] = []
    const runtime = createMenuToolRuntime({
      onAction: (action) => {
        actions.push(action)
      },
      onCartChange: (cart) => {
        carts.push(cart.total)
      },
      onMenuSelection: () => {},
    })

    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('menu_set_item_option', { groupId: 'ginger', valueId: 'without-ginger' })
    await runtime.invoke('menu_set_quantity', { quantity: 2 })
    await runtime.invoke('cart_add_item')

    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({
      cart: { itemCount: 2, total: 150, lines: [{ itemId: 'chous-shrimp-roll', quantity: 2, options: { ginger: 'without-ginger' } }] },
    })
    expect(actions).toEqual([
      { label: '正在選擇周氏蝦捲', targetId: 'chous-shrimp-roll' },
      { expandCustomization: true, label: '設定為不附嫩薑', targetId: 'chous-shrimp-roll' },
      { label: '設定數量為 2', targetId: 'chous-shrimp-roll' },
      { label: '加入購物車', targetId: 'cart' },
    ])
    expect(carts).toEqual([150])
  })

  it('identifies menu data as simulated so agents do not present demo prices as official', async () => {
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })

    await expect(runtime.invoke('menu_get')).resolves.toMatchObject({
      catalog: { isSimulated: true, sourceName: '周氏蝦捲公開產品資料' },
    })
  })
})
