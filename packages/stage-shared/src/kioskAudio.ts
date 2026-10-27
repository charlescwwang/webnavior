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
