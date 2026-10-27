import type { KioskAudioChunk } from '@proj-airi/stage-shared/kiosk-audio'

import { kioskAudioLimits } from '@proj-airi/stage-shared/kiosk-audio'

const VAD_SAMPLE_RATE = kioskAudioLimits.sampleRate
const WAV_HEADER_BYTES = kioskAudioLimits.wavHeaderBytes

/**
 * Transcribes one final VAD utterance through bounded uploads. Chunks never
 * become independent orders: only a completely successful utterance is returned.
 * The caller's capture/session signal also cancels any remaining uploads.
 */
export async function transcribeKioskUtterance(samples: Float32Array, options: {
  signal?: AbortSignal
  /** Called only after a whole chunk succeeds, to renew the capture's inactivity deadline. */
  onChunkTranscribed?: () => void
  transcribe: (recording: Blob, signal?: AbortSignal, chunk?: KioskAudioChunk) => Promise<{ text: string }>
}) {
  const texts: string[] = []
  const utteranceId = crypto.randomUUID()
  const maximumSamples = VAD_SAMPLE_RATE * kioskAudioLimits.chunkSeconds
  for (let start = 0; start < samples.length;) {
    options.signal?.throwIfAborted()
    let end = Math.min(samples.length, start + maximumSamples)
    if (end < samples.length) {
      const boundary = end
      // Prefer a quiet 20ms window in the last second. Non-overlapping sample
      // ranges preserve all audio once, including corrections across a boundary.
      const windowSamples = VAD_SAMPLE_RATE / 50
      let lowestEnergy = Number.POSITIVE_INFINITY
      for (let position = boundary - VAD_SAMPLE_RATE; position + windowSamples <= boundary; position += windowSamples) {
        let energy = 0
        for (let index = position; index < position + windowSamples; index++)
          energy += samples[index]! ** 2
        if (energy <= lowestEnergy) {
          lowestEnergy = energy
          end = position + windowSamples
        }
      }
    }
    const chunk: KioskAudioChunk = { utteranceId, index: texts.length, sampleStart: start, sampleEnd: end, final: end === samples.length }
    const { text } = await options.transcribe(createKioskVadRecording(samples.subarray(start, end)), options.signal, chunk)
    options.signal?.throwIfAborted()
    if (samples.length > maximumSamples && !text.trim())
      throw new Error('ASR did not recognize every part of this utterance.')
    texts.push(text.trim())
    options.onChunkTranscribed?.()
    start = end
  }
  return { text: texts.join('\n'), recording: createKioskVadRecording(samples) }
}

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
