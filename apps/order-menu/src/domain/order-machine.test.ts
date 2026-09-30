import type { CheckoutToolController } from '../webmcp'
import type { CartSnapshot } from './order-machine'

import { describe, expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from '../webmcp'
import { catalogInfo, createOrderMachine, defaultOptionsFor, menu } from './order-machine'

describe('createOrderMachine', () => {
  it('advances owner revisions for a cart edit that is later undone', () => {
    const machine = createOrderMachine()
    machine.selectMenuItem('chous-shrimp-roll')
    machine.addToCart()
    const initial = machine.getRevisions()
    const lineId = machine.getCart().lines[0]!.id

    machine.setCartLineQuantity(lineId, 2)
    machine.setCartLineQuantity(lineId, 1)

    expect(machine.getCart().lines[0]?.quantity).toBe(1)
    expect(machine.getRevisions().cart).toBe(initial.cart + 2)
  })

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
      paymentStatus: () => undefined,
      revision: () => 0,
      requestTaxId: () => ({ invoiceMethod: 'tax-id', stage: 'tax-id', taxId: '' }),
      restart: () => {},
      selectPayment: async method => ({ customerMessage: `等待${method}`, status: 'pending' }),
      setTaxId: taxId => ({ invoiceMethod: 'tax-id', stage: 'tax-id', taxId }),
      skipMembership: () => ({ stage: 'invoice' }),
      snapshot: () => undefined,
      start: () => ({ stage: 'membership' }),
      ...overrides,
    }
  }

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

  it('keeps menu loading feedback scoped to tools that replace the visible menu', async () => {
    const activities: string[] = []
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuPresentationActivity: (activity) => {
        activities.push(`${activity.state}:${activity.toolName}`)
      },
      onMenuSelection: () => {},
    })

    await runtime.invoke('menu_recommend')
    await runtime.invoke('menu_get')
    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })

    expect(activities).toEqual(['loading:menu_recommend', 'idle:menu_recommend'])
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
      'kiosk_interaction_state',
      'kiosk_fast_path_context',
      'kiosk_fast_path_execute',
    ])
  })

  it('derives semantic System One intents from the live menu and cart without exposing WebMCP tools', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })

    await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '東坡肉套餐改成兩份' })).resolves.toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: 'intent:add-item' }),
        expect.objectContaining({ id: 'intent:select-item' }),
      ]),
      references: [{ label: '東坡肉套餐', refId: 'ITEM_1' }],
    })

    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    const afterAdding = await runtime.invoke('kiosk_fast_path_context') as { candidates: Array<{ id: string }>, references: Array<{ refId: string }> }
    expect(afterAdding.references).toEqual([{ label: expect.stringContaining('周氏蝦捲'), refId: 'CART_LINE_1' }])
    expect(afterAdding).toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: 'intent:remove-item' }),
        expect.objectContaining({ id: 'intent:set-fulfillment:dine-in' }),
      ]),
    })
    expect(afterAdding.candidates.some(candidate => candidate.id.startsWith('intent:remove-item:line-'))).toBe(false)

    await runtime.invoke('menu_select_item', { itemId: 'braised-pork-set' })
    await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '東坡肉套餐改成兩份' })).resolves.toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: 'intent:set-quantity' }),
      ]),
    })
  })

  it('requires a one-use, cart-bound confirmation before Fast Path clears the cart', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })

    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '周氏蝦捲改成兩份' }) as { candidates: Array<{ id: string }> }
    const clearId = context.candidates.find(candidate => candidate.id === 'intent:clear-cart')?.id
    expect(clearId).toBe('intent:clear-cart')

    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: clearId })).resolves.toMatchObject({ pendingConfirmation: { action: 'CLEAR_CART' } })
    const confirmationContext = await runtime.invoke('kiosk_fast_path_context') as { candidates: Array<{ id: string }> }
    const confirmationId = confirmationContext.candidates.find(candidate => candidate.id.startsWith('intent:confirm:'))?.id
    expect(confirmationId).toBeDefined()

    const confirmed = await runtime.invoke('kiosk_fast_path_execute', { candidateId: confirmationId })
    expect(confirmed).toMatchObject({ decisionTrace: { authorize: { kind: 'EXECUTE' }, operationPlan: { toolName: 'cart_clear' } }, cart: { itemCount: 0 } })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 0 } })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: confirmationId })).rejects.toThrow('expired')
  })

  it('builds Fast Path clarification only from current selected and cart references', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('menu_select_item', { itemId: 'braised-pork-set' })

    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '改成兩份' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates).toContainEqual(expect.objectContaining({ id: 'intent:set-quantity' }))
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-quantity' })).resolves.toMatchObject({
      customerMessage: expect.stringContaining('目前選的東坡肉套餐'),
      pendingClarification: { intent: 'SET_QUANTITY' },
    })
    const clarification = await runtime.invoke('kiosk_fast_path_context', { transcript: '購物車那筆' }) as { candidates: Array<{ id: string }> }
    expect(clarification.candidates).toHaveLength(2)
    expect(clarification.candidates.map(candidate => candidate.id)).toEqual(['clarify:0', 'clarify:1'])
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'clarify:1' })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { lines: [expect.objectContaining({ quantity: 2 })] } })
  })

  it('keeps REMOVE_ITEM bound to two real same-name cart lines and rejects stale clarification', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', options: [{ groupId: 'ginger', valueId: 'with-ginger' }] })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', options: [{ groupId: 'ginger', valueId: 'without-ginger' }] })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '周氏蝦捲不要了' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.filter(candidate => candidate.id === 'intent:remove-item')).toHaveLength(1)
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:remove-item' })).resolves.toMatchObject({
      pendingClarification: { candidateRefs: [expect.stringContaining('cart:'), expect.stringContaining('cart:')], intent: 'REMOVE_ITEM' },
    })
    const clarification = await runtime.invoke('kiosk_fast_path_context', { transcript: '第二筆' }) as { candidates: Array<{ id: string, description: string }> }
    expect(clarification.candidates.map(candidate => candidate.id)).toEqual(['clarify:0', 'clarify:1'])
    const cart = await runtime.invoke('cart_get') as { cart: { lines: Array<{ id: string }> } }
    await runtime.invoke('cart_set_line_quantity', { lineId: cart.cart.lines[0]!.id, quantity: 2 })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'clarify:1' })).rejects.toThrow('stale')
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { lines: [expect.any(Object), expect.any(Object)] } })
  })

  it('rejects a System One cart operation when a touch mutation changed its cart revision', async () => {
    const runtime = createMenuToolRuntime({
      menu: [menu.find(item => item.id === 'chous-shrimp-roll')!],
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '周氏蝦捲改成兩份' }) as { candidates: Array<{ id: string }> }
    const quantityId = context.candidates.find(candidate => candidate.id === 'intent:set-quantity')?.id
    expect(quantityId).toBeDefined()

    const cart = await runtime.invoke('cart_get') as { cart: { lines: Array<{ id: string }> } }
    await runtime.invoke('cart_set_line_quantity', { lineId: cart.cart.lines[0]!.id, quantity: 2 })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: quantityId })).rejects.toThrow('STALE_PLAN')
  })

  it('rejects a stale plan even when a touch edit restores the original cart snapshot', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '周氏蝦捲改成兩份' })
    const cart = await runtime.invoke('cart_get') as { cart: { lines: Array<{ id: string }> } }
    const lineId = cart.cart.lines[0]!.id

    await runtime.invoke('cart_set_line_quantity', { lineId, quantity: 3 })
    await runtime.invoke('cart_set_line_quantity', { lineId, quantity: 1 })

    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:set-quantity' })).rejects.toThrow('STALE_PLAN')
  })

  it('can add another of the last ordered item after the selected draft was cleared', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })

    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '再一份' }) as { candidates: Array<{ id: string }>, references: Array<{ label: string, refId: string }> }
    expect(context.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]))
    expect(context.references).toEqual(expect.arrayContaining([expect.objectContaining({ label: expect.stringContaining('周氏蝦捲') })]))

    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 2, lines: [expect.objectContaining({ itemId: 'chous-shrimp-roll', quantity: 2 })] } })
  })

  it('repeats only the spoken serving count when the selected draft has a different quantity', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('menu_set_quantity', { quantity: 3 })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '再一份' })

    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    expect(result).toMatchObject({ decisionTrace: { operationPlan: { toolName: 'order_add_item' } } })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 1, lines: [expect.objectContaining({ itemId: 'chous-shrimp-roll', quantity: 1 })] } })
  })

  it('keeps a cart plan valid across an unrelated selected-item change', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '周氏蝦捲不要了' })
    await runtime.invoke('menu_select_item', { itemId: 'braised-pork-set' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:remove-item' })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 0 } })
  })

  it('rejects an issued item plan after the POS catalog changes', async () => {
    const item = menu.find(candidate => candidate.id === 'chous-shrimp-roll')!
    const runtime = createMenuToolRuntime({ menu: [item], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要周氏蝦捲' })
    runtime.setMenu([{ ...item, price: item.price + 5 }], 'new-catalog-revision')
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })).rejects.toThrow('STALE_PLAN')
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 0 } })
  })

  it('rejects a checkout plan after its owner advances revision even if the stage is restored', async () => {
    let revision = 0
    const runtime = createMenuToolRuntime({
      checkout: checkoutController({ revision: () => revision, snapshot: () => ({ stage: 'membership' }) }),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '略過會員' })
    revision += 2

    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:skip-membership' })).rejects.toThrow('STALE_PLAN')
  })

  it('only exposes checkout semantic intents for the current checkout stage', async () => {
    const runtime = createMenuToolRuntime({
      checkout: checkoutController({ snapshot: () => ({ stage: 'membership' }) }),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })

    await expect(runtime.invoke('kiosk_fast_path_context')).resolves.toMatchObject({
      candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:skip-membership' })]),
    })
  })

  it('reads a payment-screen hint without consuming the System One candidate', async () => {
    const runtime = createMenuToolRuntime({
      checkout: checkoutController({ snapshot: () => ({ stage: 'payment' }) }),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    const issued = await runtime.invoke('kiosk_fast_path_context', { transcript: '信用卡' }) as { candidates: Array<{ id: string }> }

    await expect(runtime.invoke('kiosk_interaction_state')).resolves.toMatchObject({
      phase: 'checkout_payment_select',
      paymentState: 'idle',
      allowedPaymentMethods: ['card', 'mobile'],
    })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: issued.candidates[0]?.id })).resolves.toMatchObject({
      decisionTrace: { operationPlan: { toolName: 'checkout_select_payment' } },
    })
    await expect(runtime.invokeForAgent('kiosk_interaction_state')).rejects.toThrow('unavailable to the Agent')
  })

  it('replays a spoken card choice only in payment selection and confirms that exact method once', async () => {
    const selectPayment = vi.fn(async (method: 'card' | 'mobile') => ({ customerMessage: `等待${method}`, status: 'pending' as const }))
    const runtime = createMenuToolRuntime({
      checkout: checkoutController({ selectPayment, snapshot: () => ({ stage: 'payment' }) }),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '信用卡' }) as { candidates: Array<{ id: string }>, phase: string, allowedPaymentMethods: string[] }
    expect(context.phase).toBe('checkout_payment_select')
    expect(context.allowedPaymentMethods).toEqual(['card', 'mobile'])
    expect(context.candidates.map(candidate => candidate.id)).toEqual(['intent:select-payment:card', 'intent:select-payment:mobile', 'intent:cancel-checkout'])
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:select-payment:card' })).resolves.toMatchObject({
      customerMessage: expect.stringContaining('信用卡'),
      decisionTrace: { authorize: { kind: 'REQUIRE_CONFIRMATION' }, operationPlan: { input: { method: 'card' } } },
    })
    const confirmation = await runtime.invoke('kiosk_fast_path_context', { transcript: '確認' }) as { candidates: Array<{ id: string }> }
    const confirmationId = confirmation.candidates.find(candidate => candidate.id.startsWith('intent:confirm:'))?.id
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: confirmationId })
    expect(selectPayment).toHaveBeenCalledExactlyOnceWith('card')
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: confirmationId })).rejects.toThrow('expired')
  })

  it('applies the same payment phase and one-use confirmation to Agent WebMCP calls', async () => {
    const selectPayment = vi.fn(async (method: 'card' | 'mobile') => ({ customerMessage: `等待${method}`, status: 'pending' as const }))
    const runtime = createMenuToolRuntime({
      checkout: checkoutController({ selectPayment, snapshot: () => ({ stage: 'payment' }) }),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'chous-shrimp-roll' })).rejects.toThrow('INVALID_PHASE')
    const proposed = await runtime.invokeForAgent('checkout_select_payment', { method: 'card' })
    expect(proposed).toMatchObject({ pendingConfirmation: { action: 'SELECT_PAYMENT' }, customerMessage: expect.stringContaining('信用卡') })
    expect(selectPayment).not.toHaveBeenCalled()

    const confirmation = await runtime.invoke('kiosk_fast_path_context', { transcript: '確認' }) as { candidates: Array<{ id: string }> }
    const confirmationId = confirmation.candidates.find(candidate => candidate.id.startsWith('intent:confirm:'))?.id
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: confirmationId })
    expect(selectPayment).toHaveBeenCalledExactlyOnceWith('card')
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: confirmationId })).rejects.toThrow('expired')
  })

  it('clarifies an Agent removal when multiple cart lines refer to the same item', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', options: [{ groupId: 'ginger', valueId: 'with-ginger' }] })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', options: [{ groupId: 'ginger', valueId: 'without-ginger' }] })
    const before = await runtime.invoke('cart_get') as { cart: { lines: Array<{ id: string }> } }

    const proposed = await runtime.invokeForAgent('cart_remove_item', { lineId: before.cart.lines[0]!.id })
    expect(proposed).toMatchObject({ pendingClarification: { intent: 'REMOVE_ITEM' }, customerMessage: expect.stringContaining('第1筆') })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 2 } })

    const clarification = await runtime.invoke('kiosk_fast_path_context', { transcript: '第一筆' }) as { resolvedCandidateId?: string }
    expect(clarification.resolvedCandidateId).toBe('clarify:0')
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: clarification.resolvedCandidateId })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 1 } })
  })

  it('retains an Agent quantity change across clarification of duplicate cart lines', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', options: [{ groupId: 'ginger', valueId: 'with-ginger' }] })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', options: [{ groupId: 'ginger', valueId: 'without-ginger' }] })
    const before = await runtime.invoke('cart_get') as { cart: { lines: Array<{ id: string }> } }

    const proposed = await runtime.invokeForAgent('cart_set_line_quantity', { lineId: before.cart.lines[0]!.id, quantity: 3 })
    expect(proposed).toMatchObject({ pendingClarification: { intent: 'SET_QUANTITY' } })
    const clarification = await runtime.invoke('kiosk_fast_path_context', { transcript: '第二筆' }) as { resolvedCandidateId?: string }
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: clarification.resolvedCandidateId })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { lines: [expect.objectContaining({ quantity: 1 }), expect.objectContaining({ quantity: 3 })] } })
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
    const menuSelections: Array<string | undefined> = []
    const runtime = createMenuToolRuntime({
      onAction: (action) => {
        actions.push(action)
      },
      onCartChange: () => {},
      onMenuSelection: itemId => menuSelections.push(itemId),
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
      { controlId: 'chous-shrimp-roll:add', label: '加入購物車', targetId: 'chous-shrimp-roll' },
    ])
    expect(menuSelections).toEqual(['chous-shrimp-roll', undefined])
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

  it('releases a prior runtime registration before a replacement runtime reuses the tool names', async () => {
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
      const firstRuntime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      const replacementRuntime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      await firstRuntime.registerNativeWebMcp()

      await expect(replacementRuntime.registerNativeWebMcp()).resolves.toBeTypeOf('function')
      expect(registeredNames.size).toBe(replacementRuntime.toolDefinitions.length)
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

  it('lets the kiosk host read semantic candidates through native WebMCP', async () => {
    const registeredTools: Array<{
      name: string
      execute: (input: Record<string, unknown>) => Promise<unknown>
    }> = []
    vi.stubGlobal('document', { modelContext: { registerTool: async (tool: typeof registeredTools[number]) => {
      registeredTools.push(tool)
    } } })

    try {
      const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      runtime.setMenu(menu)
      await runtime.registerNativeWebMcp()
      const context = registeredTools.find(tool => tool.name === 'kiosk_fast_path_context')
      const state = registeredTools.find(tool => tool.name === 'kiosk_interaction_state')
      if (!context || !state)
        throw new Error('Expected Kiosk host tools to be registered.')

      await expect(context.execute({ transcript: '周氏蝦捲' })).resolves.toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]), phase: 'ordering' })
      await expect(state.execute({})).resolves.toMatchObject({ phase: 'ordering' })
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
      { controlId: 'chous-shrimp-roll:add', label: '加入購物車', targetId: 'chous-shrimp-roll' },
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

    const multipleDishSearch = await runtime.invoke('menu_get', { queries: ['水餃', '擔仔麵'] }) as {
      items: Array<{ id: string, name: string }>
    }
    expect(multipleDishSearch.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cabbage-dumplings', name: '高麗菜水餃' }),
      expect.objectContaining({ id: 'chive-dumplings', name: '韭菜水餃' }),
      expect.objectContaining({ id: 'danzai-noodles', name: '周氏擔仔麵' }),
    ]))
  })

  it('recommends only catalog items that satisfy every stated customer need', async () => {
    const presentations: unknown[] = []
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onRecommendationsChange: presentation => presentations.push(presentation),
    })

    await expect(runtime.invoke('menu_recommend', { needs: ['fried', 'pork-free'], limit: 2 })).resolves.toMatchObject({
      items: [
        { id: 'chous-shrimp-roll', name: '周氏蝦捲' },
        { id: 'tofu-skin-shrimp-roll', name: '豆皮鮮蝦捲' },
      ],
      needs: ['fried', 'pork-free'],
      presentation: {
        kind: 'recommendation',
        itemIds: ['chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
        title: '為你推薦',
      },
    })
    await expect(runtime.invoke('menu_recommend', { needs: ['rice', 'pork-free'] })).resolves.toMatchObject({ items: [] })
    expect(presentations).toEqual([{
      kind: 'recommendation',
      itemIds: ['chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
      title: '為你推薦',
    }])
  })

  it('uses the store default recommendation order when the customer has not stated a preference', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })

    await expect(runtime.invoke('menu_recommend')).resolves.toMatchObject({
      items: [{ id: 'fish-floss-minced-pork-rice-set', name: '魚鬆肉燥飯套餐' }],
      needs: [],
      presentation: {
        kind: 'recommendation',
        itemIds: ['fish-floss-minced-pork-rice-set'],
        reason: '先從店內招牌與熱門餐點開始，第一次點餐也很適合。',
        title: '店家招牌推薦',
      },
    })
  })

  it('shows filtered menu results without requiring another model tool call', async () => {
    const presentations: unknown[] = []
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onRecommendationsChange: presentation => presentations.push(presentation),
    })

    await expect(runtime.invoke('menu_get', { query: '蝦捲' })).resolves.toMatchObject({
      presentation: {
        kind: 'query-results',
        itemIds: ['fish-floss-minced-pork-rice-set', 'chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
        title: '與「蝦捲」相關的餐點',
      },
    })

    expect(presentations).toEqual([{
      kind: 'query-results',
      itemIds: ['fish-floss-minced-pork-rice-set', 'chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
      subjects: [{
        id: 'query:蝦捲',
        itemIds: ['fish-floss-minced-pork-rice-set', 'chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
        label: '蝦捲',
      }],
      title: '與「蝦捲」相關的餐點',
    }])
  })

  it('shows every matched dish when one customer names multiple dishes', async () => {
    const presentations: unknown[] = []
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onRecommendationsChange: presentation => presentations.push(presentation),
    })

    await expect(runtime.invoke('menu_get', { queries: ['水餃', '擔仔麵'] })).resolves.toMatchObject({
      presentation: {
        kind: 'query-results',
        itemIds: ['cabbage-dumplings', 'danzai-noodles', 'chive-dumplings'],
        subjects: [
          { id: 'query:水餃', itemIds: ['cabbage-dumplings', 'chive-dumplings'], label: '水餃' },
          { id: 'query:擔仔麵', itemIds: ['danzai-noodles'], label: '擔仔麵' },
        ],
        title: '顧客提到的餐點',
      },
    })
    expect(presentations).toEqual([{
      kind: 'query-results',
      itemIds: ['cabbage-dumplings', 'danzai-noodles', 'chive-dumplings'],
      subjects: [
        { id: 'query:水餃', itemIds: ['cabbage-dumplings', 'chive-dumplings'], label: '水餃' },
        { id: 'query:擔仔麵', itemIds: ['danzai-noodles'], label: '擔仔麵' },
      ],
      title: '顧客提到的餐點',
    }])
  })

  it('keeps a less numerous customer subject in the compact related-menu preview', async () => {
    const posLikeMenu = [
      ...menu.slice(0, 5).map((item, index) => ({
        ...item,
        category: '便當',
        id: `bento-${index + 1}`,
        name: `招牌便當 ${index + 1}`,
      })),
      { ...menu[5]!, category: '麵食', id: 'beef-noodles', name: '牛肉麵' },
    ]
    const runtime = createMenuToolRuntime({
      menu: posLikeMenu,
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })

    await expect(runtime.invoke('menu_get', { queries: ['便當', '麵'] })).resolves.toMatchObject({
      presentation: {
        itemIds: ['bento-1', 'beef-noodles', 'bento-2', 'bento-3'],
        subjects: [
          { id: 'query:便當', itemIds: ['bento-1', 'bento-2', 'bento-3', 'bento-4', 'bento-5'] },
          { id: 'query:麵', itemIds: ['beef-noodles'] },
        ],
      },
    })
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
      customerMessage: '我推薦：周氏擔仔麵、古早味冬瓜茶。',
      items: [
        { id: 'danzai-noodles', name: '周氏擔仔麵' },
        { id: 'winter-melon-tea', name: '古早味冬瓜茶' },
      ],
    })
    expect(presentations).toEqual([{
      kind: 'recommendation',
      itemIds: ['danzai-noodles', 'winter-melon-tea'],
      reason: '一碗主食配一杯飲料。',
      title: '今天想吃得剛剛好',
    }])
    await expect(runtime.invoke('menu_show_recommendations', { itemIds: ['not-a-menu-item'] })).rejects.toThrow('Menu item not-a-menu-item was not found.')
  })
})
