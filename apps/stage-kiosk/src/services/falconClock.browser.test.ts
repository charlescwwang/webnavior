import type { BaseVAD } from '@proj-airi/stage-ui/libs/audio/vad'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { createVADStates } from '@proj-airi/stage-ui/libs/audio/vad'
import { expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

it('maps real AudioWorklet sample times onto the camera performance clock', async () => {
  const source = new AudioContext({ sampleRate: 16000 })
  const oscillator = source.createOscillator()
  const destination = source.createMediaStreamDestination()
  oscillator.connect(destination)
  oscillator.start()
  const received: Array<{ samples: number, endTimeMs?: number }> = []
  const vad: BaseVAD = {
    initialize: async () => {},
    processAudio: async (buffer, endTimeMs) => { received.push({ samples: buffer.length, endTimeMs }) },
    on: () => {},
    off: () => {},
  }
  const manager = createVADStates(vad, workletUrl)
  const button = document.createElement('button')
  button.textContent = 'Start synthetic audio'
  document.body.append(button)
  try {
    await manager.initialize()
    // A real gesture satisfies browser autoplay policy for both contexts.
    // The test does not grant microphone permission or mock Web Audio clocks.
    let started: Promise<unknown> | undefined
    button.onclick = () => {
      started = Promise.all([source.resume(), manager.start(destination.stream)])
    }
    await userEvent.click(button)
    await started
    await expect.poll(() => received.length, { timeout: 5000 }).toBeGreaterThanOrEqual(4)
    const now = performance.now()
    expect(received.every(frame => frame.samples === 512)).toBe(true)
    expect(received.every(frame => frame.endTimeMs !== undefined && frame.endTimeMs <= now + 100 && frame.endTimeMs > now - 5000)).toBe(true)
    expect(received[1]!.endTimeMs!).toBeGreaterThan(received[0]!.endTimeMs!)
  }
  finally {
    manager.dispose()
    button.remove()
    oscillator.stop()
    destination.stream.getTracks().forEach(track => track.stop())
    await source.close()
  }
})
