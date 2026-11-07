import type { DeviceSettingsSnapshot } from '@proj-airi/kiosk-proactive'

import { defaultDeviceSettings, defaultDeviceSettingsValues } from '@proj-airi/kiosk-proactive'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import messages from '../../../../packages/i18n/src/locales/zh-Hant/deviceSettings.yaml'
import DeviceSettingsEditor from '../../../../packages/stage-ui/src/components/scenarios/kiosk/deviceSettingsEditor.vue'
import DeviceSettingsPanel from '../../../../packages/stage-ui/src/components/scenarios/kiosk/deviceSettingsPanel.vue'

import { useKioskDeviceRegistration } from '../composables/useKioskDeviceRegistration'
import { useKioskTextOnlyMode } from '../composables/useKioskTextOnlyMode'

afterEach(() => vi.restoreAllMocks())

function snapshot(): DeviceSettingsSnapshot {
  return { deviceId: 'text-kiosk', defaults: { ...defaultDeviceSettingsValues }, effective: { ...defaultDeviceSettingsValues }, settings: { ...defaultDeviceSettings, overrides: { textOnlyMode: false }, localControls: [], localOverrides: {} } }
}

it('saves a text-only override through the existing single-device administrator editor', async () => {
  const onSave = vi.fn()
  const view = render(DeviceSettingsEditor, { props: { snapshot: snapshot(), mode: 'admin', saving: false, onSave }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })] } })
  await view.getByRole('switch', { name: '純文字模式', exact: true }).click()
  await view.getByRole('button', { name: '儲存設定', exact: true }).click()
  expect(onSave).toHaveBeenCalledOnce()
  expect(onSave.mock.calls[0]![0]).toMatchObject({ version: 1, overrides: { textOnlyMode: true } })
})

it('keeps local text-only controls locked until the administrator delegates them', async () => {
  const view = render(DeviceSettingsEditor, { props: { snapshot: snapshot(), mode: 'local', saving: false }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })] } })
  await expect.element(view.getByRole('switch', { name: '純文字模式', exact: true })).toBeDisabled()
})

// Report: this chat Nov7 — a saved device mode must update capture policy immediately.
it.each([200, 503])('adopts only an acknowledged text-mode save, HTTP %i', async (status) => {
  const initial = snapshot()
  initial.settings.localControls = ['textOnlyMode']
  initial.settings.localOverrides = { textOnlyMode: false }
  const saved: DeviceSettingsSnapshot = { ...initial, effective: { ...initial.effective, textOnlyMode: true }, settings: { ...initial.settings, version: 2, localOverrides: { textOnlyMode: true } } }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).endsWith('/api/kiosk/bootstrap'))
      return Response.json({ device: { id: initial.deviceId, label: 'Kiosk', registrationMethod: 'development', siteId: 'site' }, deviceSettings: initial, mediaCapturePolicy: { mode: 'off' }, performanceProfile: 'balanced', proactiveVlmEnabled: false, voiceVadSettings: initial.effective.voiceVadSettings })
    if (init?.method === 'PUT')
      return status === 200 ? Response.json(saved) : new Response('Unavailable', { status })
    return Response.json(initial)
  })
  let registration!: ReturnType<typeof useKioskDeviceRegistration>
  const host = defineComponent({ setup() {
    registration = useKioskDeviceRegistration()
    const textOnly = useKioskTextOnlyMode(() => registration.deviceSettings.value?.effective.textOnlyMode ?? false)
    return () => h('section', [
      h('output', { 'data-testid': 'active-mode' }, textOnly.value ? 'text' : 'voice'),
      h(DeviceSettingsPanel, { endpoint: '/api/kiosk/settings', mode: 'local', onUpdated: registration.applySavedSettings }),
    ])
  } })
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })
  const view = render(host, { global: { plugins: [i18n] } })
  try {
    await registration.bootstrap()
    await expect.element(view.getByRole('switch', { name: '純文字模式', exact: true })).toBeEnabled()
    await view.getByRole('switch', { name: '純文字模式', exact: true }).click()
    await view.getByRole('button', { name: '儲存設定', exact: true }).click()
    await expect.element(view.getByText(i18n.global.t(status === 200 ? 'deviceSettings.saved' : 'deviceSettings.failed'), { exact: true })).toBeVisible()
    await expect.element(view.getByTestId('active-mode')).toHaveTextContent(status === 200 ? 'text' : 'voice')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(registration.deviceSettings.value?.settings.version).toBe(status === 200 ? 2 : 1)
  }
  finally { view.unmount() }
})
