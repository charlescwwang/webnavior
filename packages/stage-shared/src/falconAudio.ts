/** Upstream-reported stage durations, in milliseconds; neither measures WAV delivery. */
export interface FalconTiming {
  inferenceMs?: number
  asrMs?: number
}

/** Final text and optional upstream telemetry from the Falcon+ASR service. */
export interface FalconTranscription {
  text: string
  timing?: FalconTiming
}

/** Fixed-window geometry shared with the deployed whole-clip protocol. */
export const falconAudioLimits = {
  sampleRate: 16_000,
  frames: 25,
  frameMs: 40,
  pixelsPerFrame: 96 * 96,
  audioBytes: 64_000,
  packetBytes: 294_404,
  maxClipSeconds: 30,
  maxClipBytes: 4 + 30 * (64_000 + 25 * 96 * 96),
} as const

/** Validates untrusted whole-clip bytes before the server forwards them upstream. */
export function validateFalconClip(packet: ArrayBuffer, maxSeconds: number): number {
  if (packet.byteLength < 4 || packet.byteLength > falconAudioLimits.maxClipBytes)
    throw new Error('Falcon clip size is invalid.')
  const view = new DataView(packet)
  const frames = view.getUint32(0, true)
  if (frames < 25 || frames > Math.min(maxSeconds, falconAudioLimits.maxClipSeconds) * 25 || packet.byteLength !== 4 + frames * (640 * 4 + 96 * 96))
    throw new Error('Falcon clip frame count or length is invalid.')
  for (let offset = 4; offset < 4 + frames * 640 * 4; offset += 4) {
    if (!Number.isFinite(view.getFloat32(offset, true)))
      throw new Error('Falcon clip contains non-finite audio.')
  }
  return frames
}

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
