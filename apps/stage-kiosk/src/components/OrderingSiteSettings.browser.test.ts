import type { DeviceSettingsSnapshot } from '@proj-airi/kiosk-proactive'

import { defaultDeviceSettingsValues } from '@proj-airi/kiosk-proactive'
import { DeviceSettingsPanel } from '@proj-airi/stage-ui/components/scenarios/kiosk/deviceSettings'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import deviceSettings from '../../../../packages/i18n/src/locales/zh-Hant/deviceSettings.yaml'

afterEach(() => vi.restoreAllMocks())

it('saves the on-site dropdown and restores the same merchant in the central editor', async () => {
  let snapshot: DeviceSettingsSnapshot = { deviceId: 'device', defaults: { ...defaultDeviceSettingsValues }, effective: { ...defaultDeviceSettingsValues }, settings: { version: 1, overrides: {} }, orderingSites: [{ id: 'old', title: '原店家', url: 'https://menu.test/', description: '' }, { id: 'new', title: '新店家模擬', url: 'https://menu.test/supplier.html', description: '' }] }
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
    if (init?.method === 'PUT') {
      expect(JSON.parse(String(init.body))).toEqual({ version: 1, overrides: { orderingServiceId: 'new' } })
      snapshot = { ...snapshot, effective: { ...snapshot.effective, orderingServiceId: 'new' }, settings: { version: 2, overrides: { orderingServiceId: 'new' } } }
    }
    return Response.json(snapshot)
  })
  const plugins = [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings } } })]
  const local = render(DeviceSettingsPanel, { props: { endpoint: '/test-device-settings', mode: 'local', activeOrderingSiteId: 'old' }, global: { plugins } })
  try {
    const choice = local.getByRole('combobox', { name: '店家／點餐網站' })
    await choice.selectOptions('new')
    await local.getByRole('button', { name: '儲存設定', exact: true }).click()
    await expect.element(local.getByText('設定已儲存。', { exact: true })).toBeVisible()
    await expect.element(local.getByText('新店家設定已儲存，待目前訂單結束或重新開始後套用。')).toBeVisible()
    expect(request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
  }
  finally { local.unmount() }
  const central = render(DeviceSettingsPanel, { props: { endpoint: '/test-device-settings', mode: 'admin' }, global: { plugins } })
  try {
    await expect.element(central.getByRole('combobox', { name: '店家／點餐網站' })).toHaveValue('new')
  }
  finally { central.unmount() }
})
