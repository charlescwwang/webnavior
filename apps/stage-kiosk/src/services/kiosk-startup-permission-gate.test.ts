import { describe, expect, it, vi } from 'vitest'

import { createKioskStartupPermissionGate, prepareKioskMicrophonePermission } from './kiosk-startup-permission-gate'

describe('createKioskStartupPermissionGate', () => {
  it('keeps optional camera startup behind the microphone permission request', async () => {
    const gate = createKioskStartupPermissionGate()
    let cameraStartupStarted = false
    const waitForMicrophone = gate.wait().then(() => {
      cameraStartupStarted = true
    })

    await Promise.resolve()
    expect(cameraStartupStarted).toBe(false)

    gate.settle()
    await waitForMicrophone
    expect(cameraStartupStarted).toBe(true)
  })

  it('settles only once when the permission request reports multiple outcomes', async () => {
    const gate = createKioskStartupPermissionGate()
    gate.settle()
    gate.settle()

    await expect(gate.wait()).resolves.toBeUndefined()
  })
})

describe('prepareKioskMicrophonePermission', () => {
  it('does not request browser consent while text input remains available', async () => {
    const requestPermission = vi.fn(async () => undefined)
    const setAudioInputEnabled = vi.fn()

    await prepareKioskMicrophonePermission({
      audioInputEnabled: false,
      requestPermission,
      setAudioInputEnabled,
      voiceConversationOnly: false,
    })

    expect(requestPermission).not.toHaveBeenCalled()
    expect(setAudioInputEnabled).not.toHaveBeenCalled()
  })

  it('requests browser consent and enables audio for voice-only kiosks', async () => {
    const requestPermission = vi.fn(async () => undefined)
    const setAudioInputEnabled = vi.fn()

    await prepareKioskMicrophonePermission({
      audioInputEnabled: false,
      requestPermission,
      setAudioInputEnabled,
      voiceConversationOnly: true,
    })

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(setAudioInputEnabled).toHaveBeenCalledWith(true)
  })

  it('re-checks browser consent even when the enabled toggle was persisted', async () => {
    const requestPermission = vi.fn(async () => undefined)
    const setAudioInputEnabled = vi.fn()

    await prepareKioskMicrophonePermission({
      audioInputEnabled: true,
      requestPermission,
      setAudioInputEnabled,
      voiceConversationOnly: true,
    })

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(setAudioInputEnabled).not.toHaveBeenCalled()
  })
})
