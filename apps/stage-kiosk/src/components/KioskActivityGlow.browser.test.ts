import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'

import KioskActivityGlow from './KioskActivityGlow.vue'

// Report: this chat, Nov19 — activity guidance must never cover or lock ordering controls.
it('shows activity at the frame edge without resizing or intercepting controls', async () => {
  const active = shallowRef(true)
  const clicks = shallowRef(0)
  const screen = render(defineComponent({
    setup: () => () => h('section', { style: 'display:grid;gap:20px;width:650px;padding:24px;background:#15211d;color:white' }, [
      ...(['speaking', 'listening', 'operating'] as const).map(mode => h('div', { 'data-frame': mode, 'style': 'position:relative;height:140px;border-radius:18px;background:#24352d;padding:15px' }, [
        h(KioskActivityGlow, { active: active.value, mode }),
        h('p', mode),
        h('button', { style: 'padding:10px;color:black;background:white', onClick: () => clicks.value++ }, `操作 ${mode}`),
      ])),
      h('output', `clicked: ${clicks.value}`),
    ]),
  }))
  const frames = [...screen.container.querySelectorAll<HTMLElement>('[data-frame]')]
  const before = frames.map(frame => ({ width: frame.getBoundingClientRect().width, height: frame.getBoundingClientRect().height }))
  await screen.getByRole('button', { name: '操作 operating' }).click()
  await expect.element(screen.getByText('clicked: 1')).toBeVisible()
  expect([...screen.container.querySelectorAll<HTMLElement>('.activity-glow')].every(frame => getComputedStyle(frame).pointerEvents === 'none')).toBe(true)
  await page.screenshot({ path: '__screenshots__/kiosk-activity-glow.png' })
  active.value = false
  await expect.poll(() => screen.container.querySelectorAll('.activity-glow.is-active').length).toBe(0)
  const after = frames.map(frame => ({ width: frame.getBoundingClientRect().width, height: frame.getBoundingClientRect().height }))
  expect(after).toEqual(before)
})
