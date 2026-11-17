/** Recognition PCM and the number of samples requiring peak limiting. */
export interface InputGainResult {
  samples: Float32Array
  clippedSamples: number
}
/**
 * Fixed input gain followed by a sample-peak limiter at 16 kHz. Own one
 * instance per capture lifecycle so attenuation survives streaming boundaries.
 * Input PCM is untouched. Each independently gained branch owns its own limiter.
 * No lookahead, added frames, normalization or Gate is introduced.
 */
export class InputGain {
  private attenuation = 1
  // Leave headroom below PCM full scale. Immediate attack bounds even the first
  // transient; 50 ms exponential release avoids resetting gain at chunk edges.
  private readonly ceiling = 0.98
  private readonly release = Math.exp(-1 / (16000 * 0.05))
  /** Discard limiter history when its owning microphone/VAD lifecycle retires. */
  reset() {
    this.attenuation = 1
  }

  /** Apply gain exactly once, preserving sample count and temporal order. */
  process(input: Float32Array, gainDb: number): InputGainResult {
    if (!Number.isFinite(gainDb) || gainDb < 0 || gainDb > 80)
      throw new Error('Recognition gain must be between 0 and 80 dB.')
    if (input.some(value => !Number.isFinite(value)))
      throw new Error('Recognition PCM must contain finite samples.')
    if (gainDb === 0) {
      // Zero gain preserves exact PCM and clears prior limiter attenuation.
      this.reset()
      return { samples: input, clippedSamples: 0 }
    }
    const factor = 10 ** (gainDb / 20)
    const samples = new Float32Array(input.length)
    let clippedSamples = 0
    for (let i = 0; i < input.length; i++) {
      const amplified = input[i] * factor
      const magnitude = Math.abs(amplified)
      const required = magnitude > this.ceiling ? this.ceiling / magnitude : 1
      const released = 1 - (1 - this.attenuation) * this.release
      this.attenuation = Math.min(required, released)
      if (magnitude > this.ceiling)
        clippedSamples++
      samples[i] = amplified * this.attenuation
    }
    return { samples, clippedSamples }
  }
}
