import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import BrowserProductPresentation from './browserProductPresentation.vue'

const global = { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] }

it.each([{ width: 1080, height: 833 }, { width: 1080, height: 1920 }])('bounds a long fresh menu summary at $width×$height within the viewport', async ({ width, height }) => {
  await page.viewport(width, height)
  const screen = render(BrowserProductPresentation, { global, props: { presentation: { products: Array.from({ length: 10 }, (_, index) => ({ ref: `new-day-${index}`, name: `每日全新商品與分類 ${index}`, price: 70 + index })), cue: 'shown' } } })
  const region = screen.getByRole('complementary', { name: '正在介紹的餐點' })
  await expect.element(region).toBeVisible()
  const element = screen.container.querySelector<HTMLElement>('aside')!
  expect(element.getBoundingClientRect().width).toBeLessThanOrEqual(width)
  expect(element.getBoundingClientRect().height).toBeLessThanOrEqual(96)
  expect(element.scrollWidth).toBeGreaterThan(element.clientWidth)
  await expect.element(screen.getByText('每日全新商品與分類 0')).toBeVisible()
  screen.unmount()
})

it('shows an explicit location limitation without inventing a price or image', async () => {
  const screen = render(BrowserProductPresentation, { global, props: { presentation: { products: [{ ref: 'pg-new', name: '需要選規格的套餐' }], cue: 'target-unavailable' } } })
  await expect.element(screen.getByText('PB 畫面暫無法定位，以下為已查證商品')).toBeVisible()
  expect(screen.container.querySelector('img')).toBeNull()
  expect(screen.container.textContent).not.toContain('元起')
})
