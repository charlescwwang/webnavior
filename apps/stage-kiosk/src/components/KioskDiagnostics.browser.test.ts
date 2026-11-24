import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import KioskAdminPanel from './KioskAdminPanel.vue'
import KioskAssistantThoughtBubble from './KioskAssistantThoughtBubble.vue'

import { useKioskDiagnostics } from '../composables/useKioskDiagnostics'

const preferenceKeys = ['kiosk/diagnostics/idle-enabled', 'kiosk/diagnostics/presence-enabled', 'kiosk/diagnostics/decision-enabled']

afterEach(() => {
  for (const key of preferenceKeys)
    localStorage.removeItem(key)
})

const settings = defineComponent({
  setup() {
    const { idleDiagnosticsEnabled, presenceDiagnosticsEnabled, decisionDiagnosticsEnabled } = useKioskDiagnostics()
    return () => h(KioskAdminPanel, {
      'sessionEnding': false,
      'paused': false,
      'cameraPreviewEnabled': false,
      'conversationFontSize': 20,
      'idleDiagnosticsEnabled': idleDiagnosticsEnabled.value,
      'presenceDiagnosticsEnabled': presenceDiagnosticsEnabled.value,
      'decisionDiagnosticsEnabled': decisionDiagnosticsEnabled.value,
      'onUpdate:idleDiagnosticsEnabled': (enabled: boolean) => { idleDiagnosticsEnabled.value = enabled },
      'onUpdate:presenceDiagnosticsEnabled': (enabled: boolean) => { presenceDiagnosticsEnabled.value = enabled },
      'onUpdate:decisionDiagnosticsEnabled': (enabled: boolean) => { decisionDiagnosticsEnabled.value = enabled },
    })
  },
})

it('independently toggles diagnostic overlays and restores browser preferences on reopening settings', async () => {
  for (const key of preferenceKeys)
    localStorage.removeItem(key)

  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
  const screen = render(settings, { global: { stubs: { KioskMediaDeviceSettings: true }, plugins: [i18n] } })
  const idle = screen.getByRole('switch', { name: 'deviceSettings.localDiagnostics.idle', exact: true })
  const presence = screen.getByRole('switch', { name: 'deviceSettings.localDiagnostics.presence', exact: true })
  const decision = screen.getByRole('switch', { name: 'deviceSettings.localDiagnostics.decision', exact: true })
  await expect.element(idle).toHaveAttribute('aria-checked', 'false')
  await expect.element(presence).toHaveAttribute('aria-checked', 'false')
  await expect.element(decision).toHaveAttribute('aria-checked', 'false')

  await idle.click()
  await expect.element(idle).toHaveAttribute('aria-checked', 'true')
  await expect.element(presence).toHaveAttribute('aria-checked', 'false')
  await expect.element(decision).toHaveAttribute('aria-checked', 'false')
  await presence.click()
  await decision.click()
  await idle.click()
  await expect.poll(() => localStorage.getItem(preferenceKeys[0])).toBe('false')
  await expect.poll(() => localStorage.getItem(preferenceKeys[1])).toBe('true')
  await expect.poll(() => localStorage.getItem(preferenceKeys[2])).toBe('true')
  screen.unmount()

  const reopened = render(settings, { global: { stubs: { KioskMediaDeviceSettings: true }, plugins: [i18n] } })
  await expect.element(reopened.getByRole('switch', { name: 'deviceSettings.localDiagnostics.idle', exact: true })).toHaveAttribute('aria-checked', 'false')
  await expect.element(reopened.getByRole('switch', { name: 'deviceSettings.localDiagnostics.presence', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect.element(reopened.getByRole('switch', { name: 'deviceSettings.localDiagnostics.decision', exact: true })).toHaveAttribute('aria-checked', 'true')
})

it('keeps operator speech playback disabled until its separate microphone test is enabled', async () => {
  const labels = { 'admin-title': '音訊測試', 'admin-enable': '啟用音訊測試', 'admin-description': '管理頁專用', 'play-test': '播放測試' }
  const screen = render(KioskAdminPanel, { props: { sessionEnding: false, textOnlyMode: true, cameraPreviewEnabled: false, conversationFontSize: 20, paused: false, decisionDiagnosticsEnabled: false, idleDiagnosticsEnabled: false, presenceDiagnosticsEnabled: false }, global: { stubs: { KioskMediaDeviceSettings: true }, plugins: [createI18n({ legacy: false, locale: 'zh-TW', messages: { 'zh-TW': { stage: { kiosk: { 'voice-debug': labels } } } } })] } })
  await expect.element(screen.getByRole('button', { name: '播放測試' })).toBeDisabled()
  await screen.getByRole('switch', { name: '啟用音訊測試' }).click()
  await expect.element(screen.getByRole('button', { name: '播放測試' })).toBeEnabled()
})

it('applies and restores the bubble size independently of the conversation slider', async () => {
  const key = 'kiosk/thought-bubble/font-size'
  localStorage.removeItem(key)
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
  const mount = () => render(defineComponent({
    setup: () => () => h('div', [h(settings), h(KioskAssistantThoughtBubble, { voiceActivity: '正在查菜單' })]),
  }), { global: { stubs: { KioskMediaDeviceSettings: true }, plugins: [i18n] } })
  const screen = mount()
  try {
    const bubble = screen.getByRole('status').filter({ hasText: '正在查菜單' })
    await expect.element(bubble).toHaveStyle({ fontSize: '24px' })
    const section = screen.getByText('對話顯示', { exact: true }).element().closest('section')!
    const [conversation, thought] = section.querySelectorAll<HTMLInputElement>('input[type="range"]')
    const original = conversation.value
    thought.value = thought.max
    thought.dispatchEvent(new Event('input', { bubbles: true }))
    await expect.element(bubble).toHaveStyle({ fontSize: '40px' })
    expect(conversation.value).toBe(original)
    screen.unmount()
    const reopened = mount()
    await expect.element(reopened.getByRole('status').filter({ hasText: '正在查菜單' })).toHaveStyle({ fontSize: '40px' })
    reopened.unmount()
  }
  finally {
    localStorage.removeItem(key)
  }
})
