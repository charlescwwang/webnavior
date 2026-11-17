import { createPresenceWindow, defaultPresenceSettings, defaultProactiveInteractionSettings } from '@proj-airi/kiosk-proactive'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskPresenceDiagnostics from './KioskPresenceDiagnostics.vue'
import KioskVoiceDiagnostics from './KioskVoiceDiagnostics.vue'

import { useKioskDiagnostics } from '../composables/useKioskDiagnostics'

// Report: this chat, 2026-11-17 — DEV-642583 cannot see any audio diagnostics.
it('keeps empty audio diagnostics inside the host area above the native menu', async () => {
  const screen = render(defineComponent({
    setup: () => () => h('main', { style: 'height: 100vh' }, [
      h('section', { class: 'diagnostic-host', style: 'position: relative; height: 30vh' }, [
        h(KioskVoiceDiagnostics, { entries: [], microphone: false, probability: 0, target: { revision: 3, candidates: 2, reason: 'switched', index: 1 }, interruption: { reason: 'qualified', durationMs: 256 }, backgroundSpeechMode: 'off' }),
      ]),
      h('section', { class: 'native-menu-bounds', style: 'height: 70vh' }),
    ]),
  }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  try {
    await expect.element(screen.getByRole('complementary', { name: '語音診斷' })).toBeVisible()
    const diagnostics = screen.container.querySelector('.voice-diagnostics')!.getBoundingClientRect()
    const host = screen.container.querySelector('.diagnostic-host')!.getBoundingClientRect()
    const menu = screen.container.querySelector('.native-menu-bounds')!.getBoundingClientRect()
    expect(diagnostics.top).toBeGreaterThanOrEqual(host.top)
    expect(diagnostics.bottom).toBeLessThanOrEqual(menu.top)
    expect(screen.container.textContent).toContain('VAD ○ 0%')
    expect(screen.container.textContent).toContain('最近 0 筆')
    expect(screen.container.textContent).toContain('已切換目標')
    expect(screen.container.textContent).toContain('前端已通過打斷條件')
    await screen.getByRole('complementary', { name: '語音診斷' }).screenshot({ path: '__screenshots__/customer-target-diagnostics.png' })
  }
  finally { screen.unmount() }
})

// Report: this chat, 2026-11-17 — reuse the existing diagnostics switch rather than making the floating window permanent.
it('uses the existing persisted presence switch to mount and remove the floating diagnostics', async () => {
  localStorage.removeItem('kiosk/diagnostics/presence-enabled')
  const presence = createPresenceWindow(defaultPresenceSettings, defaultProactiveInteractionSettings)
  const decision = presence.decide(0)
  const screen = render(defineComponent({
    setup() {
      const { presenceDiagnosticsEnabled } = useKioskDiagnostics()
      return () => h('section', { style: 'position: relative; height: 400px' }, [
        h('input', { 'type': 'checkbox', 'aria-label': '觀測診斷', 'checked': presenceDiagnosticsEnabled.value, 'onChange': (event: Event) => { presenceDiagnosticsEnabled.value = (event.target as HTMLInputElement).checked } }),
        presenceDiagnosticsEnabled.value && h(KioskPresenceDiagnostics, { decision, diagnostics: { cadenceTier: 'stable', faceActive: true, poseIntervalMs: 0 }, visionMode: 'face_only', target: { revision: 2, candidates: 2, reason: 'switched', index: 1 } }),
      ])
    },
  }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  try {
    expect(screen.container.querySelector('.presence-diagnostics')).toBeNull()
    await screen.getByRole('checkbox', { name: '觀測診斷' }).click()
    await expect.element(screen.getByRole('complementary', { name: '主要點餐者' })).toBeVisible()
    expect(screen.container.textContent).toContain('已切換目標')
    expect(localStorage.getItem('kiosk/diagnostics/presence-enabled')).toBe('true')
    await screen.getByRole('checkbox', { name: '觀測診斷' }).click()
    await expect.poll(() => screen.container.querySelector('.presence-diagnostics')).toBeNull()
  }
  finally {
    screen.unmount()
    localStorage.removeItem('kiosk/diagnostics/presence-enabled')
  }
})

// Report: this chat, 2026-11-17 — diagnostic windows must remain switchable and draggable.
it('drags the diagnostic header and keeps it reachable inside its host', async () => {
  const screen = render(defineComponent({
    setup: () => () => h('section', { style: 'position: relative; height: 500px; width: 800px' }, [h(KioskVoiceDiagnostics, { entries: [] })]),
  }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  try {
    const panel = screen.container.querySelector('.voice-diagnostics')!
    const header = panel.querySelector('.diagnostic-handle')!
    await expect.poll(() => panel.getBoundingClientRect().x).toBeGreaterThan(100)
    const before = panel.getBoundingClientRect()
    header.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: before.x + 30, clientY: before.y + 12, button: 0 }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: before.x - 100, clientY: before.y + 100 }))
    await expect.poll(() => panel.getBoundingClientRect().x).toBeLessThan(before.x - 50)
    window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: -1000, clientY: -1000 }))
    await expect.poll(() => panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(screen.container.getBoundingClientRect().left)
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' }))
  }
  finally { screen.unmount() }
})
