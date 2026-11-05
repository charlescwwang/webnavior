import type { DeviceSettingsSnapshot } from '@proj-airi/kiosk-proactive'

import { defaultDeviceSettings, defaultDeviceSettingsValues } from '@proj-airi/kiosk-proactive'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import messages from '../../../../packages/i18n/src/locales/zh-Hant/deviceSettings.yaml'
import DeviceSettingsEditor from '../../../../packages/stage-ui/src/components/scenarios/kiosk/deviceSettingsEditor.vue'

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
