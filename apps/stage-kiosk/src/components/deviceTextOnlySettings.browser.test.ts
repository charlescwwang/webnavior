import type { DeviceSettingsSnapshot } from '@proj-airi/kiosk-proactive'

import { defaultDeviceSettings, defaultDeviceSettingsValues } from '@proj-airi/kiosk-proactive'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, effectScope, h, nextTick, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import messages from '../../../../packages/i18n/src/locales/zh-Hant/deviceSettings.yaml'
import DeviceSettingsEditor from '../../../../packages/stage-ui/src/components/scenarios/kiosk/deviceSettingsEditor.vue'
import DeviceSettingsPanel from '../../../../packages/stage-ui/src/components/scenarios/kiosk/deviceSettingsPanel.vue'

import { useKioskDeviceRegistration } from '../composables/useKioskDeviceRegistration'
import { useKioskTextOnlyMode } from '../composables/useKioskTextOnlyMode'

afterEach(() => vi.restoreAllMocks())

function snapshot(): DeviceSettingsSnapshot {
  return { deviceId: 'text-kiosk', defaults: { ...defaultDeviceSettingsValues }, effective: { ...defaultDeviceSettingsValues }, settings: { ...defaultDeviceSettings, overrides: { textOnlyMode: false } } }
}

// Report: this chat Nov10 — switching versions must not erase stored local preferences.
it('uses the server mode without deleting a pre-existing browser preference', async () => {
  const key = 'kiosk/conversation/text-only'
  const previous = localStorage.getItem(key)
  const scope = effectScope()
  try {
    localStorage.setItem(key, 'true')
    const central = shallowRef(false)
    const mode = scope.run(() => useKioskTextOnlyMode(central))!
    expect(mode.value).toBe(false)
    await nextTick()
    expect(localStorage.getItem(key)).toBe('true')
    central.value = true
    expect(mode.value).toBe(true)
  }
  finally {
    scope.stop()
    if (previous === null)
      localStorage.removeItem(key)
    else
      localStorage.setItem(key, previous)
  }
})

it('saves a text-only override through the existing single-device administrator editor', async () => {
  const onSave = vi.fn()
  const view = render(DeviceSettingsEditor, { props: { snapshot: snapshot(), mode: 'admin', saving: false, onSave }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })] } })
  await expect.element(view.getByRole('combobox', { name: '服務模式', exact: true })).not.toBeInTheDocument()
  await expect.element(view.getByRole('combobox', { name: '背景音判斷', exact: true })).not.toBeInTheDocument()
  await view.getByRole('switch', { name: '純文字模式', exact: true }).click()
  await view.getByRole('button', { name: '儲存設定', exact: true }).click()
  expect(onSave).toHaveBeenCalledOnce()
  expect(onSave.mock.calls[0]![0]).toMatchObject({ version: 1, overrides: { textOnlyMode: true } })
})

it('allows local text-only changes without administrator delegation', async () => {
  const view = render(DeviceSettingsEditor, { props: { snapshot: snapshot(), mode: 'local', saving: false }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })] } })
  await expect.element(view.getByRole('switch', { name: '純文字模式', exact: true })).toBeEnabled()
})

// Report: this chat Nov7 — a saved device mode must update capture policy immediately.
it.each([200, 401, 403, 503])('adopts only an acknowledged text-mode save, HTTP %i', async (status) => {
  const initial = snapshot()
  const saved: DeviceSettingsSnapshot = { ...initial, effective: { ...initial.effective, textOnlyMode: true }, settings: { ...initial.settings, version: 2, overrides: { textOnlyMode: true } } }
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
    await expect.element(view.getByText(i18n.global.t(status === 200 ? 'deviceSettings.saved' : status === 401 ? 'deviceSettings.savePinRequired' : status === 403 ? 'deviceSettings.saveLocalForbidden' : 'deviceSettings.failed'), { exact: true })).toBeVisible()
    await expect.element(view.getByTestId('active-mode')).toHaveTextContent(status === 200 ? 'text' : 'voice')
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(writes).toHaveLength(1)
    expect(new Headers(writes[0]?.[1]?.headers).has('Authorization')).toBe(false)
    expect(writes[0]?.[1]?.credentials).toBe('include')
    expect(registration.deviceSettings.value?.settings.version).toBe(status === 200 ? 2 : 1)
  }
  finally { view.unmount() }
})

// Report: this chat Nov8 — the two editors must show the same device policy.
it('refreshes either clean editor after the other saves and stops refreshing after unmount', async () => {
  let current = snapshot()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
    if (init?.method === 'PUT') {
      const change = JSON.parse(String(init.body))
      if (change.version !== current.settings.version)
        return new Response('', { status: 409 })
      current = { ...current, settings: { version: change.version + 1, overrides: change.overrides }, effective: { ...current.defaults, ...change.overrides } }
    }
    return Response.json(current)
  })
  const host = defineComponent({ setup: () => () => h('div', ['admin', 'local'].map(mode => h('section', { 'data-testid': mode }, [h(DeviceSettingsPanel, { endpoint: `/test/${mode}`, mode: mode as 'admin' | 'local' })]))) })
  const view = render(host, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })] } })
  const local = view.getByTestId('local')
  const admin = view.getByTestId('admin')
  await expect.element(local.getByRole('switch', { name: '純文字模式', exact: true })).toBeEnabled()
  await local.getByRole('switch', { name: '純文字模式', exact: true }).click()
  await local.getByRole('button', { name: '儲存設定', exact: true }).click()
  await expect.element(local.getByRole('status')).toHaveTextContent('設定已儲存。')
  window.dispatchEvent(new Event('focus'))
  await expect.element(admin.getByRole('switch', { name: '純文字模式', exact: true })).toBeChecked()
  await admin.getByRole('switch', { name: '純文字模式', exact: true }).click()
  await admin.getByRole('button', { name: '儲存設定', exact: true }).click()
  await expect.element(admin.getByRole('status')).toHaveTextContent('設定已儲存。')
  window.dispatchEvent(new Event('focus'))
  await expect.element(local.getByRole('switch', { name: '純文字模式', exact: true })).not.toBeChecked()
  view.unmount()
  const calls = fetch.mock.calls.length
  window.dispatchEvent(new Event('focus'))
  expect(fetch).toHaveBeenCalledTimes(calls)
})

it('keeps an unsaved local draft during remote updates and reports a stale write', async () => {
  const initial = snapshot()
  let current = initial
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => init?.method === 'PUT' ? new Response('', { status: 409 }) : Response.json(current))
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })
  const view = render(DeviceSettingsPanel, { props: { endpoint: '/test/local', mode: 'local' }, global: { plugins: [i18n] } })
  await expect.element(view.getByRole('switch', { name: '純文字模式', exact: true })).toBeEnabled()
  await view.getByRole('switch', { name: '純文字模式', exact: true }).click()
  current = { ...initial, settings: { version: 2, overrides: { textOnlyMode: false, faceDetectionConfidence: 0.7 } }, effective: { ...initial.effective, faceDetectionConfidence: 0.7 } }
  window.dispatchEvent(new Event('focus'))
  await expect.element(view.getByRole('switch', { name: '純文字模式', exact: true })).toBeChecked()
  await view.getByRole('button', { name: '儲存設定', exact: true }).click()
  await expect.element(view.getByRole('status')).toHaveTextContent(i18n.global.t('deviceSettings.conflict'))
  await expect.element(view.getByRole('switch', { name: '純文字模式', exact: true })).toBeChecked()
  await view.getByRole('button', { name: '重新載入設定', exact: true }).click()
  await expect.element(view.getByRole('switch', { name: '純文字模式', exact: true })).not.toBeChecked()
  // Reload explicitly discards a draft even if the Server revision is unchanged.
  await view.getByRole('switch', { name: '純文字模式', exact: true }).click()
  await view.getByRole('button', { name: '重新載入設定', exact: true }).click()
  await expect.element(view.getByRole('switch', { name: '純文字模式', exact: true })).not.toBeChecked()
  view.unmount()
})

// Report: this chat Nov8 — changing an inherited setting must not need an override switch.
it('allows direct edits of inherited settings and saves the changed values', async () => {
  const onSave = vi.fn()
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })
  const view = render(DeviceSettingsEditor, { props: { snapshot: snapshot(), mode: 'local', saving: false, onSave }, global: { plugins: [i18n] } })
  const wait = view.getByRole('spinbutton', { name: '提醒等待時間（毫秒）', exact: true })
  await expect.element(wait).toBeEnabled()
  await wait.fill('55000')
  await view.getByRole('spinbutton', { name: '語音門檻（VAD）', exact: true }).fill('0.6')
  await view.getByRole('button', { name: '儲存設定', exact: true }).click()
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({ overrides: { textOnlyMode: false, reminderWaitMs: 55000, voiceVadSettings: { threshold: 0.6 } } })
  expect(onSave.mock.calls[0]?.[0].overrides).not.toHaveProperty('mediaCaptureMode')
  view.unmount()
})

// Report: this chat Nov8 — a rejected PUT must not look saved or survive reload.
it.each([200, 401])('reloads only persisted settings after a save attempt, HTTP %i', async (status) => {
  let persisted = snapshot()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
    if (init?.method === 'PUT') {
      if (status !== 200)
        return new Response('', { status })
      const change = JSON.parse(String(init.body))
      persisted = { ...persisted, settings: { version: change.version + 1, overrides: change.overrides }, effective: { ...persisted.defaults, ...change.overrides } }
    }
    return Response.json(persisted)
  })
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { deviceSettings: messages } } })
  const options = { props: { endpoint: '/test/settings', mode: 'local' as const }, global: { plugins: [i18n] } }
  let view = render(DeviceSettingsPanel, options)
  await expect.element(view.getByRole('spinbutton', { name: '提醒等待時間（毫秒）', exact: true })).toBeEnabled()
  await view.getByRole('spinbutton', { name: '提醒等待時間（毫秒）', exact: true }).fill('55000')
  await view.getByRole('button', { name: '儲存設定', exact: true }).click()
  await expect.element(view.getByRole('status')).toHaveTextContent(i18n.global.t(status === 200 ? 'deviceSettings.saved' : 'deviceSettings.savePinRequired'))
  expect(persisted.settings.version).toBe(status === 200 ? 2 : 1)
  if (status === 401) {
    await expect.element(view.getByRole('spinbutton', { name: '提醒等待時間（毫秒）', exact: true })).toHaveValue(55000)
    await expect.element(view.getByRole('button', { name: '儲存設定', exact: true })).toBeEnabled()
  }
  view.unmount()
  view = render(DeviceSettingsPanel, options)
  await expect.element(view.getByRole('spinbutton', { name: '提醒等待時間（毫秒）', exact: true })).toHaveValue(status === 200 ? 55000 : 20000)
  view.unmount()
})
