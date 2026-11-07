import FFT from 'fft.js'

export const fftSize = 1024
export const hopSize = 256

/** Device geometry: centre MIC0, then MIC1..6; positive Y faces between MIC5/6. */
export function designWeights(radiusMm = 44, rate = 48000): Float64Array {
  if (!Number.isFinite(radiusMm) || radiusMm < 10 || radiusMm > 100 || rate !== 48000)
    throw new Error('Unsupported array geometry or sample rate.')
  const r = radiusMm / 1000
  const h = Math.sqrt(3) / 2
  const positions = [[0, 0], [-r, 0], [-r / 2, -r * h], [r / 2, -r * h], [r, 0], [r / 2, r * h], [-r / 2, r * h]]
  const weights = new Float64Array((fftSize / 2 + 1) * 7 * 2)
  for (let bin = 0; bin <= fftSize / 2; bin++) {
    const a = positions.map(([x, y]) => [0, -Math.PI / 2, Math.PI / 2].map((angle) => {
      const phase = 2 * Math.PI * bin * rate / fftSize * (x! * Math.sin(angle) + y! * Math.cos(angle)) / 343
      return [Math.cos(phase), Math.sin(phase)]
    }))
    // Solve the loaded3x3 complex Gram system once at setup, never per audio hop.
    const rows = Array.from({ length: 3 }, (_, i) => {
      const row = new Float64Array(8)
      for (let j = 0; j < 3; j++) {
        for (let ch = 0; ch < 7; ch++) {
          const [ar, ai] = a[ch]![i]!
          const [br, bi] = a[ch]![j]!
          row[j * 2] += ar! * br! + ai! * bi!
          row[j * 2 + 1] += ar! * bi! - ai! * br!
        }
        if (i === j)
          row[j * 2] += 0.03 * 7
      }
      row[6] = i === 0 ? 1 : 0
      return row
    })
    for (let pivot = 0; pivot < 3; pivot++) {
      const row = rows[pivot]!
      const pr = row[2 * pivot]!
      const pi = row[2 * pivot + 1]!
      const norm = pr * pr + pi * pi
      for (let j = pivot; j < 4; j++) {
        const re = row[2 * j]!
        const im = row[2 * j + 1]!
        row[2 * j] = (re * pr + im * pi) / norm
        row[2 * j + 1] = (im * pr - re * pi) / norm
      }
      for (let i = 0; i < 3; i++) {
        if (i === pivot)
          continue
        const other = rows[i]!
        const re = other[2 * pivot]!
        const im = other[2 * pivot + 1]!
        for (let j = pivot; j < 4; j++) {
          other[2 * j] -= re * row[2 * j]! - im * row[2 * j + 1]!
          other[2 * j + 1] -= re * row[2 * j + 1]! + im * row[2 * j]!
        }
      }
    }
    let targetRe = 0
    let targetIm = 0
    for (let ch = 0; ch < 7; ch++) {
      const offset = (bin * 7 + ch) * 2
      for (let i = 0; i < 3; i++) {
        const [re, im] = a[ch]![i]!
        weights[offset] += re! * rows[i]![6]! - im! * rows[i]![7]!
        weights[offset + 1] += re! * rows[i]![7]! + im! * rows[i]![6]!
      }
      const [frontRe, frontIm] = a[ch]![0]!
      targetRe += weights[offset]! * frontRe! + weights[offset + 1]! * frontIm!
      targetIm += weights[offset]! * frontIm! - weights[offset + 1]! * frontRe!
    }
    const norm = targetRe ** 2 + targetIm ** 2
    for (let ch = 0; ch < 7; ch++) {
      const i = (bin * 7 + ch) * 2
      const re = weights[i]!
      const im = weights[i + 1]!
      weights[i] = (re * targetRe - im * targetIm) / norm
      weights[i + 1] = (im * targetRe + re * targetIm) / norm
    }
  }
  return weights
}

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
          for (let k = 0; k < fftSize; k++) this.input[k] = history[k]! * this.window[k]!
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
        for (let k = 0; k < fftSize; k++) this.overlap[k] += this.frame[2 * k]! * this.window[k]! / 2
        for (let k = 0; k < hopSize; k++) this.output[k] = this.overlap[k]!
        this.overlap.copyWithin(0, hopSize)
        this.overlap.fill(0, fftSize - hopSize)
      }
    }
  }
}
