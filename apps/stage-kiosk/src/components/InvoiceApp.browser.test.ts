import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import App from '../../../order-menu/src/App.vue'

// Only the catalog network boundary is replaced. App owns the actual checkout
// snapshot and template event wiring; no substitute parent preloads a draft.
vi.mock('../../../order-menu/src/pos-catalog', () => ({
  fetchPosCatalog: vi.fn(async () => ({
    revision: 'invoice-app-regression',
    items: [{ id: 'dumplings', name: '水餃', description: '測試餐點', category: '點心', price: 80, imageUrl: '', recommendationTags: [], optionGroups: [] }],
    store: { name: '測試店', slogan: '', symbol: '', fulfillmentModes: [{ id: 'takeout', label: '自取' }] },
  })),
}))

describe('actual Menu App invoice input wiring', () => {
  // Report: this chat, Nov2 after invoice-kinds deployment; repeatedly choosing
  // carrier instead of confirming. Previous browser tests used a substitute App.
  it.each([
    { label: '手機載具', field: '手機條碼', code: '/PTGRJP2' },
    { label: '自然人憑證', field: '自然人憑證條碼', code: 'AB12345678901234' },
    { label: '公司統一編號', field: '統一編號', code: '12345678' },
  ])('synchronizes visible $label input through the actual parent and submits once', async ({ label, field, code }) => {
    const view = render(App)
    try {
      await view.getByRole('button', { name: '查看水餃' }).click()
      await view.getByRole('button', { name: '加入購物車', exact: true }).click()
      await view.getByRole('button', { name: '查看訂單', exact: true }).click()
      await view.getByRole('button', { name: '自取', exact: true }).click()
      await view.getByRole('button', { name: '確認訂單，進入結帳' }).click()
      await view.getByRole('button', { name: label, exact: true }).click()
      const input = view.getByRole('textbox', { name: field, exact: true })
      await input.fill(code.slice(0, 3))
      const confirm = view.getByRole('button', { name: label === '公司統一編號' ? '確認統編' : '確認發票資料，選擇付款方式', exact: true })
      await expect.element(confirm).toBeDisabled()
      await input.fill(code)
      await expect.element(confirm).toBeEnabled()
      await confirm.click()
      await expect.element(view.getByRole('heading', { name: '選擇付款方式', exact: true })).toBeVisible()
      await expect.element(view.getByRole('button', { name: 'LINE Pay', exact: true })).toBeVisible()
      expect(view.container.querySelector('#invoice-code')).toBeNull()
    }
    finally {
      view.unmount()
    }
  })
})
