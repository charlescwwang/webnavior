import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'

import ArrayMicrophoneSettings from './arrayMicrophoneSettings.vue'

const captureProps = { inputGainDb: 0, clippedSamples: 0, microphone: '', devices: [], captureStatus: 'disabled', capturedDevice: '', captureError: '', starting: false, voiceOnly: true, hasStream: false }

it('shows VAD and presence facts in the operator panel instead of treating input selection as ASR readiness', async () => {
  const view = render(ArrayMicrophoneSettings, { props: { ...captureProps, enabled: true, mode: 'standard', channelCount: 1, status: 'standard', error: '', mapping: '0,1,2,3,4,5,6', radius: 44, vadStatus: 'error', vadError: 'VAD initialization failed', presenceStatus: 'EMPTY' } })
  await expect.element(view.getByText('語音偵測狀態： error')).toBeVisible()
  await expect.element(view.getByText('視覺在場狀態： EMPTY')).toBeVisible()
  await expect.element(view.getByRole('alert')).toHaveTextContent('VAD initialization failed')
})

// Report: this chat, 2026-11-05 — UMA-8 showed stopped/not-ready with no capture controls.
it('lets an operator start capture when input is stopped rather than treating it as a quiet microphone', async () => {
  const onStart = vi.fn()
  const view = render(ArrayMicrophoneSettings, { props: { ...captureProps, onStart, enabled: false, mode: 'standard', status: 'stopped', error: '', mapping: '0,1,2,3,4,5,6', radius: 44, vadStatus: 'not-ready', vadError: '', presenceStatus: 'ENGAGED' } })
  await expect.element(view.getByRole('button', { name: '啟動麥克風' })).toBeVisible()
  await expect.element(view.getByText('收音模式：尚未偵測')).toBeVisible()
  await view.getByRole('button', { name: '啟動麥克風' }).click()
  expect(onStart).toHaveBeenCalledOnce()
})

it('shows capture errors independently from VAD and prevents device changes while capture is active', async () => {
  const onStop = vi.fn()
  const view = render(ArrayMicrophoneSettings, { props: { ...captureProps, enabled: true, mode: 'standard', status: 'stopped', error: '', mapping: '0,1,2,3,4,5,6', radius: 44, vadStatus: 'not-ready', vadError: '', presenceStatus: 'ENGAGED', captureStatus: 'no-stream (granted)', captureError: 'NotReadableError: device unavailable', onStop } })
  await expect.element(view.getByRole('alert')).toHaveTextContent('NotReadableError: device unavailable')
  await expect.element(view.getByRole('combobox')).toBeDisabled()
  await view.getByRole('button', { name: '停止麥克風' }).click()
  expect(onStop).toHaveBeenCalledOnce()
  await expect.element(view.getByRole('button', { name: '啟動麥克風' })).toBeEnabled()
})

it('does not bypass a profile with voice conversation disabled', async () => {
  const view = render(ArrayMicrophoneSettings, { props: { ...captureProps, enabled: false, voiceOnly: false, mode: 'standard', status: 'stopped', error: '', mapping: '0,1,2,3,4,5,6', radius: 44, vadStatus: 'not-ready', vadError: '', presenceStatus: 'ENGAGED' } })
  await expect.element(view.getByRole('button', { name: '啟動麥克風' })).toBeDisabled()
  await expect.element(view.getByText('此 Kiosk 未啟用語音對話，請先確認管理設定。')).toBeVisible()
})

it('shows the actual captured device and allows choosing UMA only while stopped', async () => {
  const selected = vi.fn()
  const device: MediaDeviceInfo = { deviceId: 'uma8', groupId: 'array', kind: 'audioinput', label: 'UMA-8', toJSON: () => ({}) }
  const view = render(ArrayMicrophoneSettings, { props: { ...captureProps, 'devices': [device], 'onUpdate:microphone': selected, 'enabled': false, 'mode': 'standard', 'status': 'stopped', 'error': '', 'mapping': '0,1,2,3,4,5,6', 'radius': 44, 'vadStatus': 'not-ready', 'vadError': '', 'presenceStatus': 'ENGAGED', 'capturedDevice': 'Built-in microphone' } })
  await expect.element(view.getByText('實際擷取裝置： Built-in microphone')).toBeVisible()
  await view.getByRole('combobox').click()
  await view.getByRole('option', { name: 'UMA-8' }).click()
  expect(selected).toHaveBeenCalledWith('uma8')
})

it('shows the active recognition gain and saturation count only in the operator panel', async () => {
  const view = render(ArrayMicrophoneSettings, { props: { ...captureProps, inputGainDb: 53.5, clippedSamples: 12, enabled: true, mode: 'mask', status: 'ready', channelCount: 8, error: '', mapping: '0,1,2,3,4,5,6', radius: 44, vadStatus: 'ready', vadError: '', presenceStatus: 'ENGAGED' } })
  await expect.element(view.getByText('辨識輸入增益： +53.5 dB')).toBeVisible()
  await expect.element(view.getByText('增幅後超過 Limiter 上限的樣本數： 12')).toBeVisible()
})

it('shows measured digital levels and VAD/ASR progress instead of implying ready means speech arrived', async () => {
  const view = render(ArrayMicrophoneSettings, { props: { ...captureProps, enabled: true, mode: 'mask', status: 'ready', channelCount: 8, error: '', mapping: '0,1,2,3,4,5,6', radius: 44, vadStatus: 'ready', vadError: '', presenceStatus: 'ENGAGED', inputDiagnostics: { processedSamples: 1024, inputLevel: { rmsDbfs: -80, peakDbfs: -77 }, outputLevel: { rmsDbfs: -15, peakDbfs: -12 }, probability: 0.12, maximumProbability: 0.48, speechStarts: 0, speechSegments: 0 }, spatialStatistics: { inputFrames: 3072, outputFrames: 1024, consumedFrames: 1024, lagSeconds: 0, maxWorkMs: 1, referenceLevel: { rmsDbfs: -70, peakDbfs: -65 }, maskLevel: { rmsDbfs: -80, peakDbfs: -77 } }, admissionCounts: { startBlocked: 0, endBlocked: 0, noCandidate: 0, overloaded: 0, asrRequests: 0 } } })
  await expect.element(view.getByText('Mask 後、增益前： RMS -80.0 / peak -77.0 dBFS')).toBeVisible()
  await expect.element(view.getByText('增益與 Limiter 後（VAD／STT 共用）： RMS -15.0 / peak -12.0 dBFS')).toBeVisible()
  await expect.element(view.getByText('語音機率（目前／本輪最高）： 0.120 / 0.480')).toBeVisible()
  await expect.element(view.getByText('VAD 起話／完整語句： 0 / 0')).toBeVisible()
})

it('shows the actual blocked-start reason beside ENGAGED without equating it with absence', async () => {
  const view = render(ArrayMicrophoneSettings, { props: { ...captureProps, enabled: true, mode: 'mask', status: 'ready', channelCount: 8, error: '', mapping: '0,1,2,3,4,5,6', radius: 44, vadStatus: 'ready', vadError: '', presenceStatus: 'ENGAGED', cameraStatus: 'observing', presenceAdmission: { allowed: true, reason: 'fresh_person', quality: 0.8, insideZone: true, ageMs: 100 }, lastVoiceBlock: { allowed: false, reason: 'low_quality', quality: 0.4, insideZone: true, ageMs: null } } })
  await expect.element(view.getByText('視覺在場狀態： ENGAGED')).toBeVisible()
  await expect.element(view.getByText('上次起話被擋（原因／quality／範圍內／有效影像年齡）： low_quality / 0.4 / true / — ms')).toBeVisible()
})
