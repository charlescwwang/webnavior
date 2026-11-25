import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskVoiceStatus from './KioskVoiceStatus.vue'

it('keeps the voice badge inside a short Kiosk avatar panel', async () => {
  const screen = render(defineComponent({
    setup: () => () => h('section', {
      style: 'position:relative;overflow:hidden;container-type:size;width:145px;height:90px',
    }, [
      h(KioskVoiceStatus, { state: 'thinking' }),
    ]),
  }), {
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] },
  })

  await expect.element(screen.getByRole('status')).toHaveTextContent('服務員正在思考')
  const panel = screen.container.querySelector('section')!.getBoundingClientRect()
  const frame = screen.container.querySelector<HTMLElement>('[role="status"]')!
  const badge = frame.querySelector('.status-badge')!.getBoundingClientRect()

  expect(badge.top).toBeGreaterThan(panel.top)
  expect(badge.bottom).toBeLessThan(panel.bottom)
  expect(badge.right).toBeLessThan(panel.right)
  expect(getComputedStyle(frame).borderTopColor).toBe('rgb(255, 203, 97)')
  expect(getComputedStyle(frame).borderTopWidth).toBe('5px')
  expect(getComputedStyle(frame).boxShadow).toContain('rgba(255, 203, 97, 0.32)')
})

it('returns to a green microphone when the text conversation is ready for input', async () => {
  const state = shallowRef<'thinking' | 'text-ready'>('thinking')
  const speaking = shallowRef(false)
  const screen = render(defineComponent({
    setup: () => () => h(KioskVoiceStatus, { state: state.value, speaking: speaking.value }),
  }), {
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] },
  })

  const frame = screen.container.querySelector<HTMLElement>('[role="status"]')!
  expect(frame.querySelector('.spinner')).not.toBeNull()
  expect(getComputedStyle(frame).borderTopColor).toBe('rgb(255, 203, 97)')

  state.value = 'text-ready'
  await expect.element(screen.getByRole('status')).toHaveTextContent('可以輸入訊息')
  const badge = frame.querySelector<HTMLElement>('.status-badge')!
  expect(badge.querySelector('[class~="i-solar:microphone-3-outline"]')).not.toBeNull()
  expect(getComputedStyle(badge).backgroundColor).toBe('rgb(7, 131, 68)')
  expect(getComputedStyle(frame).borderTopColor).toBe('rgb(43, 119, 115)')
  expect(getComputedStyle(frame).borderTopWidth).toBe('5px')
  expect(getComputedStyle(frame).boxShadow).toBe('none')

  speaking.value = true
  await expect.poll(() => getComputedStyle(frame).borderTopColor).toBe('rgba(0, 0, 0, 0)')
  expect(getComputedStyle(frame).borderTopWidth).toBe('5px')
  expect(getComputedStyle(badge).backgroundColor).toBe('rgb(7, 131, 68)')
})
