import type { CheckoutToolController } from '../webmcp'
import type { CartSnapshot } from './order-machine'

import { describe, expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from '../webmcp'
import { catalogInfo, createOrderMachine, defaultOptionsFor, menu } from './order-machine'

describe('createOrderMachine', () => {
  it('keeps a sold-out catalog item visible without allowing it into a selection', () => {
    const soldOutItem = { ...menu[0], available: false }
    const machine = createOrderMachine({ menu: [soldOutItem] })

    expect(machine.getMenu()).toEqual([soldOutItem])
    expect(() => machine.selectMenuItem(soldOutItem.id)).toThrow('currently unavailable')
  })

  it('accepts a POS catalog before ordering and refuses to reprice an active cart', () => {
    const posItem = { ...menu[0], id: 'pos-item', name: 'POS 餐點', price: 88 }
    const machine = createOrderMachine({ menu: [] })

    machine.setMenu([posItem])
    expect(machine.getMenu()).toEqual([posItem])

    machine.selectMenuItem(posItem.id)
    machine.addToCart()
    expect(() => machine.setMenu([menu[1]!])).toThrow('Cannot replace the menu while an order is in progress.')
  })

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
      cart: { fulfillmentMode: 'dine-in' },
      receipt: {
        environment: 'test',
        status: 'accepted',
        customerMessage: '測試訂單已確認，未送往正式 POS。',
      },
    })
  })

  it('returns one submitted order when confirmation is retried', async () => {
    const submit = vi.fn(async cart => ({
      id: 'pos-1',
      cart,
      receipt: {
        customerMessage: '訂單已送往 POS。',
        environment: 'live' as const,
        posOrderId: 'store-42',
        retryable: false,
        status: 'accepted' as const,
      },
    }))
    const machine = createOrderMachine({ gateway: { submit } })

    machine.selectMenuItem('chous-shrimp-roll')
    machine.addToCart()
    machine.setFulfillmentMode('takeout')

    const [firstOrder, retryOrder] = await Promise.all([machine.confirmOrder(), machine.confirmOrder()])
    expect(submit).toHaveBeenCalledOnce()
    expect(retryOrder).toEqual(firstOrder)
  })

  it('binds a terminal payment to one cart snapshot and invalidates it after an order change', () => {
    const machine = createOrderMachine()
    machine.selectMenuItem('chous-shrimp-roll')
    machine.addToCart()
    machine.setFulfillmentMode('takeout')

    expect(machine.setPaymentId('payment-0001')).toMatchObject({ paymentId: 'payment-0001', total: 75 })

    machine.setFulfillmentMode('dine-in')
    expect(machine.getCart().paymentId).toBeUndefined()
  })

  it('does not treat a rejected or uncertain submission as a completed order', async () => {
    const rejected = createOrderMachine({
      gateway: {
        submit: async cart => ({
          id: 'attempt-rejected',
          cart,
          receipt: {
            customerMessage: '這筆訂單目前無法接受，請確認餐點後再試。',
            environment: 'live',
            retryable: true,
            status: 'rejected',
          },
        }),
      },
    })
    rejected.selectMenuItem('chous-shrimp-roll')
    rejected.addToCart()
    rejected.setFulfillmentMode('takeout')

    await expect(rejected.confirmOrder()).resolves.toMatchObject({ receipt: { status: 'rejected' } })

    const uncertainSubmit = vi.fn(async cart => ({
      id: 'attempt-uncertain',
      cart,
      receipt: {
        customerMessage: '訂單狀態尚未確認，請稍候。',
        environment: 'live' as const,
        retryable: false,
        status: 'uncertain' as const,
      },
    }))
    const uncertain = createOrderMachine({ gateway: { submit: uncertainSubmit } })
    uncertain.selectMenuItem('chous-shrimp-roll')
    uncertain.addToCart()
    uncertain.setFulfillmentMode('takeout')

    await expect(uncertain.confirmOrder()).resolves.toMatchObject({ receipt: { status: 'uncertain' } })
    await expect(uncertain.confirmOrder()).resolves.toMatchObject({ receipt: { status: 'uncertain' } })
    expect(uncertainSubmit).toHaveBeenCalledOnce()
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
  function checkoutController(overrides: Partial<CheckoutToolController> = {}): CheckoutToolController {
    return {
      assertCanRestart: () => {},
      cancel: () => {},
      chooseInvoice: method => ({ invoiceMethod: method, stage: 'payment' }),
      confirmTaxId: () => ({ invoiceMethod: 'tax-id', stage: 'payment', taxId: '12345678' }),
      requestTaxId: () => ({ invoiceMethod: 'tax-id', stage: 'tax-id', taxId: '' }),
      restart: () => {},
      selectPayment: async method => ({ customerMessage: `等待${method}`, status: 'pending' }),
      setTaxId: taxId => ({ invoiceMethod: 'tax-id', stage: 'tax-id', taxId }),
      skipMembership: () => ({ stage: 'invoice' }),
      start: () => ({ stage: 'membership' }),
      ...overrides,
    }
  }

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
      'menu_show_recommendations',
      'menu_select_item',
      'menu_set_item_option',
      'menu_set_quantity',
      'order_add_item',
      'cart_add_item',
      'cart_remove_item',
      'cart_set_line_quantity',
      'cart_set_line_option',
      'cart_clear',
      'cart_get',
      'order_set_fulfillment',
      'checkout_start',
      'checkout_skip_membership',
      'checkout_choose_invoice',
      'checkout_request_tax_id',
      'checkout_set_tax_id',
      'checkout_confirm_tax_id',
      'checkout_select_payment',
      'checkout_cancel',
    ])
  })

  it('routes Agent checkout actions through one controller without exposing physical scan or authorization tools', async () => {
    const calls: string[] = []
    const controller = checkoutController({
      cancel: () => calls.push('cancel'),
      chooseInvoice: (method) => {
        calls.push(`invoice:${method}`)
        return { invoiceMethod: method, stage: 'payment' }
      },
      confirmTaxId: () => {
        calls.push('confirm-tax-id')
        return { invoiceMethod: 'tax-id', stage: 'payment', taxId: '12345678' }
      },
      requestTaxId: () => {
        calls.push('request-tax-id')
        return { invoiceMethod: 'tax-id', stage: 'tax-id', taxId: '' }
      },
      selectPayment: async (method) => {
        calls.push(`payment:${method}`)
        return { customerMessage: '等待顧客操作終端。', status: 'pending' }
      },
      setTaxId: (taxId) => {
        calls.push(`tax-id:${taxId}`)
        return { invoiceMethod: 'tax-id', stage: 'tax-id', taxId }
      },
      skipMembership: () => {
        calls.push('skip-membership')
        return { stage: 'invoice' }
      },
      start: () => {
        calls.push('start')
        return { stage: 'membership' }
      },
    })
    const runtime = createMenuToolRuntime({ checkout: controller, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })

    await runtime.invoke('checkout_start', { confirmedByUser: true })
    await runtime.invoke('checkout_skip_membership', { confirmedByUser: true })
    await runtime.invoke('checkout_request_tax_id')
    await runtime.invoke('checkout_set_tax_id', { taxId: '12345678' })
    await runtime.invoke('checkout_confirm_tax_id', { confirmedByUser: true })
    await runtime.invoke('checkout_select_payment', { method: 'card' })
    await runtime.invoke('checkout_cancel', { confirmedByUser: true })

    expect(calls).toEqual(['start', 'skip-membership', 'request-tax-id', 'tax-id:12345678', 'confirm-tax-id', 'payment:card', 'cancel'])
    expect(runtime.toolDefinitions.map(tool => tool.name)).not.toContain('checkout_scan_membership')
    expect(runtime.toolDefinitions.map(tool => tool.name)).not.toContain('checkout_authorize_payment')
  })

  it('checks payment safety before clearing the order for a new conversation', async () => {
    const runtime = createMenuToolRuntime({
      checkout: checkoutController({ assertCanRestart: () => { throw new Error('payment pending') } }),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })

    await expect(runtime.invoke('cart_clear', { confirmedByUser: true })).rejects.toThrow('payment pending')
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 1 } })
  })

  it('adds one configured item through one agent call while preserving each visible step', async () => {
    const actions: Array<{ controlId?: string, expandCustomization?: boolean, label: string, targetId?: string }> = []
    const runtime = createMenuToolRuntime({
      onAction: (action) => {
        actions.push(action)
      },
      onCartChange: () => {},
      onMenuSelection: () => {},
    })

    await expect(runtime.invoke('order_add_item', {
      itemId: 'chous-shrimp-roll',
      options: [{ groupId: 'ginger', valueId: 'without-ginger' }],
      quantity: 2,
    })).resolves.toMatchObject({
      cart: {
        fulfillmentMode: undefined,
        itemCount: 2,
        total: 150,
        lines: [{ itemId: 'chous-shrimp-roll', quantity: 2, options: { ginger: 'without-ginger' } }],
      },
      pendingCustomerChoice: {
        id: 'fulfillment-mode',
        canBeDeferred: true,
      },
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
  })

  it('requires an explicit answer for every required customization before the high-level add', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })

    await expect(runtime.invoke('order_add_item', {
      itemId: 'braised-pork-set',
    })).rejects.toThrow('required option')
  })

  it('requires the selected item ID returned by menu_get', () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const selectItem = runtime.toolDefinitions.find(tool => tool.name === 'menu_select_item')
    const itemId = selectItem?.inputSchema.properties as Record<string, { description?: string }> | undefined

    expect(itemId?.itemId?.description).toContain('menu_get')
  })

  it('makes menu listing and cart removal execution requirements explicit to the Agent', () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const menuGet = runtime.toolDefinitions.find(tool => tool.name === 'menu_get')
    const removeItem = runtime.toolDefinitions.find(tool => tool.name === 'cart_remove_item')

    expect(menuGet?.description).toContain('直接列出')
    expect(removeItem?.description).toContain('先執行')
    expect(removeItem?.description).toContain('cart_get')
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

  it('starts checkout through native WebMCP without completing the order', async () => {
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
        checkout: checkoutController(),
        onAction: () => {},
        onCartChange: () => {},
        onMenuSelection: () => {},
        onOrderConfirmed: order => completedOrders.push(order.id),
      })
      await runtime.registerNativeWebMcp()
      const selectItem = registeredTools.find(tool => tool.name === 'menu_select_item')
      const addItem = registeredTools.find(tool => tool.name === 'cart_add_item')
      const setFulfillment = registeredTools.find(tool => tool.name === 'order_set_fulfillment')
      const startCheckout = registeredTools.find(tool => tool.name === 'checkout_start')
      if (!selectItem || !addItem || !setFulfillment || !startCheckout)
        throw new Error('Expected order tools to be registered.')

      await selectItem.execute({ itemId: 'chous-shrimp-roll' })
      await addItem.execute({})
      await setFulfillment.execute({ mode: 'dine-in' })
      await expect(startCheckout.execute({ confirmedByUser: true })).resolves.toMatchObject({ checkout: { stage: 'membership' } })

      expect(completedOrders).toHaveLength(0)
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
      const runtime = createMenuToolRuntime({
        checkout: checkoutController({
          start: () => { throw new Error('Choose dine-in or take-out before starting checkout.') },
        }),
        onAction: () => {},
        onCartChange: () => {},
        onMenuSelection: () => {},
      })
      await runtime.registerNativeWebMcp()
      const selectItem = registeredTools.find(tool => tool.name === 'menu_select_item')
      const addItem = registeredTools.find(tool => tool.name === 'cart_add_item')
      const startCheckout = registeredTools.find(tool => tool.name === 'checkout_start')
      if (!selectItem || !addItem || !startCheckout)
        throw new Error('Expected order tools to be registered.')

      await selectItem.execute({ itemId: 'chous-shrimp-roll' })
      await addItem.execute({})
      await expect(startCheckout.execute({ confirmedByUser: true })).resolves.toMatchObject({
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

  it('edits cart quantities and options directly without removing and re-adding a line', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const added = await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' }) as { line: { id: string } }

    await runtime.invoke('cart_set_line_quantity', { lineId: added.line.id, quantity: 4 })
    const optionResult = await runtime.invoke('cart_set_line_option', {
      lineId: added.line.id,
      groupId: 'ginger',
      valueId: 'without-ginger',
    }) as { cart: CartSnapshot, line: { id: string } }

    expect(optionResult.line.id).toBe(added.line.id)
    expect(optionResult.cart).toMatchObject({
      itemCount: 4,
      lines: [{ id: added.line.id, options: { ginger: 'without-ginger' }, quantity: 4 }],
    })
  })

  it('clears the unsubmitted cart only after the customer explicitly confirms it', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })

    await expect(runtime.invoke('cart_clear', {})).rejects.toThrow('confirmedByUser')
    await expect(runtime.invoke('cart_clear', { confirmedByUser: true })).resolves.toMatchObject({
      cart: { fulfillmentMode: undefined, itemCount: 0, lines: [], total: 0 },
    })
  })

  it('does not clear a cart after its order was accepted', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    await runtime.confirmPaidOrder('payment-accepted')

    await expect(runtime.invoke('cart_clear', { confirmedByUser: true })).rejects.toThrow('accepted')
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
      runtime.confirmPaidOrder('payment-accepted'),
      runtime.confirmPaidOrder('payment-accepted'),
    ])

    expect(selections).toEqual([
      { itemId: 'chous-shrimp-roll', options: { ginger: 'with-ginger' }, quantity: 1 },
      { itemId: 'chous-shrimp-roll', options: { ginger: 'without-ginger' }, quantity: 1 },
    ])
    expect(completedOrders).toHaveLength(1)
    expect(retryConfirmation).toMatchObject(firstConfirmation)
  })

  it('returns a review result instead of completing the kiosk flow when submission is rejected', async () => {
    const completedOrders: string[] = []
    const runtime = createMenuToolRuntime({
      gateway: {
        submit: async cart => ({
          id: 'attempt-rejected',
          cart,
          receipt: {
            customerMessage: '這筆訂單目前無法接受，請確認餐點後再試。',
            environment: 'live',
            retryable: true,
            status: 'rejected',
          },
        }),
      },
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onOrderConfirmed: order => completedOrders.push(order.id),
    })

    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('cart_add_item')
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })

    await expect(runtime.confirmPaidOrder('payment-rejected')).resolves.toMatchObject({ receipt: { status: 'rejected' } })
    expect(completedOrders).toEqual([])
  })

  it('keeps an uncertain submission open for reconciliation instead of completing it', async () => {
    const completedOrders: string[] = []
    const runtime = createMenuToolRuntime({
      gateway: {
        submit: async cart => ({
          id: 'attempt-uncertain',
          cart,
          receipt: {
            customerMessage: '訂單狀態尚未確認，請稍候。',
            environment: 'live',
            retryable: false,
            status: 'uncertain',
          },
        }),
      },
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onOrderConfirmed: order => completedOrders.push(order.id),
    })

    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('cart_add_item')
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })

    await expect(runtime.confirmPaidOrder('payment-uncertain')).resolves.toMatchObject({ receipt: { status: 'uncertain' } })
    expect(completedOrders).toEqual([])
  })

  it('returns the deterministic test confirmation instead of claiming a POS submission', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })

    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('cart_add_item')
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })

    await expect(runtime.confirmPaidOrder('payment-test')).resolves.toMatchObject({ receipt: { environment: 'test', status: 'accepted' } })
  })

  it('submits an authorized payment ID through the same receipt callbacks as order confirmation', async () => {
    const submittedCarts: CartSnapshot[] = []
    const completedOrders: string[] = []
    const runtime = createMenuToolRuntime({
      gateway: {
        submit: async (cart) => {
          submittedCarts.push(cart)
          return {
            cart,
            id: 'paid-order-0001',
            receipt: {
              customerMessage: '訂單已送往 POS。',
              environment: 'live',
              retryable: false,
              status: 'accepted',
            },
          }
        },
      },
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onOrderConfirmed: order => completedOrders.push(order.id),
    })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })

    await expect(runtime.confirmPaidOrder('payment-0001')).resolves.toMatchObject({ receipt: { status: 'accepted' } })
    expect(submittedCarts).toMatchObject([{ paymentId: 'payment-0001' }])
    expect(completedOrders).toEqual(['paid-order-0001'])
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

  it('shows only verified catalog items in the non-blocking recommendation rail', async () => {
    const presentations: unknown[] = []
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onRecommendationsChange: presentation => presentations.push(presentation),
    })

    await expect(runtime.invoke('menu_show_recommendations', {
      itemIds: ['danzai-noodles', 'winter-melon-tea'],
      reason: '一碗主食配一杯飲料。',
      title: '今天想吃得剛剛好',
    })).resolves.toMatchObject({
      customerMessage: '已在菜單上顯示推薦餐點。',
      items: [
        { id: 'danzai-noodles', name: '周氏擔仔麵' },
        { id: 'winter-melon-tea', name: '古早味冬瓜茶' },
      ],
    })
    expect(presentations).toEqual([{
      itemIds: ['danzai-noodles', 'winter-melon-tea'],
      reason: '一碗主食配一杯飲料。',
      title: '今天想吃得剛剛好',
    }])
    await expect(runtime.invoke('menu_show_recommendations', { itemIds: ['not-a-menu-item'] })).rejects.toThrow('Menu item not-a-menu-item was not found.')
  })
})
