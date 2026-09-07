import { describe, expect, it, vi } from 'vitest'

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
    await expect(machine.confirmOrder()).rejects.toThrow('Choose dine-in or take-out before confirming the order.')

    machine.setFulfillmentMode('dine-in')
    await expect(machine.confirmOrder()).resolves.toMatchObject({
      status: 'simulated',
      cart: { fulfillmentMode: 'dine-in' },
    })
  })

  it('returns one submitted order when confirmation is retried', async () => {
    const submit = vi.fn(async cart => ({ id: 'pos-1', cart, status: 'simulated' as const }))
    const machine = createOrderMachine({ gateway: { submit } })

    machine.selectMenuItem('chous-shrimp-roll')
    machine.addToCart()
    machine.setFulfillmentMode('takeout')

    const [firstOrder, retryOrder] = await Promise.all([machine.confirmOrder(), machine.confirmOrder()])
    expect(submit).toHaveBeenCalledOnce()
    expect(retryOrder).toEqual(firstOrder)
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
    const operationEvents: string[] = []
    const runtime = createMenuToolRuntime({
      onAction: (action) => {
        actions.push(action.label)
      },
      onAgentOperationStart: () => operationEvents.push('start'),
      onAgentOperationEnd: () => operationEvents.push('end'),
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    const withoutVisualAction = () => {}

    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' }, withoutVisualAction)
    await runtime.invoke('menu_set_quantity', { quantity: 2 }, withoutVisualAction)
    await runtime.invoke('cart_add_item', {}, withoutVisualAction)

    expect(actions).toEqual([])
    expect(operationEvents).toEqual([])
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({
      cart: { itemCount: 2, lines: [{ itemId: 'chous-shrimp-roll', quantity: 2 }] },
    })
    expect(operationEvents).toEqual(['start', 'end'])
  })

  it('declares native WebMCP tools from the same runtime used by the menu UI', () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(runtime.toolDefinitions.map(tool => tool.name)).toEqual([
      'menu_get',
      'menu_recommend',
      'menu_select_item',
      'menu_set_item_option',
      'menu_set_quantity',
      'cart_add_item',
      'cart_remove_item',
      'cart_set_line_quantity',
      'cart_get',
      'order_set_fulfillment',
      'order_confirm',
    ])
  })

  it('requires the selected item ID returned by menu_get', () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const selectItem = runtime.toolDefinitions.find(tool => tool.name === 'menu_select_item')
    const itemId = selectItem?.inputSchema.properties as Record<string, { description?: string }> | undefined

    expect(itemId?.itemId?.description).toContain('menu_get')
  })

  it('releases an earlier native registration before registering the same tool names again', async () => {
    const registeredNames = new Set<string>()
    const registerTool = vi.fn(async (
      tool: { name: string },
      registration: { signal?: AbortSignal },
    ) => {
      if (registeredNames.has(tool.name))
        throw new DOMException('Duplicate tool name', 'InvalidStateError')

      registeredNames.add(tool.name)
      registration.signal?.addEventListener('abort', () => registeredNames.delete(tool.name), { once: true })
    })
    vi.stubGlobal('document', { modelContext: { registerTool } })

    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.registerNativeWebMcp()
      await expect(runtime.registerNativeWebMcp()).resolves.toBeTypeOf('function')
      expect(registeredNames.size).toBe(runtime.toolDefinitions.length)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('accepts a native WebMCP invocation that omits callback options', async () => {
    const registeredTools: Array<{
      name: string
      execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>
    }> = []
    const registerTool = vi.fn(async (tool: typeof registeredTools[number]) => {
      registeredTools.push(tool)
    })
    vi.stubGlobal('document', { modelContext: { registerTool } })

    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.registerNativeWebMcp()
      const recommend = registeredTools.find(tool => tool.name === 'menu_recommend')
      if (!recommend)
        throw new Error('Expected menu_recommend to be registered.')

      await expect(recommend.execute({ needs: ['fried'] })).resolves.toMatchObject({ needs: ['fried'] })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('notifies the embedding host after a native WebMCP order confirmation', async () => {
    const registeredTools: Array<{
      name: string
      execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>
    }> = []
    vi.stubGlobal('document', {
      modelContext: {
        registerTool: async (tool: typeof registeredTools[number]) => registeredTools.push(tool),
      },
    })

    try {
      const completedOrders: string[] = []
      const runtime = createMenuToolRuntime({
        onAction: () => {},
        onCartChange: () => {},
        onMenuSelection: () => {},
        onOrderConfirmed: order => completedOrders.push(order.id),
      })
      await runtime.registerNativeWebMcp()
      const selectItem = registeredTools.find(tool => tool.name === 'menu_select_item')
      const addItem = registeredTools.find(tool => tool.name === 'cart_add_item')
      const setFulfillment = registeredTools.find(tool => tool.name === 'order_set_fulfillment')
      const confirmOrder = registeredTools.find(tool => tool.name === 'order_confirm')
      if (!selectItem || !addItem || !setFulfillment || !confirmOrder)
        throw new Error('Expected order tools to be registered.')

      await selectItem.execute({ itemId: 'chous-shrimp-roll' })
      await addItem.execute({})
      await setFulfillment.execute({ mode: 'dine-in' })
      await confirmOrder.execute({ confirmedByUser: true })

      expect(completedOrders).toHaveLength(1)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns an actionable result when an agent omits a selected item ID', async () => {
    const registeredTools: Array<{
      name: string
      execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>
    }> = []
    const registerTool = vi.fn(async (tool: typeof registeredTools[number]) => {
      registeredTools.push(tool)
    })
    vi.stubGlobal('document', { modelContext: { registerTool } })

    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.registerNativeWebMcp()
      const selectItem = registeredTools.find(tool => tool.name === 'menu_select_item')
      if (!selectItem)
        throw new Error('Expected menu_select_item to be registered.')

      await expect(selectItem.execute({})).resolves.toMatchObject({
        ok: false,
        recovery: expect.stringContaining('menu_get'),
      })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('tells an agent to ask for dine-in or take-out before retrying confirmation', async () => {
    const registeredTools: Array<{
      name: string
      execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>
    }> = []
    vi.stubGlobal('document', {
      modelContext: {
        registerTool: async (tool: typeof registeredTools[number]) => registeredTools.push(tool),
      },
    })

    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await runtime.registerNativeWebMcp()
      const selectItem = registeredTools.find(tool => tool.name === 'menu_select_item')
      const addItem = registeredTools.find(tool => tool.name === 'cart_add_item')
      const confirmOrder = registeredTools.find(tool => tool.name === 'order_confirm')
      if (!selectItem || !addItem || !confirmOrder)
        throw new Error('Expected order tools to be registered.')

      await selectItem.execute({ itemId: 'chous-shrimp-roll' })
      await addItem.execute({})
      await expect(confirmOrder.execute({ confirmedByUser: true })).resolves.toMatchObject({
        ok: false,
        recovery: expect.stringContaining('order_set_fulfillment'),
      })
    }
    finally {
      vi.unstubAllGlobals()
    }
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
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })

    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({
      cart: { fulfillmentMode: 'takeout', itemCount: 2, total: 150, lines: [{ itemId: 'chous-shrimp-roll', quantity: 2, options: { ginger: 'without-ginger' } }] },
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
      { controlId: 'order:fulfillment:takeout', label: '設定為外帶', targetId: 'cart' },
    ])
    expect(carts).toEqual([150, 150])
  })

  it('synchronizes WebMCP item options into the visible menu selection and emits one completion', async () => {
    const selections: Array<{ itemId: string, options: Record<string, string>, quantity: number }> = []
    const completedOrders: string[] = []
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onSelectionChange: selection => selections.push(selection),
      onOrderConfirmed: order => completedOrders.push(order.id),
    })

    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('menu_set_item_option', { groupId: 'ginger', valueId: 'without-ginger' })
    await runtime.invoke('cart_add_item')
    await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
    const [firstConfirmation, retryConfirmation] = await Promise.all([
      runtime.invoke('order_confirm', { confirmedByUser: true }),
      runtime.invoke('order_confirm', { confirmedByUser: true }),
    ])

    expect(selections).toEqual([
      { itemId: 'chous-shrimp-roll', options: { ginger: 'with-ginger' }, quantity: 1 },
      { itemId: 'chous-shrimp-roll', options: { ginger: 'without-ginger' }, quantity: 1 },
    ])
    expect(completedOrders).toHaveLength(1)
    expect(retryConfirmation).toMatchObject(firstConfirmation)
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
