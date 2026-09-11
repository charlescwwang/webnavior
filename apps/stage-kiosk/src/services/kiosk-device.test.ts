import { describe, expect, it } from 'vitest'

import { createKioskTranscriptionBody } from './kiosk-device'

describe('createKioskTranscriptionBody', () => {
  it('labels WAV microphone recordings with their actual container format', () => {
    const recording = new Blob(['RIFF'], { type: 'audio/wav' })

    const uploaded = createKioskTranscriptionBody(recording).get('file')

    expect(uploaded).toBeInstanceOf(File)
    expect(uploaded).toMatchObject({
      name: 'recording.wav',
      type: 'audio/wav',
    })
  })
})
