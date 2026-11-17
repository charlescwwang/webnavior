/** Same centred 61-tap FIR and 48k/16k source clock as SpatialMask's raw output. */
export class Decimator {
  private readonly fir: Float64Array
  private readonly ring = [new Float32Array(128), new Float32Array(128)]
  private input = 0
  private output = 0
  private raw = new Float32Array(512)
  private processed = new Float32Array(512)
  private pending = 0
  private ended = false
  constructor(private emit: (raw: Float32Array, processed: Float32Array, offsetFrames: number) => void) {
    const i0 = (x: number) => {
      let v = 1
      let sum = 1
      for (let k = 1; k < 24; k++) {
        v *= x * x / (4 * k * k)
        sum += v
        if (v < 1e-15 * sum)
          break
      }
      return sum
    }
    const taps: number[] = []
    let sum = 0
    for (let j = -30; j <= 30; j++) {
      const t = j / 30
      const win = i0(5 * Math.sqrt(Math.max(0, 1 - t * t))) / i0(5)
      const v = (j === 0 ? 1 / 3 : Math.sin(Math.PI * j / 3) / (Math.PI * j)) * win
      taps.push(v)
      sum += v
    }
    this.fir = Float64Array.from(taps.map(x => x / sum))
  }

  push(raw: Float32Array, processed: Float32Array) {
    if (this.ended || raw.length !== processed.length)
      throw new Error('Invalid decimator input')
    for (let i = 0; i < raw.length; i++)
      this.sample(raw[i], processed[i])
  }

  private sample(raw: number, processed: number) {
    const idx = this.input++
    this.ring[0][idx % 128] = raw
    this.ring[1][idx % 128] = processed
    const center = idx - 30
    if (center < 0 || center % 3 !== 0)
      return
    for (let ch = 0; ch < 2; ch++) {
      let sum = 0
      for (let offset = -30; offset <= 30; offset++) {
        const p = center + offset
        if (p >= 0)
          sum += this.fir[offset + 30] * this.ring[ch][p % 128]
      }
      const target = ch === 0 ? this.raw : this.processed
      target[this.pending] = sum
    }
    if (++this.pending === 512)
      this.flush()
  }

  private flush() {
    if (!this.pending)
      return
    const raw = this.raw.slice(0, this.pending)
    const processed = this.processed.slice(0, this.pending)
    const start = this.output
    this.output += this.pending
    this.pending = 0
    this.emit(raw, processed, start)
  }

  finish() {
    if (this.ended)
      return
    this.ended = true
    // Exactly enough zero extension for centres belonging to the true input.
    for (let i = 0; i < 30; i++)
      this.sample(0, 0)
    this.flush()
  }

  get outputLength() { return this.output }
}
