import { describe, expect, it, vi } from 'vitest'

import { createKioskStartupPermissionGate, prepareKioskMicrophonePermission } from './kiosk-startup-permission-gate'

describe('sequential camera and real microphone startup', () => {
  it('waits for real microphone startup before camera startup and settles once', async () => {
    const gate = createKioskStartupPermissionGate()
    let started = false
    const waiting = gate.wait().then(() => {
      started = true
    })
    await Promise.resolve()
    expect(started).toBe(false)
    gate.settle()
    gate.settle()
    await waiting
    expect(started).toBe(true)
  })

  it('does not capture in text-only mode', async () => {
    const startStream = vi.fn(async () => undefined)
    const setAudioInputEnabled = vi.fn()
    await prepareKioskMicrophonePermission({ hasSelectedMicrophone: true, requestDevices: async () => {}, voiceConversationOnly: false, signal: new AbortController().signal, startStream, setAudioInputEnabled })
    expect(startStream).not.toHaveBeenCalled()
    expect(setAudioInputEnabled).not.toHaveBeenCalled()
  })

  // Report: this chat,2026-11-05 — avoid permission-only requests on every reload.
  it('acquires the real stream on reload before enabling the audio pipeline', async () => {
    const calls: string[] = []
    const startStream = vi.fn(async () => {
      calls.push('real-capture')
    })
    const setAudioInputEnabled = vi.fn(() => {
      calls.push('enabled')
    })
    await prepareKioskMicrophonePermission({ hasSelectedMicrophone: true, requestDevices: async () => {}, voiceConversationOnly: true, signal: new AbortController().signal, startStream, setAudioInputEnabled })
    expect(startStream).toHaveBeenCalledOnce()
    expect(calls).toEqual(['real-capture', 'enabled'])
  })

  it('does not declare enabled or retry when the real stream is denied', async () => {
    const startStream = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    const setAudioInputEnabled = vi.fn()
    await expect(prepareKioskMicrophonePermission({ hasSelectedMicrophone: true, requestDevices: async () => {}, voiceConversationOnly: true, signal: new AbortController().signal, startStream, setAudioInputEnabled })).rejects.toThrow('denied')
    expect(startStream).toHaveBeenCalledOnce()
    expect(setAudioInputEnabled).not.toHaveBeenCalled()
  })

  it('does not capture when its owner has already stopped', async () => {
    const controller = new AbortController()
    controller.abort()
    const startStream = vi.fn(async () => undefined)
    const setAudioInputEnabled = vi.fn()
    await expect(prepareKioskMicrophonePermission({ hasSelectedMicrophone: true, requestDevices: async () => {}, voiceConversationOnly: true, signal: controller.signal, startStream, setAudioInputEnabled })).rejects.toThrow()
    expect(startStream).not.toHaveBeenCalled()
    expect(setAudioInputEnabled).not.toHaveBeenCalled()
  })

  it('cannot enable a retired startup when its capture completes later', async () => {
    const controller = new AbortController()
    const capture = Promise.withResolvers<void>()
    const setAudioInputEnabled = vi.fn()
    const result = prepareKioskMicrophonePermission({ hasSelectedMicrophone: true, requestDevices: async () => {}, voiceConversationOnly: true, signal: controller.signal, startStream: () => capture.promise, setAudioInputEnabled })
    controller.abort()
    capture.resolve()
    await expect(result).rejects.toThrow()
    expect(setAudioInputEnabled).not.toHaveBeenCalled()
  })
})

// Report: this chat,2026-11-06 — microphone remained off after text/voice startup.
it('enables the acquired voice stream even when permission state resets the persisted toggle during capture', async () => {
  let enabled = true
  const pending = Promise.withResolvers<void>()
  const startup = prepareKioskMicrophonePermission({ hasSelectedMicrophone: true, requestDevices: async () => {}, voiceConversationOnly: true, signal: new AbortController().signal, startStream: () => pending.promise, setAudioInputEnabled: value => enabled = value })
  enabled = false
  pending.resolve()
  await startup
  expect(enabled).toBe(true)
})
