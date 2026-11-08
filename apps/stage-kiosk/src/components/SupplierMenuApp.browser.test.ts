import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import App from '../../../order-menu/src/App.vue'

import { supplierCatalog } from '../../../order-menu-server/src/supplierSimulation'

afterEach(() => vi.restoreAllMocks())

it.each(['kiosk', 'table-service'] as const)('uses the new merchant API and actual controls in %s mode', async (serviceMode) => {
  const requests: string[] = []
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    requests.push(url)
    if (url === 'http://bridge.test/supplier/v1/catalog')
      return Response.json({ catalog: supplierCatalog })
    if (url === 'http://bridge.test/supplier/v1/ordering-context')
      return Response.json({ context: { id: 'supplier-round', serviceMode, ...(serviceMode === 'table-service' ? { table: { id: 'a08', label: 'a08' } } : {}), directSubmissionSupported: true } })
    throw new Error(`Unexpected merchant request: ${url}`)
  })
  const screen = render(App, { props: { variant: 'supplier', bridgeUrl: 'http://bridge.test/supplier', merchant: { id: 'shalun-simulation', operatorName: '周氏蝦捲', paymentPolicy: 'cashless' } } })
  try {
    await expect.element(screen.getByRole('note')).toHaveTextContent('模擬示意')
    await screen.getByRole('button', { name: /^周氏水餃/ }).click()
    await screen.getByRole('button', { name: /^加2顆/ }).click()
    await screen.getByRole('button', { name: '增加一份', exact: true }).click()
    await screen.getByRole('button', { name: '減少一份', exact: true }).click()
    await screen.getByRole('button', { name: '加入購物車', exact: true }).click()
    await screen.getByRole('button', { name: '查看訂單', exact: true }).click()
    await expect.element(screen.getByRole('region', { name: '訂單總計' })).toHaveTextContent('80元')
    await expect.element(screen.getByRole('button', { name: '加2顆+16元', exact: true })).toHaveAttribute('aria-pressed', 'true')
    if (serviceMode === 'table-service') {
      await expect.element(screen.getByRole('button', { name: '自取', exact: true })).not.toBeInTheDocument()
      await expect.element(screen.getByRole('button', { name: '確認訂單，直接送出' })).toBeEnabled()
    }
    else {
      await screen.getByRole('button', { name: '自取', exact: true }).click()
      await expect.element(screen.getByRole('button', { name: '確認訂單，進入結帳' })).toBeEnabled()
    }
    await screen.getByRole('button', { name: '移除', exact: true }).click()
    await expect.element(screen.getByText('尚未加入餐點，返回菜單開始點餐。')).toBeVisible()
    expect(requests.every(url => url.startsWith('http://bridge.test/supplier/'))).toBe(true)
    expect(fetchMock).toHaveBeenCalled()
  }
  finally { screen.unmount() }
})
