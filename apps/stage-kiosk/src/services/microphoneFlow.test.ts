import { expect, it, vi } from 'vitest'

import { prepareKioskMicrophonePermission } from './kiosk-startup-permission-gate'

// Report: this chat,2026-11-07 — enter voice Kiosk -> ask permission first;
// with no saved device, choose in startup UI before admitting audio to ASR.
it('requests consent without starting a default microphone when no device is saved', async () => {
  const requestDevices = vi.fn(async () => {})
  const startStream = vi.fn(async () => {})
  const enabled: boolean[] = []
  const result = await prepareKioskMicrophonePermission({ voiceConversationOnly: true, hasSelectedMicrophone: false, requestDevices, startStream, signal: new AbortController().signal, setAudioInputEnabled: value => enabled.push(value) })
  expect(requestDevices).toHaveBeenCalledOnce()
  expect(startStream).not.toHaveBeenCalled()
  expect(enabled).toEqual([false])
  expect(result).toBe('selection-required')
})
it('reuses saved device acquisition as consent without an extra temporary permission stream', async () => {
  const requestDevices = vi.fn(async () => {})
  const startStream = vi.fn(async () => {})
  const enabled: boolean[] = []
  const result = await prepareKioskMicrophonePermission({ voiceConversationOnly: true, hasSelectedMicrophone: true, requestDevices, startStream, signal: new AbortController().signal, setAudioInputEnabled: value => enabled.push(value) })
  expect(requestDevices).not.toHaveBeenCalled()
  expect(startStream).toHaveBeenCalledOnce()
  expect(enabled).toEqual([true])
  expect(result).toBe('capturing')
})
it('does not request permission or capture in text mode even without a saved device', async () => {
  const requestDevices = vi.fn(async () => {})
  const startStream = vi.fn(async () => {})
  await prepareKioskMicrophonePermission({ voiceConversationOnly: false, hasSelectedMicrophone: false, requestDevices, startStream, signal: new AbortController().signal, setAudioInputEnabled: vi.fn() })
  expect(requestDevices).not.toHaveBeenCalled()
  expect(startStream).not.toHaveBeenCalled()
})
it('does not enable capture after rejection or late consent on a retired startup', async () => {
  const pending = Promise.withResolvers<void>()
  const controller = new AbortController()
  const startStream = vi.fn(async () => {})
  const setAudioInputEnabled = vi.fn()
  const result = prepareKioskMicrophonePermission({ voiceConversationOnly: true, hasSelectedMicrophone: false, requestDevices: () => pending.promise, startStream, signal: controller.signal, setAudioInputEnabled })
  controller.abort()
  pending.resolve()
  await expect(result).rejects.toThrow()
  expect(startStream).not.toHaveBeenCalled()
  expect(setAudioInputEnabled.mock.calls.some(([enabled]) => enabled)).toBe(false)
})
