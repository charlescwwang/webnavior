import type { KioskDevice, KioskSite, KioskSiteManagementCapabilities } from '../../composables/useKioskManagement'

import { defaultDeviceSettingsValues, newDeviceSettings, resolveDeviceSettings } from '@proj-airi/kiosk-proactive'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import deviceSettings from '../../../../../packages/i18n/src/locales/zh-Hant/deviceSettings.yaml'
import stage from '../../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskDeviceManager from './kioskDeviceManager.vue'

function directory(failedSite?: string) {
  const sites: KioskSite[] = [
    { id: 'site-a', name: 'Alpha 場域', interactionRetentionDays: 180 },
    { id: 'site-b', name: 'Beta 場域', interactionRetentionDays: 60 },
    { id: 'site-c', name: 'Gamma 場域', interactionRetentionDays: 90 },
  ]
  const devices: KioskDevice[] = [
    { id: 'old', siteId: 'site-a', label: 'Kiosk 10', createdAt: '2024-01-01T00:00:00Z', registrationMethod: 'qr_code', disabledAt: null },
    { id: 'new', siteId: 'site-b', label: 'Kiosk 2', createdAt: '2026-01-01T00:00:00Z', registrationMethod: 'qr_code', disabledAt: null },
    { id: 'middle', siteId: 'site-a', label: 'Kiosk 1', createdAt: '2025-01-01T00:00:00Z', registrationMethod: 'qr_code', disabledAt: null },
    { id: 'readonly', siteId: 'site-c', label: 'Kiosk 99', createdAt: '2023-01-01T00:00:00Z', registrationMethod: 'qr_code', disabledAt: null },
  ]
  const capabilities: KioskSiteManagementCapabilities = { canManageDevices: true, canEditTechnicalSettings: true, canEditExperience: true, canPublishExperience: true }
  const calls: Array<{ path: string, method: string, body?: string }> = []
  // Mock only the HTTP boundary: the real authentication wrapper, directory,
  // Reka dialogs, shared settings form and selection policy still execute.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    calls.push({ path, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) })
    if (path === '/api/admin/kiosk/sites')
      return Response.json(sites)
    for (const site of sites) {
      const prefix = `/api/admin/kiosk/sites/${site.id}`
      if (path === `${prefix}/devices`)
        return Response.json(devices.filter(device => device.siteId === site.id))
      if (path === `${prefix}/capabilities`)
        return Response.json({ ...capabilities, canManageDevices: site.id !== 'site-c', canEditTechnicalSettings: site.id !== 'site-c' })
      if (path.endsWith('/settings') && path.startsWith(`${prefix}/devices/`))
        return Response.json({ settings: newDeviceSettings, defaults: defaultDeviceSettingsValues, effective: resolveDeviceSettings(defaultDeviceSettingsValues, newDeviceSettings) })
      if (path === `${prefix}/devices/batch-disable` && method === 'POST') {
        if (site.id === failedSite)
          return new Response('Unavailable', { status: 503 })
        const body = JSON.parse(String(init?.body)) as { deviceIds: string[] }
        return Response.json({ succeededDeviceIds: body.deviceIds, failedDeviceIds: [] })
      }
    }
    return new Response('Unexpected test request', { status: 404 })
  })
  const screen = render(KioskDeviceManager, { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage, deviceSettings } } })] } })
  const order = () => [...document.querySelectorAll('[data-device-id]')].map(row => row.getAttribute('data-device-id'))
  return { calls, order, screen }
}

afterEach(() => vi.restoreAllMocks())

it('sorts every authorized site by time, natural device name and site, and filters the visible selection', async () => {
  const { screen, order } = directory()
  await expect.poll(order).toEqual(['new', 'middle', 'old', 'readonly'])
  await screen.getByRole('button', { name: '最新建立在前' }).click()
  await expect.poll(order).toEqual(['readonly', 'old', 'middle', 'new'])
  await screen.getByRole('combobox', { name: /排列方式/ }).click()
  await screen.getByRole('option', { name: '裝置名稱', exact: true }).click()
  await expect.poll(order).toEqual(['middle', 'new', 'old', 'readonly'])
  await screen.getByRole('combobox', { name: /排列方式/ }).click()
  await screen.getByRole('option', { name: '場域名稱', exact: true }).click()
  await expect.poll(order).toEqual(['middle', 'old', 'new', 'readonly'])
  await screen.getByRole('checkbox', { name: '全選目前清單' }).click()
  await expect.element(screen.getByText('已選取 3 台設備')).toBeVisible()
  await screen.getByRole('combobox', { name: /場域/ }).click()
  await screen.getByRole('option', { name: 'Beta 場域', exact: true }).click()
  await expect.poll(order).toEqual(['new'])
  await expect.element(screen.getByText('已選取 3 台設備')).not.toBeInTheDocument()
})

// Report: this chat, 2026-10-29 — device settings appeared beneath the list.
it('opens settings in an accessible modal for the correct site and returns focus when closed', async () => {
  const { screen, calls, order } = directory()
  await expect.poll(order).toHaveLength(4)
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: '裝置設定', exact: true }).nth(0).click()
  await expect.element(screen.getByRole('dialog', { name: '裝置設定：Kiosk 2' })).toBeVisible()
  await expect.element(screen.getByText('所屬場域：Beta 場域。裝置設定只影響這台設備。')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: '儲存設定' }).first()).toBeVisible()
  expect(calls.some(call => call.path === '/api/admin/kiosk/sites/site-b/devices/new/settings')).toBe(true)
  expect(calls.filter(call => call.method !== 'GET')).toHaveLength(0)
  await screen.getByRole('button', { name: '關閉裝置設定' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.poll(() => document.activeElement?.closest('[data-device-id]')?.getAttribute('data-device-id')).toBe('new')
  expect(order()).toEqual(['new', 'middle', 'old', 'readonly'])
})

it('keeps cross-site actions scoped to their owners and reports partial failure without retrying writes', async () => {
  const { screen, calls, order } = directory('site-b')
  await expect.poll(order).toHaveLength(4)
  await screen.getByRole('checkbox', { name: '全選目前清單' }).click()
  await screen.getByRole('button', { name: '停用已選取的 3 台' }).click()
  await screen.getByRole('button', { name: '確認', exact: true }).click()
  await expect.element(screen.getByText('停用結果：成功 2 台、未完成 1 台。')).toBeVisible()
  const writes = calls.filter(call => call.method === 'POST')
  expect(writes).toHaveLength(2)
  const alpha = writes.find(call => call.path === '/api/admin/kiosk/sites/site-a/devices/batch-disable')
  const beta = writes.find(call => call.path === '/api/admin/kiosk/sites/site-b/devices/batch-disable')
  expect(alpha).toBeDefined()
  expect(beta).toBeDefined()
  expect(JSON.parse(alpha!.body!).deviceIds.toSorted()).toEqual(['middle', 'old'])
  expect(JSON.parse(beta!.body!)).toEqual({ deviceIds: ['new'] })
  expect(writes.some(call => call.path.includes('site-c'))).toBe(false)
})
