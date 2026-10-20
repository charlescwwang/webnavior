import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskTextConsole from './kioskTextConsole.vue'

import '@unocss/reset/tailwind.css'

it('floats outside the conversation, drags by its header and stays inside the viewport', async () => {
  await page.viewport(1000, 800)
  render(KioskTextConsole, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  const panel = document.querySelector<HTMLElement>('section[aria-label="文字輸入與 Trace"]')!
  await expect.poll(() => panel.getBoundingClientRect().width).toBeGreaterThan(0)
  expect(panel.parentElement).toBe(document.body)
  expect(getComputedStyle(panel).position).toBe('fixed')
  const header = panel.querySelector('header div')!
  const before = panel.getBoundingClientRect()
  header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: before.x + 20, clientY: before.y + 20, button: 0 }))
  window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 60, clientY: 60 }))
  await nextTick()
  expect(panel.getBoundingClientRect().x).toBeCloseTo(40)
  expect(panel.getBoundingClientRect().y).toBeCloseTo(40)
  window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: -1000, clientY: -1000 }))
  await nextTick()
  window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }))
  expect(panel.getBoundingClientRect().x).toBeGreaterThanOrEqual(12)
  expect(panel.getBoundingClientRect().y).toBeGreaterThanOrEqual(12)
})

it('retains the input and trace while collapsed and forwards submissions after expanding', async () => {
  const onSimulate = vi.fn()
  const screen = render(KioskTextConsole, { props: { trace: '{"kind":"NEEDS_ASSISTANT"}', onSimulate }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await screen.getByRole('textbox').fill('水餃改一份')
  const textarea = document.querySelector('textarea')!
  await screen.getByRole('button', { name: '收合', exact: true }).click()
  await expect.element(textarea).not.toBeVisible()
  await screen.getByRole('button', { name: '展開', exact: true }).click()
  await expect.element(screen.getByRole('textbox')).toHaveValue('水餃改一份')
  await screen.getByText('檢視本次 System One 決策 trace').click()
  await expect.element(screen.getByText('{"kind":"NEEDS_ASSISTANT"}')).toBeVisible()
  await screen.getByRole('button', { name: '模擬辨識並執行' }).click()
  expect(onSimulate).toHaveBeenCalledWith('水餃改一份')
  await screen.getByRole('button', { name: '重設位置' }).click()
  const panel = document.querySelector<HTMLElement>('section[aria-label="文字輸入與 Trace"]')!
  await expect.poll(() => panel.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth - 11)
  await page.viewport(390, 600)
  await nextTick()
  await expect.poll(() => panel.getBoundingClientRect().right).toBeLessThanOrEqual(379)
  await expect.poll(() => panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(589)
})
