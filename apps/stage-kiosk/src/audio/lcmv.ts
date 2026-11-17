import FFT from 'fft.js'

export const fftSize = 1024
export const hopSize = 256
/** Streaming sqrt-Hann STFT. Owns overlap/history; exactly1024frames scheduling latency. */
export class ArrayBeamformer {
  private fft = new FFT(fftSize)
  private history = Array.from({ length: 7 }, () => new Float64Array(fftSize))
  private window = Float64Array.from({ length: fftSize }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / fftSize)))
  private spectrum = new Float64Array(fftSize * 2)
  private sum = new Float64Array(fftSize * 2)
  private frame = new Float64Array(fftSize * 2)
  private input = new Float64Array(fftSize)
  private overlap = new Float64Array(fftSize)
  private output = new Float64Array(hopSize)
  private pointer = 0
  constructor(private weights: Float64Array, private channelMap: number[]) {
    if (weights.length !== (fftSize / 2 + 1) * 14 || channelMap.length !== 7 || new Set(channelMap).size !== 7 || channelMap.some(i => !Number.isInteger(i) || i < 0 || i > 7))
      throw new Error('Invalid beamformer configuration.')
  }

  /** Writes one mono block with no allocation; channel order is explicit, never mixed first. */
  process(channels: Float32Array[], output: Float32Array) {
    if (channels.length !== 8)
      throw new Error('UMA-8 requires eight equal-length channels.')
    for (const channel of channels) {
      if (channel.length !== output.length)
        throw new Error('UMA-8 requires eight equal-length channels.')
    }
    for (let i = 0; i < output.length; i++) {
      output[i] = this.output[this.pointer]!
      for (let ch = 0; ch < 7; ch++) {
        const sample = channels[this.channelMap[ch]!]![i]!
        if (!Number.isFinite(sample))
          throw new Error('Non-finite microphone sample.')
        this.history[ch]![fftSize - hopSize + this.pointer] = sample
      }
      if (++this.pointer === hopSize) {
        this.pointer = 0
        this.sum.fill(0)
        for (let ch = 0; ch < 7; ch++) {
          const history = this.history[ch]!
          for (let k = 0; k < fftSize; k++)
            this.input[k] = history[k]! * this.window[k]!
          this.fft.realTransform(this.spectrum, this.input)
          for (let k = 0; k <= fftSize / 2; k++) {
            const w = (k * 7 + ch) * 2
            const re = this.spectrum[k * 2]!
            const im = this.spectrum[k * 2 + 1]!
            this.sum[k * 2] += this.weights[w]! * re + this.weights[w + 1]! * im
            this.sum[k * 2 + 1] += this.weights[w]! * im - this.weights[w + 1]! * re
          }
          history.copyWithin(0, hopSize)
        }
        this.sum[1] = 0
        this.sum[fftSize + 1] = 0
        this.fft.completeSpectrum(this.sum)
        this.fft.inverseTransform(this.frame, this.sum)
        for (let k = 0; k < fftSize; k++)
          this.overlap[k] += this.frame[2 * k]! * this.window[k]! / 2
        for (let k = 0; k < hopSize; k++)
          this.output[k] = this.overlap[k]!
        this.overlap.copyWithin(0, hopSize)
        this.overlap.fill(0, fftSize - hopSize)
      }
    }
  }
}
