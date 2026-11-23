import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import KioskMicrophoneSettings from './KioskMicrophoneSettings.vue'

// Report: this chat, 2026-11-20 — restore November master audio inside Electron.
it('offers browser acquisition and original spatial settings even with a saved Hush preference', async () => {
  localStorage.setItem('kiosk/audio/array-backend', 'native-hush')
  vi.stubGlobal('airiKioskDesktop', {})
  const pinia = createPinia()
  const screen = render(KioskMicrophoneSettings, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, messages: { en: {} } })] } })
  try {
    await expect.element(screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.backend', exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByText('stage.kiosk.array-audio.dynamic', { exact: true })).toBeVisible()
    await screen.getByRole('combobox', { name: 'stage.kiosk.array-audio.mode', exact: true }).click()
    await expect.element(screen.getByRole('option', { name: 'stage.kiosk.array-audio.auto', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('option', { name: 'stage.kiosk.array-audio.standard', exact: true })).toBeVisible()
  }
  finally {
    screen.unmount()
    const context = useAudioContext(pinia).audioContext
    disposePinia(pinia)
    await context.close()
    vi.unstubAllGlobals()
    localStorage.removeItem('kiosk/audio/array-backend')
  }
})
