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

// Report: this chat,Nov5 — other dishes/full menu cannot escape the recommendation screen.
it('changes recommendation batches, queries another dish, then returns to all menu items', async () => {
  vi.stubEnv('VITE_AIRI_ORIGIN', window.location.origin)
  const view = render(App)
  try {
    await expect.element(view.getByRole('button', { name: '查看餐點6', exact: true })).toBeVisible()
    const runtime = vi.mocked(connectInteractiveService).mock.calls.at(-1)![0]
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
