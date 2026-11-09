import type { CheckoutToolController } from '../webmcp'
import type { CheckoutSnapshot } from './checkout-flow'
import type { CartSnapshot } from './order-machine'

import { describe, expect, it, vi } from 'vitest'

import { createMenuToolRuntime } from '../webmcp'
import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from './checkout-flow'
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
    expect(() => machine.selectMenuItem(soldOutItem.id)).toThrow('目前售完')
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
    await expect(machine.confirmOrder()).rejects.toThrow('Choose dine-in or self-pickup before confirming the order.')

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
    expect(menu.find(item => item.id === 'chous-shrimp-roll')).toMatchObject({ name: '蝦捲', price: 75 })
    expect(menu.find(item => item.id === 'danzai-noodles')).toMatchObject({ name: '擔仔麵', price: 65 })
    expect(menu.find(item => item.id === 'almond-red-bean-tofu')).toMatchObject({ name: '杏仁紅豆豆腐', price: 55 })
    expect(menu.find(item => item.id === 'fish-floss-minced-pork-rice-set')).toMatchObject({
      name: '魚鬆肉燥飯套餐',
      optionGroups: [
        { id: 'set-ginger', label: '蝦捲嫩薑' },
        { id: 'set-soup-cilantro', label: '綜合湯香菜' },
      ],
      price: 380,
    })
    expect(defaultOptionsFor(menu.find(item => item.id === 'braised-pork-set')!)).toEqual({})
    expect(menu.find(item => item.id === 'cuttlefish-ball')?.imageUrl).toMatch(/^data:image\/svg\+xml/)
    expect(defaultOptionsFor(menu.find(item => item.id === 'chous-shrimp-roll')!)).toEqual({ ginger: 'with-ginger' })
    expect(catalogInfo).toMatchObject({ isSimulated: true, sourceName: '示範菜單' })
  })
})

describe('createMenuToolRuntime', () => {
  it('offers dine-in and immediate self-pickup consistently to menu and semantic decisions', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await expect(runtime.invoke('menu_get')).resolves.toMatchObject({ fulfillmentModes: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }] })
    await expect(runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })).resolves.toMatchObject({ pendingCustomerChoice: { question: '請問要內用還是自取？', purpose: 'fulfillment', choices: [{ slots: { mode: 'dine-in' } }, { slots: { mode: 'takeout' } }] } })
    await expect(runtime.invoke('kiosk_fast_path_context', { transcript: '自取' })).resolves.toMatchObject({ candidates: expect.arrayContaining([{ id: 'intent:set-fulfillment:takeout', description: expect.stringContaining('設為自取'), requiresHighConfidence: true }]) })
    await expect(runtime.invoke('order_set_fulfillment', { mode: 'takeout' })).resolves.toMatchObject({ customerMessage: '已設為自取。', cart: { fulfillmentMode: 'takeout' } })
  })

  // Report: docs/plans/2026-10-22-kiosk-field-investigation.md; a full catalog must not be replaced by a recommendation continuation.
  it('presents a complete filtered catalog without scheduling a second recommendation batch', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '有哪些不要豬肉的' })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', ingredientFilters: { excludeIngredients: ['pork'] } })
    expect(result).toMatchObject({ presentation: { kind: 'query-results', title: '成分篩選：排除豬肉' }, appliedFilters: { excludeIngredients: ['pork'] } })
    expect(result).not.toHaveProperty('continuation')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('does not activate an unasked suggestion and preserves the unanswered question after a price lookup', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('menu_select_item', { itemId: 'chous-shrimp-roll' })
    const added = await runtime.invoke('cart_add_item') as { pendingCustomerChoice: { questionId: string } }
    await expect(runtime.invoke('kiosk_fast_path_context')).resolves.not.toHaveProperty('waitingFor')
    await runtime.invoke('kiosk_dialogue_presented', { content: '已加入，請問要內用還是自取？', questionId: added.pendingCustomerChoice.questionId })
    await expect(runtime.invoke('kiosk_fast_path_context')).resolves.toMatchObject({ waitingFor: { question: '請問要內用還是自取？' } })
    await runtime.invoke('menu_get', { query: '水餃' })
    await runtime.invoke('kiosk_dialogue_presented', { content: '一份水餃 60 元。' })
    await expect(runtime.invoke('kiosk_fast_path_context')).resolves.toMatchObject({ waitingFor: { question: '請問要內用還是自取？' } })
  })
  function checkoutController(overrides: Partial<CheckoutToolController> = {}): CheckoutToolController {
    return {
      assertCanRestart: () => {},
      cancel: () => {},
      chooseInvoice: method => ({ invoiceMethod: method, stage: 'payment' }),
      confirmInvoice: () => { throw new Error('Unexpected invoice confirmation in this fixture') },
      confirmTaxId: () => ({ invoiceMethod: 'tax-id', stage: 'payment', taxId: '12345678' }),
      paymentStatus: () => undefined,
      revision: () => 0,
      requestTaxId: () => ({ invoiceMethod: 'tax-id', stage: 'tax-id', taxId: '' }),
      restart: () => {},
      selectPayment: async method => ({ customerMessage: `等待${method}`, status: 'selected' }),
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

  it('declares Menu tools from the same runtime used by the menu UI', () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(runtime.toolDefinitions.map(tool => tool.name)).toEqual([
      'kiosk_ordering_reset',
      'kiosk_fast_path_clarify',
      'kiosk_query_scope',
      'kiosk_agent_task',
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
      'order_answer_confirmation',
      'cart_get',
      'order_set_fulfillment',
      'checkout_start',
      'checkout_skip_membership',
      'checkout_choose_invoice',
      'checkout_request_tax_id',
      'checkout_set_tax_id',
      'checkout_confirm_invoice',
      'checkout_confirm_tax_id',
      'checkout_select_payment',
      'checkout_cancel',
      'kiosk_interaction_state',
      'kiosk_conversation_context',
      'menu_confirm_item',
      'kiosk_fast_path_context',
      'kiosk_fast_path_execute',
      'kiosk_fast_path_continue',
      'order_ask_question',
      'order_cancel_request',
      'order_defer_question',
      'kiosk_dialogue_presented',
      'kiosk_question_validate',
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
    expect(afterAdding.references).toEqual([
      { label: expect.stringContaining('蝦捲'), refId: 'CART_LINE_1' },
    ])
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

    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '蝦捲改成兩份' }) as { candidates: Array<{ id: string }> }
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
    expect(clarification.candidates).toHaveLength(3)
    expect(clarification.candidates[2]!.id).toMatch(/^clarify:.+:cancel$/)
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: clarification.candidates[1]!.id })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { lines: [expect.objectContaining({ quantity: 2 })] } })
  })

  it('keeps REMOVE_ITEM bound to two real same-name cart lines and rejects stale clarification', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', options: [{ groupId: 'ginger', valueId: 'with-ginger' }] })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll', options: [{ groupId: 'ginger', valueId: 'without-ginger' }] })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '蝦捲不要了' }) as { candidates: Array<{ id: string }> }
    expect(context.candidates.filter(candidate => candidate.id === 'intent:remove-item')).toHaveLength(1)
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:remove-item' })).resolves.toMatchObject({
      pendingClarification: { candidateRefs: [expect.stringContaining('cart:'), expect.stringContaining('cart:')], intent: 'REMOVE_ITEM' },
    })
    const clarification = await runtime.invoke('kiosk_fast_path_context', { transcript: '第二筆' }) as { candidates: Array<{ id: string, description: string }> }
    expect(clarification.candidates[1]!.id).toMatch(/^clarify:.+:1$/)
    const cart = await runtime.invoke('cart_get') as { cart: { lines: Array<{ id: string }> } }
    await runtime.invoke('cart_set_line_quantity', { lineId: cart.cart.lines[0]!.id, quantity: 2 })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: clarification.candidates[1]!.id })).rejects.toThrow('stale')
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
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '蝦捲改成兩份' }) as { candidates: Array<{ id: string }> }
    const quantityId = context.candidates.find(candidate => candidate.id === 'intent:set-quantity')?.id
    expect(quantityId).toBeDefined()

    const cart = await runtime.invoke('cart_get') as { cart: { lines: Array<{ id: string }> } }
    await runtime.invoke('cart_set_line_quantity', { lineId: cart.cart.lines[0]!.id, quantity: 2 })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: quantityId })).rejects.toThrow('STALE_PLAN')
  })

  it('rejects a stale plan even when a touch edit restores the original cart snapshot', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '蝦捲改成兩份' })
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
    expect(context.references).toEqual(expect.arrayContaining([expect.objectContaining({ label: expect.stringContaining('蝦捲') })]))

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
    await runtime.invoke('kiosk_fast_path_context', { transcript: '蝦捲不要了' })
    await runtime.invoke('menu_select_item', { itemId: 'braised-pork-set' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:remove-item' })
    await expect(runtime.invoke('cart_get')).resolves.toMatchObject({ cart: { itemCount: 0 } })
  })

  it('rejects an issued item plan after the POS catalog changes', async () => {
    const item = menu.find(candidate => candidate.id === 'chous-shrimp-roll')!
    const runtime = createMenuToolRuntime({ menu: [item], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要蝦捲' })
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
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
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

  it.each([
    { method: 'linepay', source: 'voice' },
    { method: 'jkopay', source: 'voice' },
    { method: 'linepay', source: 'agent' },
    { method: 'jkopay', source: 'agent' },
  ] as const)('selects $method through $source without asking for confirmation or starting payment', async ({ method, source }) => {
    const selectPayment = vi.fn(async () => ({ customerMessage: '已選擇，尚未付款。', status: 'selected' as const }))
    let payment: 'pending' | 'uncertain' | undefined
    const runtime = createMenuToolRuntime({ checkout: checkoutController({ selectPayment, snapshot: () => ({ stage: 'payment' }), paymentMethods: ['linepay', 'jkopay'], paymentStatus: () => payment }), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: `使用${method}` })
    const result = source === 'voice'
      ? await runtime.invoke('kiosk_fast_path_execute', { candidateId: `intent:select-payment:${method}` })
      : await runtime.invokeForAgent('checkout_select_payment', { method })
    expect(result).toMatchObject({ payment: { method, status: 'selected' }, customerMessage: '已選擇，尚未付款。' })
    expect(result).not.toHaveProperty('pendingConfirmation')
    expect(selectPayment).toHaveBeenCalledExactlyOnceWith(method)
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'checkout_payment_select', paymentState: 'idle' })
    payment = 'pending'
    await expect(runtime.invokeForAgent('checkout_select_payment', { method })).rejects.toThrow('PAYMENT_IN_PROGRESS')
    payment = 'uncertain'
    await expect(runtime.invokeForAgent('checkout_select_payment', { method })).rejects.toThrow('PAYMENT_IN_PROGRESS')
    expect(selectPayment).toHaveBeenCalledTimes(1)
  })

  it('selects a spoken method once per issued execution ticket', async () => {
    const selectPayment = vi.fn(async () => ({ customerMessage: '已選擇信用卡，尚未付款。', status: 'selected' as const }))
    const runtime = createMenuToolRuntime({ checkout: checkoutController({ selectPayment, snapshot: () => ({ stage: 'payment' }) }), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '信用卡' })
    expect(context).toMatchObject({ phase: 'checkout_payment_select', allowedPaymentMethods: ['card', 'mobile'] })
    const selected = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:select-payment:card' })
    expect(selected).toMatchObject({ payment: { method: 'card', status: 'selected' }, decisionTrace: { authorize: { kind: 'EXECUTE' } } })
    expect(selected).not.toHaveProperty('pendingConfirmation')
    expect(selectPayment).toHaveBeenCalledExactlyOnceWith('card')
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:select-payment:card' })).rejects.toThrow('expired')
    expect(selectPayment).toHaveBeenCalledTimes(1)
  })

  it('applies the same phase validation and direct method selection to Agent calls', async () => {
    const selectPayment = vi.fn(async () => ({ customerMessage: '已選擇信用卡，尚未付款。', status: 'selected' as const }))
    const runtime = createMenuToolRuntime({ checkout: checkoutController({ selectPayment, snapshot: () => ({ stage: 'payment' }) }), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    await expect(runtime.invokeForAgent('order_add_item', { itemId: 'chous-shrimp-roll' })).rejects.toThrow('INVALID_PHASE')
    const selected = await runtime.invokeForAgent('checkout_select_payment', { method: 'card' })
    expect(selected).toMatchObject({ payment: { method: 'card', status: 'selected' } })
    expect(selected).not.toHaveProperty('pendingConfirmation')
    expect(selectPayment).toHaveBeenCalledExactlyOnceWith('card')
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
    expect(clarification.resolvedCandidateId).toMatch(/^clarify:.+:0$/)
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
    let checkout: CheckoutSnapshot | undefined
    const controller = checkoutController({
      snapshot: () => checkout,
      cancel: () => calls.push('cancel'),
      chooseInvoice: (method) => {
        calls.push(`invoice:${method}`)
        return checkout = chooseInvoiceMethod(checkout!, method)
      },
      confirmInvoice: () => { throw new Error('Unexpected invoice confirmation in this fixture') },
      confirmTaxId: () => {
        calls.push('confirm-tax-id')
        return checkout = confirmTaxId(checkout!)
      },
      requestTaxId: () => {
        calls.push('request-tax-id')
        return checkout = requestTaxId(checkout!)
      },
      selectPayment: async (method) => {
        calls.push(`payment:${method}`)
        return { customerMessage: '等待顧客操作終端。', status: 'selected' }
      },
      setTaxId: (taxId) => {
        calls.push(`tax-id:${taxId}`)
        return checkout = setTaxIdDraft(checkout!, taxId)
      },
      skipMembership: () => {
        calls.push('skip-membership')
        return checkout = skipMembership(checkout!)
      },
      start: () => {
        calls.push('start')
        return checkout = beginCheckout()
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

  it.each(['checkout', 'payment'] as const)('does not replace %s with broad Agent menu exploration', async (phase) => {
    const onRecommendationsChange = vi.fn()
    const runtime = createMenuToolRuntime({
      checkout: checkoutController({ snapshot: () => ({ stage: 'membership' }), paymentStatus: () => phase === 'payment' ? 'pending' : undefined }),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onRecommendationsChange,
    })
    await expect(runtime.invokeForAgent('menu_get')).rejects.toThrow('Menu exploration is unavailable')
    await expect(runtime.invoke('menu_get', { display: true })).rejects.toThrow('Menu exploration is unavailable')
    expect(onRecommendationsChange).not.toHaveBeenCalled()
    expect(await runtime.invokeForAgent('menu_get', { display: false })).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: 'chous-shrimp-roll' })]) })
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
        purpose: 'fulfillment',
        questionId: expect.any(String),
      },
    })

    expect(actions).toEqual([
      { label: '正在選擇蝦捲', targetId: 'chous-shrimp-roll' },
      {
        controlId: 'chous-shrimp-roll:option:ginger:without-ginger',
        expandCustomization: true,
        label: '設定為不附嫩薑',
        targetId: 'chous-shrimp-roll',
      },
      { controlId: 'item:quantity:chous-shrimp-roll:increase', label: '設定數量為 2', targetId: 'chous-shrimp-roll' },
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
    expect(removeItem?.description).toContain('執行成功後')
    expect(removeItem?.description).toContain('cart_get')
  })

  it('routes approved host context separately from Agent tools', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.executeTool('kiosk_fast_path_context', { transcript: '蝦捲' })).toMatchObject({ phase: 'ordering' })
    await expect(runtime.invokeForAgent('kiosk_fast_path_context', {})).rejects.toThrow('unavailable to the Agent')
    expect(await runtime.executeTool('menu_recommend', { action: 'update', needs: ['fried'] })).toMatchObject({ needs: ['fried'] })
  })

  it('preserves actionable domain refusals through the transport entry', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.executeTool('menu_select_item', {})).toMatchObject({ ok: false, recovery: expect.stringContaining('menu_get') })
    expect(await runtime.executeTool('order_add_item', { itemId: 'missing', quantity: 1 })).toMatchObject({ ok: false })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  it('starts checkout through the transport entry without completing an order', async () => {
    const completedOrders: string[] = []
    const runtime = createMenuToolRuntime({ checkout: checkoutController(), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onOrderConfirmed: order => completedOrders.push(order.id) })
    await runtime.executeTool('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.executeTool('cart_add_item', {})
    await runtime.executeTool('order_set_fulfillment', { mode: 'dine-in' })
    expect(await runtime.executeTool('checkout_start', { confirmedByUser: true })).toMatchObject({ checkout: { stage: 'membership' } })
    expect(completedOrders).toHaveLength(0)
  })

  it('keeps checkout recovery guidance in a failed tool receipt', async () => {
    const runtime = createMenuToolRuntime({
      checkout: checkoutController({
        start: () => { throw new Error('Choose dine-in or self-pickup before starting checkout.') },
      }),
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await runtime.executeTool('menu_select_item', { itemId: 'chous-shrimp-roll' })
    await runtime.executeTool('cart_add_item', {})
    expect(await runtime.executeTool('checkout_start', { confirmedByUser: true })).toMatchObject({ ok: false, recovery: expect.stringContaining('order_set_fulfillment') })
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
      { label: '正在選擇蝦捲', targetId: 'chous-shrimp-roll' },
      {
        controlId: 'chous-shrimp-roll:option:ginger:without-ginger',
        expandCustomization: true,
        label: '設定為不附嫩薑',
        targetId: 'chous-shrimp-roll',
      },
      { controlId: 'item:quantity:chous-shrimp-roll:increase', label: '設定數量為 2', targetId: 'chous-shrimp-roll' },
      { controlId: 'chous-shrimp-roll:add', label: '加入購物車', targetId: 'chous-shrimp-roll' },
      { controlId: 'order:view', label: '查看訂單', targetId: 'cart' },
      { controlId: 'order:fulfillment:takeout', label: '設定為自取', targetId: 'cart' },
      { controlId: 'order:view', label: '查看訂單', targetId: 'cart' },
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
      catalog: { isSimulated: true, sourceName: '示範菜單' },
      categories: ['超值套餐', '招牌小吃', '麵飯主食', '湯品', '炸物小點', '甜品', '飲品'],
    })
    expect(fullCatalog.items).toHaveLength(menu.length)
    expect(fullCatalog.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chous-shrimp-roll', name: '蝦捲' }),
      expect.objectContaining({ id: 'braised-pork-set', name: '東坡肉套餐' }),
      expect.objectContaining({ id: 'winter-melon-tea', name: '古早味冬瓜茶' }),
    ]))
    const shrimpRollSearch = await runtime.invoke('menu_get', { query: '蝦捲' }) as {
      items: Array<{ id: string, name: string }>
    }
    expect(shrimpRollSearch.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'chous-shrimp-roll', name: '蝦捲' }),
      expect.objectContaining({ id: 'tofu-skin-shrimp-roll', name: '豆皮鮮蝦捲' }),
    ]))

    expect(shrimpRollSearch.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fish-floss-minced-pork-rice-set' })]))

    const multipleDishSearch = await runtime.invoke('menu_get', { queries: ['水餃', '擔仔麵'] }) as {
      items: Array<{ id: string, name: string }>
    }
    expect(multipleDishSearch.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cabbage-dumplings', name: '高麗菜水餃' }),
      expect.objectContaining({ id: 'chive-dumplings', name: '韭菜水餃' }),
      expect.objectContaining({ id: 'danzai-noodles', name: '擔仔麵' }),
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

    await expect(runtime.invoke('menu_recommend', { needs: ['fried'], excludeIngredients: ['pork'], limit: 2 })).resolves.toMatchObject({
      items: [
        { id: 'chous-shrimp-roll', name: '蝦捲' },
        { id: 'tofu-skin-shrimp-roll', name: '豆皮鮮蝦捲' },
      ],
      needs: ['fried'],
      presentation: {
        kind: 'recommendation',
        itemIds: ['chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
        title: '排除豬肉',
      },
    })
    const offer = await runtime.invoke('menu_recommend', { needs: ['rice'], excludeIngredients: ['pork'] }) as { pendingCustomerChoice: { questionId: string } }
    await expect(runtime.invoke('kiosk_query_scope', { questionId: offer.pendingCustomerChoice.questionId, choice: 'CATALOG' })).resolves.toMatchObject({ items: [] })
    expect(presentations).toEqual([{
      kind: 'recommendation',
      itemIds: ['chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
      title: '排除豬肉',
    }, { kind: 'recommendation', itemIds: [], title: '整份菜單 · 排除豬肉' }])
  })

  it('uses the store default recommendation order when the customer has not stated a preference', async () => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })

    await expect(runtime.invoke('menu_recommend')).resolves.toMatchObject({
      items: [{ id: 'fish-floss-minced-pork-rice-set', name: '魚鬆肉燥飯套餐' }, { id: 'braised-pork-set', name: '東坡肉套餐' }, { id: 'chous-shrimp-roll', name: '蝦捲' }],
      needs: [],
      presentation: {
        kind: 'recommendation',
        itemIds: ['fish-floss-minced-pork-rice-set', 'braised-pork-set', 'chous-shrimp-roll'],
        reason: '從目前供應的餐點中提供幾個選擇。',
        title: '為你推薦',
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
        itemIds: ['chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
        title: '與「蝦捲」相關的餐點',
      },
    })

    expect(presentations).toEqual([{
      kind: 'query-results',
      itemIds: ['chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
      subjects: [{
        id: 'query:蝦捲',
        itemIds: ['chous-shrimp-roll', 'tofu-skin-shrimp-roll'],
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
      customerMessage: '我推薦：擔仔麵、古早味冬瓜茶。 您想點哪一道？',
      items: [
        { id: 'danzai-noodles', name: '擔仔麵' },
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
