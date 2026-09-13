const VAD_SAMPLE_RATE = 16_000
const WAV_HEADER_BYTES = 44

/**
 * Encodes a completed VAD segment as the WAV file stored and transcribed by
 * the Kiosk. The VAD segment already includes its configured leading padding,
 * so this must consume the buffer from its first sample.
 */
export function createKioskVadRecording(samples: Float32Array) {
  const bytesPerSample = 2
  const payloadSize = samples.length * bytesPerSample
  const wav = new ArrayBuffer(WAV_HEADER_BYTES + payloadSize)
  const view = new DataView(wav)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + payloadSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, VAD_SAMPLE_RATE, true)
  view.setUint32(28, VAD_SAMPLE_RATE * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, payloadSize, true)

  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(WAV_HEADER_BYTES + index * bytesPerSample, Math.round(sample * (sample < 0 ? 0x8000 : 0x7FFF)), true)
  }

  return new Blob([wav], { type: 'audio/wav' })
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index++)
    view.setUint8(offset + index, text.charCodeAt(index))
}
