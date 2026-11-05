import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import OrderContinuation from '../../../order-menu/src/components/orderContinuation.vue'

it.each(['dine-in', 'takeout'])('shows the same pickup number, meals and total on a read-only %s phone receipt', async (mode) => {
  const priorUrl = window.location.href
  vi.stubEnv('VITE_ORDER_MENU_SERVER_URL', 'http://bridge.test')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    environment: 'test',
    readOnly: true,
    pickupNumber: '368',
    orderId: 'order-test-1',
    fulfillmentMode: mode,
    expiresAt: Date.now() + 30 * 60_000,
    lines: [{ name: '排骨便當', quantity: 2 }],
    total: 290,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  const screen = render(OrderContinuation, { props: { token: 'receipt-token' } })
  try {
    await expect.element(screen.getByRole('heading', { name: '訂單資訊' })).toBeVisible()
    await expect.element(screen.getByText('368', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('排骨便當 × 2', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('總計 290元', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: '改為自取', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: /模擬掃描桌碼/ })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/v1/continuations/receipt-token')
  }
  finally {
    screen.unmount()
    fetchMock.mockRestore()
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', priorUrl)
  }
})

it('explains an expired receipt without displaying an unrelated pickup number', async () => {
  vi.stubEnv('VITE_ORDER_MENU_SERVER_URL', 'http://bridge.test')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: '訂單資訊連結已失效，請洽門市人員。' }), { status: 404 }))
  const screen = render(OrderContinuation, { props: { token: 'expired-token' } })
  try {
    await expect.element(screen.getByRole('alert')).toHaveTextContent('訂單資訊連結已失效，請洽門市人員。')
    await expect.element(screen.getByRole('heading', { name: '取餐號碼' })).not.toBeInTheDocument()
  }
  finally {
    screen.unmount()
    fetchMock.mockRestore()
    vi.unstubAllEnvs()
  }
})
