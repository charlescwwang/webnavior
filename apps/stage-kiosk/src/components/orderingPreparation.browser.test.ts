import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import OrderingPreparation from './orderingPreparation.vue'

import 'virtual:uno.css'

// Report: this chat, Nov15; the native cart guard hid the website behind an empty region.
it('replaces the hidden website with an actionable preparation state, without clearing anything on display', async () => {
  const restart = vi.fn()
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })
  const screen = render(OrderingPreparation, { props: { state: 'pending', restartDisabled: true, onRestart: restart }, global: { plugins: [i18n] } })
  try {
    await expect.element(screen.getByRole('heading', { name: '正在準備點餐' })).toBeVisible()
    await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
    await screen.rerender({ state: 'blocked', message: '購物車裡還有未完成的餐點。', restartDisabled: true })
    await expect.element(screen.getByText('購物車裡還有未完成的餐點。')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: '重新開始／新訂單' })).toBeDisabled()
    expect(restart).not.toHaveBeenCalled()
    await screen.rerender({ restartDisabled: false })
    await screen.getByRole('button', { name: '重新開始／新訂單' }).click()
    expect(restart).toHaveBeenCalledOnce()
    await screen.rerender({ state: 'failed', message: '無法確認購物車，請稍後重新檢視。' })
    await expect.element(screen.getByRole('heading', { name: '點餐尚未準備完成' })).toBeVisible()
  }
  finally { screen.unmount() }
})
