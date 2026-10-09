import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import KioskAdminPanel from './KioskAdminPanel.vue'

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
  const screen = render(settings, { global: { plugins: [i18n] } })
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

  const reopened = render(settings, { global: { plugins: [i18n] } })
  await expect.element(reopened.getByRole('switch', { name: 'deviceSettings.localDiagnostics.idle', exact: true })).toHaveAttribute('aria-checked', 'false')
  await expect.element(reopened.getByRole('switch', { name: 'deviceSettings.localDiagnostics.presence', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect.element(reopened.getByRole('switch', { name: 'deviceSettings.localDiagnostics.decision', exact: true })).toHaveAttribute('aria-checked', 'true')
})
