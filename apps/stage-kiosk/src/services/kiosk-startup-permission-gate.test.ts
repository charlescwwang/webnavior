import { describe, expect, it } from 'vitest'

import { createKioskStartupPermissionGate } from './kiosk-startup-permission-gate'

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
