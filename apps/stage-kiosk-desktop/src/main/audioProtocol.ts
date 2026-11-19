import { Buffer } from 'node:buffer'

/** Bounded binary pipe framing shared by the supervisor's writer and reader. */
export interface AudioFrame {
  metadata: unknown
  samples: Float32Array
}
const maxJson = 64 * 1024
const maxPcm = 2 * 1024 * 1024

/** JSON length and PCM byte length are uint32 LE; PCM is little-endian float32. */
export function encodeFrame(metadata: unknown, samples = new Float32Array()): Buffer {
  const json = Buffer.from(JSON.stringify(metadata), 'utf8')
  if (!json.length || json.length > maxJson || samples.byteLength > maxPcm)
    throw new Error('Native audio message exceeds its storage bound.')
  const header = Buffer.alloc(8)
  header.writeUInt32LE(json.length, 0)
  header.writeUInt32LE(samples.byteLength, 4)
  return Buffer.concat([header, json, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)])
}

/** Retains at most one partial envelope; callers must retire the process on corruption. */
export class AudioFrameDecoder {
  private pending = Buffer.alloc(0)
  push(data: Buffer): AudioFrame[] {
    this.pending = Buffer.concat([this.pending, data])
    const frames: AudioFrame[] = []
    while (this.pending.length >= 8) {
      const json = this.pending.readUInt32LE(0)
      const pcm = this.pending.readUInt32LE(4)
      if (!json || json > maxJson || pcm > maxPcm || pcm % 4)
        throw new Error('Invalid native audio envelope size.')
      const size = 8 + json + pcm
      if (this.pending.length < size)
        break
      const metadata: unknown = JSON.parse(this.pending.subarray(8, 8 + json).toString('utf8'))
      // Pipe chunks have arbitrary alignment; copy before making a float view.
      const samples = new Float32Array(Uint8Array.from(this.pending.subarray(8 + json, size)).buffer)
      frames.push({ metadata, samples })
      this.pending = this.pending.subarray(size)
    }
    if (this.pending.length > maxJson + maxPcm + 8)
      throw new Error('Native audio decoder exceeded its storage bound.')
    return frames
  }
}
