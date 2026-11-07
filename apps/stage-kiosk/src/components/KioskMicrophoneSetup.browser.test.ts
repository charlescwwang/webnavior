import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import KioskMicrophoneSetup from './KioskMicrophoneSetup.vue'

const device: MediaDeviceInfo = { deviceId: 'uma8', groupId: 'array', kind: 'audioinput', label: 'UMA-8', toJSON: () => ({}) }
// Report: this chat,2026-11-07 — first-run device choice belongs on startup,
// with later maintenance in Admin; authorizing alone must not start arbitrary input.
it('presents first-run choice and confirms the selected device explicitly', async () => {
  const apply = vi.fn()
  const change = vi.fn()
  const view = render(KioskMicrophoneSetup, { props: { 'modelValue': '', 'devices': [device], 'busy': false, 'error': '', 'onApply': apply, 'onUpdate:modelValue': change } })
  await expect.element(view.getByRole('region', { name: '設定點餐麥克風' })).toBeVisible()
  await expect.element(view.getByRole('button', { name: '使用此麥克風' })).toBeDisabled()
  await view.getByRole('combobox').click()
  await view.getByRole('option', { name: 'UMA-8' }).click()
  expect(change).toHaveBeenCalledWith('uma8')
  await view.rerender({ modelValue: 'uma8' })
  await view.getByRole('button', { name: '使用此麥克風' }).click()
  expect(apply).toHaveBeenCalledOnce()
})
it('offers retry after permission rejection and allows retiring an in-progress startup', async () => {
  const permission = vi.fn()
  const stop = vi.fn()
  const view = render(KioskMicrophoneSetup, { props: { modelValue: 'uma8', devices: [device], busy: false, error: '請允許麥克風存取', onPermission: permission, onStop: stop } })
  await expect.element(view.getByRole('alert')).toHaveTextContent('請允許麥克風存取')
  await view.getByRole('button', { name: '授權麥克風／顯示裝置' }).click()
  expect(permission).toHaveBeenCalledOnce()
  await view.rerender({ busy: true })
  await expect.element(view.getByRole('combobox')).toBeDisabled()
  await view.getByRole('button', { name: '停止麥克風' }).click()
  expect(stop).toHaveBeenCalledOnce()
})
