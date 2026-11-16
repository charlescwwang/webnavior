/** Fixed-window geometry shared with the deployed whole-clip protocol. */
export const falconAudioLimits = {
  sampleRate: 16_000,
  frames: 25,
  frameMs: 40,
  pixelsPerFrame: 96 * 96,
  audioBytes: 64_000,
  packetBytes: 294_404,
} as const

/** Encodes exactly one synchronized window, without padding, overlap policy or normalization. */
export function encodeFalconWindow(audio: Float32Array, mouths: readonly Uint8Array[]): ArrayBuffer {
  const limits = falconAudioLimits
  if (audio.length !== limits.sampleRate)
    throw new Error('Falcon requires exactly 16000 finite Float32 audio samples.')
  if (mouths.length !== limits.frames)
    throw new Error('Falcon requires exactly 25 grayscale 96x96 mouth frames.')
  // This AP profile has no engine flags; do not use the reference server tag.
  return encode(audio, mouths, limits.frames)
}

/**
 * Encodes a whole clip for the deployed TypeScript Falcon API server.
 * The uint32 LE header is the plain frame count; engine flags from the
 * reference ZIP are rejected by this service. The service owns its engine.
 * Caller owns synchronization, tail padding and a lower device budget.
 */
export function encodeFalconClip(audio: Float32Array, mouths: readonly Uint8Array[]): ArrayBuffer {
  if (mouths.length < 25 || mouths.length > 1500)
    throw new Error('Falcon clips must contain 25 to 1500 synchronized frames.')
  return encode(audio, mouths, mouths.length)
}

function encode(audio: Float32Array, mouths: readonly Uint8Array[], tag: number): ArrayBuffer {
  const limits = falconAudioLimits
  if (audio.length !== mouths.length * 640 || audio.some(sample => !Number.isFinite(sample)))
    throw new Error('Falcon audio must contain 640 finite samples per mouth frame.')
  for (const frame of mouths) {
    if (!(frame instanceof Uint8Array) || frame.length !== limits.pixelsPerFrame)
      throw new Error('Falcon mouth frames must be 96x96 grayscale bytes.')
  }
  const audioBytes = audio.length * 4
  const packet = new ArrayBuffer(4 + audioBytes + mouths.length * limits.pixelsPerFrame)
  const view = new DataView(packet)
  view.setUint32(0, tag, true)
  for (let index = 0; index < audio.length; index++)
    view.setFloat32(4 + index * 4, audio[index]!, true)
  const bytes = new Uint8Array(packet)
  for (let index = 0; index < mouths.length; index++)
    bytes.set(mouths[index]!, 4 + audioBytes + index * limits.pixelsPerFrame)
  return packet
}
