import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import App from '../../../order-menu/src/App.vue'

vi.mock('../../../order-menu/src/pos-catalog', () => ({ fetchPosCatalog: vi.fn(async () => ({
  revision: 'table-browser-1',
  items: [{ id: 'dumplings', name: '水餃', description: '', category: '點心', price: 80, imageUrl: '', recommendationTags: [], optionGroups: [] }],
  store: { name: '測試店', slogan: '', symbol: '', fulfillmentModes: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }] },
})) }))

it('uses actual Menu touch controls to confirm a table order without fulfillment or payment screens', async () => {
  vi.stubEnv('VITE_ORDER_MENU_SERVER_URL', 'http://bridge.test')
  const sent: Array<Record<string, unknown>> = []
  const requests: string[] = []
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/v1/ordering-context'))
      return Response.json({ context: { id: 'round-1', serviceMode: 'table-service', table: { id: 'a03', label: 'a03' }, directSubmissionSupported: true } })
    if (url.endsWith('/v1/table-orders')) {
      const body = JSON.parse(String(init?.body))
      sent.push(body)
      return Response.json({ order: { id: 'table-order-1', serviceMode: 'table-service', table: { id: 'a03', label: 'a03' }, cart: { ...body.cart, fulfillmentMode: 'dine-in' }, receipt: { environment: 'test', status: 'accepted', retryable: false, customerMessage: '本桌訂單已送出。' } } }, { status: 201 })
    }
    throw new Error(`Unexpected external request: ${url}`)
  })
  const screen = render(App)
  try {
    await screen.getByRole('button', { name: '查看水餃' }).click()
    await screen.getByRole('button', { name: '加入購物車', exact: true }).click()
    await screen.getByRole('button', { name: '查看訂單', exact: true }).click()
    await expect.element(screen.getByText('桌號 a03', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: '內用', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: '自取', exact: true })).not.toBeInTheDocument()
    expect(sent).toHaveLength(0)
    await screen.getByRole('button', { name: '確認訂單，直接送出' }).click()
    await expect.element(screen.getByText('本桌訂單已送出。', { exact: true })).toBeVisible()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ contextId: 'round-1', confirmedByUser: true })
    expect(sent[0]!.cart).not.toHaveProperty('paymentId')
    expect(requests.some(url => url.includes('/v1/payments'))).toBe(false)
    await expect.element(screen.getByRole('heading', { name: '選擇付款方式', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByText(/取餐號碼/)).not.toBeInTheDocument()
  }
  finally {
    screen.unmount()
    fetchMock.mockRestore()
    vi.unstubAllEnvs()
  }
})
