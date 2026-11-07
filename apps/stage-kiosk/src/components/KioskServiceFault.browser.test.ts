import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskServiceFault from './KioskServiceFault.vue'

import { isKioskAdminSessionActive } from '../services/admin-session'

afterEach(() => {
  vi.unstubAllEnvs()
  isKioskAdminSessionActive.value = false
})

it('announces the simulated notification and permits recovery only after PIN verification', async () => {
  vi.stubEnv('VITE_KIOSK_ADMIN_PIN', '4812')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/')
  const view = render(KioskServiceFault, { props: { busy: false }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  try {
    await expect.element(view.getByRole('alertdialog')).toBeVisible()
    await expect.element(view.getByText('偵測到特殊情況，已為您通知服務人員。', { exact: true })).toBeVisible()
    await view.getByRole('button', { name: '服務人員 PIN 解鎖' }).click()
    await view.getByRole('button', { name: '繼續', exact: true }).click()
    expect(view.emitted('unlock')).toBeUndefined()
    for (const digit of ['4', '8', '1', '2'])
      await view.getByRole('button', { name: digit, exact: true }).click()
    await view.getByRole('button', { name: '繼續', exact: true }).click()
    expect(view.emitted('unlock')).toHaveLength(1)
    await view.rerender({ busy: true })
    await expect.element(view.getByRole('button', { name: '清除內容，開始新訂單' })).toBeDisabled()
    expect(view.emitted('restart')).toBeUndefined()
    await view.rerender({ busy: false })
    await view.getByRole('button', { name: '清除內容，開始新訂單' }).click()
    expect(view.emitted('restart')).toHaveLength(1)
  }
  finally { view.unmount() }
})
