import type { InferOutput } from 'valibot'

import { array, check, integer, length, literal, maxLength, maxValue, minLength, minValue, number, optional, picklist, pipe, strictObject, string } from 'valibot'

/** PCM upload contract. Multipart overhead stays below the headroom of a 20-second WAV. */
export const kioskAudioLimits = {
  sampleRate: 16_000,
  bytesPerSample: 2,
  wavHeaderBytes: 44,
  chunkSeconds: 20,
  requestBytes: 1024 * 1024,
} as const

/** Upload correlation only; sample positions refer to one original final VAD buffer. */
export interface KioskAudioChunk {
  utteranceId: string
  /** Zero-based upload order within this utterance. */
  index: number
  /** Inclusive original sample position, before PCM encoding. */
  sampleStart: number
  /** Exclusive original sample position; the next chunk starts here. */
  sampleEnd: number
  final: boolean
}

/** Device-level operational warning. Never includes audio, dialogue or raw error text. */
export const audioWarningSchema = strictObject({
  // Browser-local owner generation; device identity and receipt time belong to Server logging.
  generation: pipe(number(), integer(), minValue(1), maxValue(Number.MAX_SAFE_INTEGER)),
  stage: picklist(['capture', 'channels', 'mask_init', 'mask_runtime', 'playback', 'vad']),
  outcome: picklist(['standard', 'unavailable']),
  code: optional(picklist(['play_rejected', 'media_error', 'vad_error'])),
  // Actual probe input before fallback, not the restored stream channel count.
  channels: optional(pipe(number(), integer(), minValue(1), maxValue(32))),
})
export type AudioWarning = InferOutput<typeof audioWarningSchema>

/** One fixed-duration, same-clock diagnostic capture; never an ASR request. */
export const audioComparisonSchema = pipe(strictObject({
  comparisonId: pipe(string(), minLength(1), maxLength(120)),
  role: picklist(['raw', 'reference', 'processed']),
  sampleRate: literal(48000),
  channels: picklist([1, 8]),
  frameCount: pipe(number(), integer(), minValue(1), maxValue(720000)),
  sampleStart: pipe(number(), integer(), minValue(0)),
  algorithm: literal('lcmv-v1'),
  radiusMm: pipe(number(), minValue(10), maxValue(100)),
  loading: literal(0.03),
  channelMap: pipe(array(pipe(number(), integer(), minValue(0), maxValue(7))), length(7), check(value => new Set(value).size === 7)),
  delayFrames: literal(1024),
}), check(value => value.channels === (value.role === 'raw' ? 8 : 1)))
export type AudioComparison = InferOutput<typeof audioComparisonSchema>

/** Encodes unnormalised same-clock diagnostic PCM; raw channels retain float32 precision. */
export function encodeComparisonRecording(samples: Float32Array, info: Pick<AudioComparison, 'role' | 'channels' | 'frameCount'> & { sampleRate: number }): Blob {
  if (![16000, 48000].includes(info.sampleRate))
    throw new Error('Comparison WAV requires 16kHz or 48kHz.')
  if (samples.length !== info.frameCount * info.channels)
    throw new Error('Comparison sample count does not match its metadata.')
  const bytes = info.role === 'raw' ? 4 : 2
  const buffer = new ArrayBuffer(44 + samples.length * bytes)
  const view = new DataView(buffer)
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  view.setUint32(4, buffer.byteLength - 8, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, bytes === 4 ? 3 : 1, true)
  view.setUint16(22, info.channels, true)
  view.setUint32(24, info.sampleRate, true)
  view.setUint32(28, info.sampleRate * info.channels * bytes, true)
  view.setUint16(32, info.channels * bytes, true)
  view.setUint16(34, bytes * 8, true)
  view.setUint32(40, samples.length * bytes, true)
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]!
    if (!Number.isFinite(value))
      throw new Error('Non-finite comparison sample.')
    if (bytes === 4)
      view.setFloat32(44 + i * bytes, value, true)
    else view.setInt16(44 + i * bytes, Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)), true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/** Upload validation checks actual bytes, not only client claims about channel/time alignment. */
export function validateComparisonRecording(data: Uint8Array, info: AudioComparison): boolean {
  if (data.length < 44)
    return false
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const ascii = (start: number, text: string) => [...text].every((ch, i) => data[start + i] === ch.charCodeAt(0))
  const bytes = info.role === 'raw' ? 4 : 2
  return ascii(0, 'RIFF') && ascii(8, 'WAVE') && ascii(12, 'fmt ') && ascii(36, 'data')
    && view.getUint32(4, true) === data.length - 8 && view.getUint32(16, true) === 16
    && view.getUint16(20, true) === (bytes === 4 ? 3 : 1)
    && view.getUint16(22, true) === info.channels && view.getUint32(24, true) === info.sampleRate
    && view.getUint32(28, true) === info.sampleRate * info.channels * bytes
    && view.getUint16(32, true) === info.channels * bytes && view.getUint16(34, true) === bytes * 8
    && view.getUint32(40, true) === info.frameCount * info.channels * bytes
    && data.length === 44 + info.frameCount * info.channels * bytes
}

/** Equality of capture facts across roles; independent of JSON object key ordering. */
export function sameComparisonCapture(a: AudioComparison, b: AudioComparison): boolean {
  return a.comparisonId === b.comparisonId && a.sampleRate === b.sampleRate && a.frameCount === b.frameCount
    && a.sampleStart === b.sampleStart && a.algorithm === b.algorithm && a.radiusMm === b.radiusMm
    && a.loading === b.loading && a.delayFrames === b.delayFrames
    && a.channelMap.every((channel, i) => channel === b.channelMap[i])
}
