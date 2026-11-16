import { defaultFalconSettings } from '@proj-airi/stage-shared/falcon-settings'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { h } from 'vue'
import { createI18n } from 'vue-i18n'

import AiCapabilityCards from './AiCapabilityCards.vue'
import FalconSettingsPanel from './FalconSettingsPanel.vue'

const global = { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: {} })] }
const snapshot = { settings: { ...defaultFalconSettings }, hasApiKey: false, ready: false as const, responseStatus: 'pending' as const }

it('groups the Falcon editor inside speech recognition and retains legacy ASR configuration', async () => {
  const onConfigure = vi.fn()
  const screen = render(AiCapabilityCards, {
    props: { busy: false, profiles: [], selections: [], onConfigure },
    slots: { 'asr-settings': () => h(FalconSettingsPanel, { busy: false, snapshot, embedded: true }) },
    global,
  })
  try {
    await expect.element(screen.getByRole('heading', { name: '語音辨識', exact: true })).toBeVisible()
    const title = screen.getByRole('heading', { name: '語音辨識模式與 Falcon 服務' }).element()
    expect(title.closest('[data-capability]')?.getAttribute('data-capability')).toBe('asr')
    await screen.getByRole('button', { name: '設定舊模式 ASR' }).click()
    expect(onConfigure).toHaveBeenCalledWith('asr')
    await expect.element(screen.getByRole('combobox', { name: '辨識模式' })).toHaveValue('legacy')
  }
  finally { screen.unmount() }
})

it('shows the corrected port, preserves legacy mode and saves a connection draft', async () => {
  const onSave = vi.fn()
  const screen = render(FalconSettingsPanel, { props: { busy: false, snapshot, onSave }, global })
  try {
    await expect.element(screen.getByRole('textbox', { name: 'Falcon 服務網址' })).toHaveValue('http://192.168.8.64:8766')
    await expect.element(screen.getByRole('combobox', { name: '辨識模式' })).toHaveValue('legacy')
    await expect.element(screen.getByRole('option', { name: '新模式：影音＋Falcon／ASR（尚未開放）' })).toBeDisabled()
    await screen.getByRole('spinbutton', { name: '請求逾時（秒）' }).fill('90')
    await screen.getByRole('button', { name: '儲存 Falcon 設定' }).click()
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith({ ...defaultFalconSettings, timeoutMs: 90000, plaintextKey: '', clearApiKey: false })
  }
  finally { screen.unmount() }
})

it('restricts PyTorch to FP32 and exposes explicit key removal without revealing the stored key', async () => {
  const onSave = vi.fn()
  const screen = render(FalconSettingsPanel, { props: { busy: false, snapshot: { ...snapshot, hasApiKey: true }, onSave }, global })
  try {
    await screen.getByRole('combobox', { name: '推論精度' }).selectOptions('fp16')
    await screen.getByRole('combobox', { name: '推論引擎' }).selectOptions('pytorch')
    await expect.element(screen.getByRole('combobox', { name: '推論精度' })).toHaveValue('fp32')
    await expect.element(screen.getByRole('combobox', { name: '推論精度' })).toBeDisabled()
    await screen.getByRole('checkbox', { name: '清除已儲存的 Key' }).click()
    await screen.getByRole('button', { name: '儲存 Falcon 設定' }).click()
    expect(onSave).toHaveBeenCalledWith({ ...defaultFalconSettings, engine: 'pytorch', precision: 'fp32', plaintextKey: '', clearApiKey: true })
  }
  finally { screen.unmount() }
})

it('cannot save unloaded settings and keeps a visible API error with a reload action', async () => {
  const onSave = vi.fn()
  const onReload = vi.fn()
  const screen = render(FalconSettingsPanel, { props: { busy: false, error: '讀取失敗', onSave, onReload }, global })
  try {
    await expect.element(screen.getByRole('button', { name: '儲存 Falcon 設定' })).toBeDisabled()
    await expect.element(screen.getByRole('alert')).toHaveTextContent('讀取失敗')
    await screen.getByRole('button', { name: '重新讀取' }).click()
    expect(onReload).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  }
  finally { screen.unmount() }
})
