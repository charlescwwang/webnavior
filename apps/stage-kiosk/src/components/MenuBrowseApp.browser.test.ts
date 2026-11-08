import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import App from '../../../order-menu/src/App.vue'

import { connectInteractiveService } from '../../../order-menu/src/interactiveService'

// Only external catalog IO and the host transport are replaced; App owns the real runtime/UI.
vi.mock('../../../order-menu/src/pos-catalog', () => ({ fetchPosCatalog: vi.fn(async () => ({
  revision: 'browse-regression',
  items: Array.from({ length: 7 }, (_, i) => ({ id: `dish-${i}`, name: `餐點${i}`, description: '', category: i < 4 ? '便當' : '點心', price: 80 + i, imageUrl: '', recommendationTags: [], optionGroups: [] })),
  store: { name: '測試店', slogan: '', symbol: '', fulfillmentModes: [{ id: 'takeout', label: '自取' }] },
})) }))
vi.mock('../../../order-menu/src/interactiveService', () => ({ connectInteractiveService: vi.fn(() => () => {}) }))

// Report: this chat, Nov08 — a cart request behind an unfinished dialog must await the choice.
it('keeps the actual draft dialog until cancellation, then clicks its X before opening the cart', async () => {
  vi.stubEnv('VITE_AIRI_ORIGIN', window.location.origin)
  const view = render(App)
  const clicks: string[] = []
  const observe = (event: MouseEvent) => {
    if (event.target instanceof HTMLElement)
      clicks.push(event.target.closest('button')?.getAttribute('aria-label') ?? event.target.textContent?.trim() ?? '')
  }
  document.addEventListener('click', observe)
  try {
    await expect.element(view.getByRole('button', { name: '查看餐點0', exact: true })).toBeVisible()
    const runtime = vi.mocked(connectInteractiveService).mock.calls.at(-1)![0]
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要餐點0' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const result = await runtime.invoke('cart_get', { display: true })
    expect(result).toMatchObject({ pendingCustomerChoice: { purpose: 'draft-navigation' } })
    await expect.element(view.getByRole('button', { name: '關閉', exact: true })).toBeVisible()
    expect(clicks).not.toContain('關閉')
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '取消這道再看購物車' }) as { waitingFor: { choices: Array<{ id: string }> } }
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: context.waitingFor.choices[1]!.id })
    expect(clicks).toContain('關閉')
    await expect.element(view.getByRole('button', { name: '繼續點餐', exact: true })).toBeVisible()
    await expect.element(view.getByRole('dialog')).not.toBeInTheDocument()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }
  finally {
    document.removeEventListener('click', observe)
    view.unmount()
  }
})

// Report: this chat,Nov5 — other dishes/full menu cannot escape the recommendation screen.
it('changes recommendation batches, queries another dish, then returns to all menu items', async () => {
  vi.stubEnv('VITE_AIRI_ORIGIN', window.location.origin)
  const view = render(App)
  try {
    await expect.element(view.getByRole('button', { name: '查看餐點6', exact: true })).toBeVisible()
    const runtime = vi.mocked(connectInteractiveService).mock.calls.at(-1)![0]
    expect(runtime.toolDefinitions.map(tool => tool.name)).not.toContain('kiosk_customer_entry_start')
    expect(runtime.toolDefinitions.map(tool => tool.name)).not.toContain('kiosk_customer_phone')
    expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ phase: 'ordering' })
    await runtime.invoke('menu_recommend')
    await expect.element(view.getByRole('button', { name: '查看餐點0', exact: true })).toBeVisible()
    expect(view.container.querySelectorAll('.menu-card')).toHaveLength(3)
    await runtime.invoke('menu_recommend', { more: true })
    await expect.element(view.getByRole('button', { name: '查看餐點3', exact: true })).toBeVisible()
    expect(view.container.querySelectorAll('.menu-card')).toHaveLength(3)
    await runtime.invoke('menu_get', { query: '餐點6', display: true })
    await expect.element(view.getByRole('button', { name: '查看餐點6', exact: true })).toBeVisible()
    expect(view.container.querySelectorAll('.menu-card')).toHaveLength(1)
    await runtime.invoke('menu_open')
    await expect.element(view.getByRole('button', { name: '查看餐點0', exact: true })).toBeVisible()
    expect(view.container.querySelectorAll('.menu-card')).toHaveLength(7)
    expect(view.container.textContent).not.toMatch(/NT|\$/)
    expect(view.container.textContent).toContain('80元')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }
  finally {
    view.unmount()
    vi.unstubAllEnvs()
  }
})

// A standalone unauthenticated catalog retains the Kiosk flow; the new round
// endpoint grants table ordering only to a verified device.
beforeEach(() => {
  vi.stubEnv('VITE_ORDER_MENU_SERVER_URL', 'http://bridge.test')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).includes('/v1/ordering-context'))
      return new Response(null, { status: 401 })
    throw new Error(`Unexpected external request: ${String(input)}`)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// Report: this chat, Nov08; actual App handlers must execute the visible clicks,
// including repeated decreases, without reentering a second manual operation.
it('executes the App controls under Agent ownership and preserves quantities exactly', async () => {
  vi.stubEnv('VITE_AIRI_ORIGIN', window.location.origin)
  const view = render(App)
  const clicks: string[] = []
  const observe = (event: MouseEvent) => {
    if (event.target instanceof HTMLElement)
      clicks.push(event.target.closest('button')?.getAttribute('aria-label') ?? event.target.textContent?.trim() ?? '')
  }
  document.addEventListener('click', observe)
  try {
    await expect.element(view.getByRole('button', { name: '查看餐點0', exact: true })).toBeVisible()
    const runtime = vi.mocked(connectInteractiveService).mock.calls.at(-1)![0]
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'ui-click', transcript: '餐點0三份', expectedMenuRevision: 1, constraints: {} })
    const added = await runtime.invoke('order_add_item', { itemId: 'dish-0', quantity: 3 }) as { line: { id: string } }
    expect(clicks.filter(label => label === '增加一份')).toHaveLength(2)
    expect(clicks.filter(label => label === '加入購物車')).toHaveLength(1)
    await runtime.invoke('cart_set_line_quantity', { lineId: added.line.id, quantity: 1 })
    expect(clicks.filter(label => label === '減少一份')).toHaveLength(2)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, total: 80 } })
    await runtime.invoke('cart_remove_item', { lineId: added.line.id })
    expect(clicks.filter(label => label === '移除')).toHaveLength(1)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'ui-click' })
    await runtime.invoke('menu_select_item', { itemId: 'dish-1' })
    await expect.element(view.getByRole('button', { name: '關閉', exact: true })).toBeVisible()
    await view.getByRole('button', { name: '關閉', exact: true }).click()
    await expect.element(view.getByRole('dialog')).not.toBeInTheDocument()
  }
  finally {
    document.removeEventListener('click', observe)
    view.unmount()
  }
})

// Report: this chat, Nov08; checkout must use the actual App buttons/input handlers too.
it('clicks checkout, invoice and cancellation controls and fills the real tax-ID field', async () => {
  vi.stubEnv('VITE_AIRI_ORIGIN', window.location.origin)
  const view = render(App)
  try {
    await expect.element(view.getByRole('button', { name: '查看餐點0', exact: true })).toBeVisible()
    const runtime = vi.mocked(connectInteractiveService).mock.calls.at(-1)![0]
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'checkout-click', transcript: '餐點0一份自取並結帳', expectedMenuRevision: 1, constraints: {} })
    await runtime.invoke('order_add_item', { itemId: 'dish-0', quantity: 1 })
    await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
    await runtime.invoke('checkout_start', { confirmedByUser: true })
    await runtime.invoke('checkout_choose_invoice', { method: 'donation' })
    await expect.element(view.getByRole('heading', { name: '選擇付款方式', exact: true })).toBeVisible()
    await runtime.invoke('checkout_cancel', { confirmedByUser: true })
    await runtime.invoke('checkout_start', { confirmedByUser: true })
    await runtime.invoke('checkout_request_tax_id')
    await runtime.invoke('checkout_set_tax_id', { taxId: '12345678' })
    await expect.element(view.getByRole('textbox', { name: '統一編號', exact: true })).toHaveValue('12345678')
    await runtime.invoke('checkout_confirm_tax_id', { confirmedByUser: true })
    await expect.element(view.getByRole('heading', { name: '選擇付款方式', exact: true })).toBeVisible()
    await runtime.invoke('checkout_cancel', { confirmedByUser: true })
    await runtime.invoke('cart_clear', { confirmedByUser: true })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'checkout-click' })
  }
  finally {
    view.unmount()
  }
})
