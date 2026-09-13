import { describe, expect, it } from 'vitest'

import { createKioskVadRecording } from './kiosk-audio'

describe('createKioskVadRecording', () => {
  it('preserves the leading VAD padding samples in the WAV payload', async () => {
    const recording = createKioskVadRecording(new Float32Array([-1, -0.5, 0, 0.5, 1]))
    const payload = await recording.arrayBuffer()
    const samples = new Int16Array(payload.slice(44))

    expect(recording.type).toBe('audio/wav')
    expect(samples).toEqual(new Int16Array([-32768, -16384, 0, 16384, 32767]))
  })
})
