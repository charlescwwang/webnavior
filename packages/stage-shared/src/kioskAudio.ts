import type { InferOutput } from 'valibot'

import { integer, maxValue, minValue, number, optional, picklist, pipe, strictObject } from 'valibot'

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
