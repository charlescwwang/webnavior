import type { BaseVAD } from '@proj-airi/stage-ui/libs/audio/vad'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { createVADStates } from '@proj-airi/stage-ui/libs/audio/vad'
import { expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

// Report: this chat, 2026-11-17 — ordinary microphones must receive the same pre-VAD gate as external UMA PCM.
it('samples visual admission on real worklet audio before forwarding it to VAD', async () => {
  const source = new AudioContext({ sampleRate: 16000 })
  const oscillator = source.createOscillator()
  const destination = source.createMediaStreamDestination()
  oscillator.connect(destination)
  oscillator.start()
  let allowed = false
  const received: boolean[] = []
  const vad: BaseVAD = {
    initialize: async () => {},
    processAudio: async (_buffer, _time, _recording, canStart) => { received.push(canStart === true) },
    on: () => {},
    off: () => {},
  }
  const manager = createVADStates(vad, workletUrl, { canStartSpeech: () => allowed })
  const button = document.createElement('button')
  button.textContent = 'Start visually gated audio'
  document.body.append(button)
  try {
    await manager.initialize()
    let started: Promise<unknown> | undefined
    button.onclick = () => {
      started = Promise.all([source.resume(), manager.start(destination.stream)])
    }
    await userEvent.click(button)
    await started
    await expect.poll(() => received.length).toBeGreaterThanOrEqual(3)
    expect(received.every(value => !value)).toBe(true)
    allowed = true
    await expect.poll(() => received.includes(true)).toBe(true)
    allowed = false
    const boundary = received.length
    await expect.poll(() => received.length).toBeGreaterThan(boundary + 2)
    expect(received.slice(boundary).every(value => !value)).toBe(true)
  }
  finally {
    manager.dispose()
    button.remove()
    oscillator.stop()
    destination.stream.getTracks().forEach(track => track.stop())
    await source.close()
  }
})
