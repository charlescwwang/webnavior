import { describe, expect, it } from 'vitest'

import { createMenuToolRuntime, menuScenarioManifest } from '../webmcp'
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

  it('clears a completed anonymous customer cart without changing the catalog', () => {
    const machine = createOrderMachine()

    machine.selectMenuItem('chous-shrimp-roll')
    machine.addToCart()
    expect(machine.reset()).toEqual({ lines: [], total: 0, itemCount: 0 })
    expect(machine.getMenu()).toHaveLength(menu.length)
    expect(machine.getSelection()).toBeUndefined()
  })

  it('exposes a varied, source-inspired menu through stable opaque IDs', () => {
    expect(menu).toHaveLength(18)
    expect(new Set(menu.map(item => item.category))).toEqual(new Set([
      '超值套餐',
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
    expect(menu.find(item => item.id === 'fish-floss-minced-pork-rice-set')).toMatchObject({
      name: '魚鬆肉燥飯套餐',
      optionGroups: [
        { id: 'set-ginger', label: '蝦捲嫩薑' },
        { id: 'set-soup-cilantro', label: '綜合湯香菜' },
      ],
      price: 380,
    })
    expect(defaultOptionsFor(menu.find(item => item.id === 'braised-pork-set')!)).toEqual({
      'set-tea-ice': 'normal-ice',
      'set-tea-sugar': 'no-sugar',
    })
    expect(menu.find(item => item.id === 'cuttlefish-ball')?.imageUrl).toMatch(/^data:image\/svg\+xml/)
    expect(defaultOptionsFor(menu.find(item => item.id === 'chous-shrimp-roll')!)).toEqual({ ginger: 'with-ginger' })
    expect(catalogInfo).toMatchObject({ isSimulated: true, sourceName: '周氏蝦捲公開產品資料' })
  })
})

describe('createMenuToolRuntime', () => {
  it('keeps direct user-interface mutations separate from AI visual actions', async () => {
    const actions: string[] = []
    const runtime = createMenuToolRuntime({
      onAction: (action) => {
        actions.push(action.label)
      },
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    const withoutVisualAction = () => {}

    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' }, withoutVisualAction)
    await runtime.invoke('menu_set_quantity', { quantity: 2 }, withoutVisualAction)
    await runtime.invoke('cart_add_item', {}, withoutVisualAction)

    expect(actions).toEqual([])
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({
      cart: { itemCount: 2, lines: [{ itemId: 'chous-shrimp-roll', quantity: 2 }] },
    })
  })

  it('declares its tools, prompt, and session reset through the generic scenario manifest', () => {
    expect(menuScenarioManifest).toMatchObject({
      id: 'restaurant-ordering',
      session: { reset: { name: 'scenario_reset' } },
      title: '菜單與目前訂單',
    })
    expect(menuScenarioManifest.tools.map(tool => tool.name)).toEqual([
      'menu_get',
      'menu_recommend',
      'menu_select_item',
      'menu_set_item_option',
      'menu_set_quantity',
      'cart_add_item',
      'cart_remove_item',
      'cart_set_line_quantity',
      'cart_get',
      'order_confirm',
    ])
    expect(menuScenarioManifest.agentPrompt).toContain('不可朗讀、列出或介紹完整菜單')
  })

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
      {
        controlId: 'chous-shrimp-roll:option:ginger:without-ginger',
        expandCustomization: true,
        label: '設定為不附嫩薑',
        targetId: 'chous-shrimp-roll',
      },
      { controlId: 'chous-shrimp-roll:quantity', label: '設定數量為 2', targetId: 'chous-shrimp-roll' },
      { label: '加入購物車', targetId: 'cart' },
    ])
    expect(carts).toEqual([150])
  })

  it('merges matching cart lines while retaining separate customer choices', () => {
    const machine = createOrderMachine()

    machine.selectMenuItem('chous-shrimp-roll')
    machine.setQuantity(2)
    machine.addToCart()
    machine.selectMenuItem('chous-shrimp-roll')
    machine.setQuantity(3)
    machine.addToCart()
    machine.selectMenuItem('chous-shrimp-roll')
    machine.setItemOption('ginger', 'without-ginger')
    machine.addToCart()

    expect(machine.getCart()).toMatchObject({
      itemCount: 6,
      lines: [
        { itemId: 'chous-shrimp-roll', quantity: 5, options: { ginger: 'with-ginger' } },
        { itemId: 'chous-shrimp-roll', quantity: 1, options: { ginger: 'without-ginger' } },
      ],
    })
  })

  it('updates a cart line quantity directly', () => {
    const machine = createOrderMachine()

    machine.selectMenuItem('chous-shrimp-roll')
    const { line } = machine.addToCart()
    machine.setCartLineQuantity(line.id, 4)

    expect(machine.getCart()).toMatchObject({
      itemCount: 4,
      lines: [{ id: line.id, quantity: 4 }],
    })
  })

  it('keeps the complete catalog available for reusable menu integrations', async () => {
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })

    const fullCatalog = await runtime.invoke('menu_get') as {
      catalog: typeof catalogInfo
      categories: string[]
      items: Array<{ id: string, name: string }>
    }

    expect(fullCatalog).toMatchObject({
      catalog: { isSimulated: true, sourceName: '周氏蝦捲公開產品資料' },
      categories: ['超值套餐', '招牌小吃', '麵飯主食', '湯品', '炸物小點', '甜品', '飲品'],
    })
    expect(fullCatalog.items).toHaveLength(menu.length)
    expect(fullCatalog.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chous-shrimp-roll', name: '周氏蝦捲' }),
      expect.objectContaining({ id: 'braised-pork-set', name: '東坡肉套餐' }),
      expect.objectContaining({ id: 'winter-melon-tea', name: '古早味冬瓜茶' }),
    ]))
    const shrimpRollSearch = await runtime.invoke('menu_get', { query: '蝦捲' }) as {
      items: Array<{ id: string, name: string }>
    }
    expect(shrimpRollSearch.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fish-floss-minced-pork-rice-set', name: '魚鬆肉燥飯套餐' }),
      expect.objectContaining({ id: 'chous-shrimp-roll', name: '周氏蝦捲' }),
      expect.objectContaining({ id: 'tofu-skin-shrimp-roll', name: '豆皮鮮蝦捲' }),
    ]))
  })

  it('recommends only catalog items that satisfy every stated customer need', async () => {
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })

    await expect(runtime.invoke('menu_recommend', { needs: ['fried', 'pork-free'], limit: 2 })).resolves.toMatchObject({
      items: [
        { id: 'chous-shrimp-roll', name: '周氏蝦捲' },
        { id: 'tofu-skin-shrimp-roll', name: '豆皮鮮蝦捲' },
      ],
      needs: ['fried', 'pork-free'],
    })
    await expect(runtime.invoke('menu_recommend', { needs: ['rice', 'pork-free'] })).resolves.toMatchObject({ items: [] })
  })
})
