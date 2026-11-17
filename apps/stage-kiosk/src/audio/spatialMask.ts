/** One contiguous, unnormalised 16kHz block. offsetFrames is absolute for this engine. */
export interface MaskOutput {
  raw: Float32Array
  mask: Float32Array
  offsetFrames: number
}
interface MaskFrame {
  fm: Float64Array
  frontR: Float64Array
  frontI: Float64Array
}
/**
 * Spatial competition mask derived from the user-supplied UMA-8 v1.4 core.
 * Seven mapped 48kHz channels in; 16kHz mono out. No spatial Gate or silence gate.
 * FIR/FFT/mask arithmetic follows fixtures/spatialMask/reference.js. Only the
 * emission schedule and storage ownership differ; output slots are reclaimed
 * after overlap-add is final. Do not reset this engine between utterances.
 */
export class SpatialMask {
  private onOutput: (output: MaskOutput) => void
  private angles: number[]
  private window: Float64Array
  private bitrev: Uint16Array
  private fftR: Float64Array
  private fftI: Float64Array
  private downScratch: Float64Array
  private normReScratch: Float64Array
  private normImScratch: Float64Array
  private spectraRScratch: Float64Array[]
  private spectraIScratch: Float64Array[]
  private phaseR: Float64Array
  private phaseI: Float64Array
  private gf: Float64Array
  private gt: Float64Array
  private fir: Float64Array
  private ring48: Float32Array[]
  private ring16: Float32Array[]
  private originalInputFrames = 0
  private samples48: number
  private samples16: number
  private frames: MaskFrame[]
  private frameCount = 0
  private didMask: number
  private capacity: number
  private accMask: Float64Array
  private norm: Float64Array
  private raw16: Float32Array
  private finalized: number
  private sent: number
  private finalFrameCount: number
  private final: boolean
  outputLength = 0
  constructor(onOutput: (output: MaskOutput) => void, radiusMm = 45) {
    if (!Number.isFinite(radiusMm) || radiusMm < 10 || radiusMm > 100)
      throw new Error('Invalid array radius')
    this.onOutput = onOutput
    this.angles = [-10, -5, 0, 5, 10, -90, -60, -45, 45, 60, 90, 180]
    this.window = Float64Array.from({ length: 512 }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / 512))
    this.bitrev = new Uint16Array(512)
    for (let i = 0; i < 512; i++) {
      let v = i
      let r = 0
      for (let j = 0; j < 9; j++) {
        r = (r << 1) | (v & 1)
        v >>= 1
      }
      this.bitrev[i] = r
    }
    this.fftR = new Float64Array(512)
    this.fftI = new Float64Array(512)
    this.downScratch = new Float64Array(7)
    this.normReScratch = new Float64Array(7)
    this.normImScratch = new Float64Array(7)
    this.spectraRScratch = Array.from({ length: 7 }, () => new Float64Array(257))
    this.spectraIScratch = Array.from({ length: 7 }, () => new Float64Array(257))
    this.phaseR = new Float64Array(12 * 7 * 257)
    this.phaseI = new Float64Array(12 * 7 * 257)
    const radius = radiusMm / 1000
    const micXY = [[0, 0], [-radius, 0], [-(radius / 2), radius * Math.sqrt(3) / 2], [(radius / 2), radius * Math.sqrt(3) / 2], [radius, 0], [(radius / 2), -radius * Math.sqrt(3) / 2], [-(radius / 2), -radius * Math.sqrt(3) / 2]]
    for (let a = 0; a < 12; a++) {
      const rad = this.angles[a] * Math.PI / 180
      const dx = Math.sin(rad)
      const dy = -Math.cos(rad)
      for (let m = 0; m < 7; m++) {
        const tau = (micXY[m][0] * dx + micXY[m][1] * dy) / 343
        for (let f = 0; f < 257; f++) {
          const phase = -2 * Math.PI * (f * 16000 / 512) * tau
          const p = (a * 7 + m) * 257 + f
          this.phaseR[p] = Math.cos(phase)
          this.phaseI[p] = Math.sin(phase)
        }
      }
    }
    const gauss = (sigma: number) => {
      const rad = Math.round(4 * sigma)
      const values: number[] = []
      for (let i = -rad; i <= rad; i++)
        values.push(Math.exp(-0.5 * (i / sigma) ** 2))
      const sum = values.reduce((u, v) => u + v, 0)
      return Float64Array.from(values.map(v => v / sum))
    }
    this.gf = gauss(1.4)
    this.gt = gauss(0.9)
    // Polyphase-compatible decimator (scipy.signal.resample_poly, 48k -> 16k).
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
    const h = []
    let hs = 0
    for (let j = -30; j <= 30; j++) {
      const t = j / 30
      const win = i0(5 * Math.sqrt(Math.max(0, 1 - t * t))) / i0(5)
      const v = (j === 0 ? 1 / 3 : Math.sin(Math.PI * j / 3) / (Math.PI * j)) * win
      h.push(v)
      hs += v
    }
    this.fir = Float64Array.from(h.map(x => x / hs))
    this.ring48 = Array.from({ length: 7 }, () => new Float32Array(128))
    this.ring16 = Array.from({ length: 7 }, () => new Float32Array(1024))
    this.samples48 = 0
    this.samples16 = 0
    this.frames = []
    this.didMask = 0
    this.capacity = 4096
    this.accMask = new Float64Array(this.capacity)
    this.norm = new Float64Array(this.capacity)
    this.raw16 = new Float32Array(this.capacity)
    this.finalized = 0
    this.sent = 0
    this.finalFrameCount = 0
    this.final = false
  }

  _fft(inverse = false) {
    const re = this.fftR
    const im = this.fftI
    const bit = this.bitrev
    for (let i = 0; i < 512; i++) {
      const j = bit[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= 512; size *= 2) {
      const half = size / 2
      const ang = (inverse ? 2 : -2) * Math.PI / size
      const ur = Math.cos(ang)
      const ui = Math.sin(ang)
      for (let offset = 0; offset < 512; offset += size) {
        let wr = 1
        let wi = 0
        for (let j = 0; j < half; j++) {
          const u = offset + j
          const v = u + half
          const vr = re[v] * wr - im[v] * wi
          const vi = re[v] * wi + im[v] * wr
          const tr = re[u]
          const ti = im[u]
          re[u] = tr + vr
          im[u] = ti + vi
          re[v] = tr - vr
          im[v] = ti - vi
          const nr = wr * ur - wi * ui
          wi = wr * ui + wi * ur
          wr = nr
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < 512; i++) {
        re[i] /= 512
        im[i] /= 512
      }
    }
  }

  /** Block of 7 or 8 Float32Array channels (48 kHz). */
  push(block: Float32Array[]) {
    if (this.final)
      throw new Error('引擎已結束')
    if (block.length < 7)
      throw new Error('需至少 7 聲道')
    const n = block[0].length
    for (const channel of block.slice(0, 7)) {
      for (const value of channel) {
        if (!Number.isFinite(value))
          throw new Error('Non-finite microphone sample')
      }
    }
    for (let ch = 1; ch < 7; ch++) {
      if (block[ch].length !== n)
        throw new Error('聲道取樣數不一致')
    }
    for (let j = 0; j < n; j++) {
      const idx = this.samples48
      for (let ch = 0; ch < 7; ch++)
        this.ring48[ch][idx % 128] = block[ch][j]
      this.samples48++
      const center = idx - 30
      if (center >= 0 && center % 3 === 0) {
        const down = this.downScratch
        for (let ch = 0; ch < 7; ch++) {
          let sum = 0
          const ring = this.ring48[ch]
          for (let offset = -30; offset <= 30; offset++) {
            const p = center + offset
            if (p >= 0)
              sum += this.fir[offset + 30] * ring[p % 128]
          }
          down[ch] = sum
        }
        this._one16(down)
      }
    }
  }

  _one16(vals: Float64Array) {
    const pos = this.samples16
    for (let ch = 0; ch < 7; ch++)
      this.ring16[ch][pos % 1024] = vals[ch]
    this.raw16[pos % this.capacity] = vals[5]
    this.samples16++
    if (pos >= 255 && (pos - 255) % 256 === 0) {
      const center = pos - 255
      this._computeFrame(center)
    }
  }

  _computeFrame(center: number) {
    const spectraR = this.spectraRScratch
    const spectraI = this.spectraIScratch
    for (let ch = 0; ch < 7; ch++) {
      for (let j = 0; j < 512; j++) {
        const p = center - 256 + j
        this.fftR[j] = p < 0 ? 0 : this.ring16[ch][p % 1024] * this.window[j]
        this.fftI[j] = 0
      }
      this._fft()
      for (let f = 0; f < 257; f++) {
        spectraR[ch][f] = this.fftR[f] / 256
        spectraI[ch][f] = this.fftI[f] / 256
      }
    }
    const mf = new Float64Array(257)
    const dif = new Float64Array(257)
    const frontR = new Float64Array(257)
    const frontI = new Float64Array(257)
    for (let f = 0; f < 257; f++) {
      const normRe = this.normReScratch
      const normIm = this.normImScratch
      for (let ch = 0; ch < 7; ch++) {
        const r = spectraR[ch][f]
        const i = spectraI[ch][f]
        const mag = Math.hypot(r, i)
        normRe[ch] = r / (mag + 1e-12)
        normIm[ch] = i / (mag + 1e-12)
      }
      let bestF = -100
      let bestO = -100
      for (let a = 0; a < 12; a++) {
        let sr = 0
        let si = 0
        let sq = 0
        let bfr = 0
        let bfi = 0
        for (let ch = 0; ch < 7; ch++) {
          const p = (a * 7 + ch) * 257 + f
          const pr = this.phaseR[p]
          const pi = this.phaseI[p]
          const re = normRe[ch] * pr - normIm[ch] * pi
          const im = normRe[ch] * pi + normIm[ch] * pr
          sr += re
          si += im
          sq += normRe[ch] * normRe[ch] + normIm[ch] * normIm[ch]
          if (a === 2) {
            bfr += spectraR[ch][f] * pr - spectraI[ch][f] * pi
            bfi += spectraR[ch][f] * pi + spectraI[ch][f] * pr
          }
        }
        if (a === 2) {
          frontR[f] = bfr / 7
          frontI[f] = bfi / 7
        }
        const coh = (sr * sr + si * si - sq) / 42
        if (a < 5) {
          if (coh > bestF)
            bestF = coh
        }
        else if (coh > bestO) {
          bestO = coh
        }
      }
      dif[f] = bestF - bestO
      mf[f] = Math.max(0, Math.min(1, (dif[f] + 0.03) / 0.55))
    }
    // Gaussian on frequency axis, with scipy.ndimage reflect boundary.
    const fm = new Float64Array(257)
    for (let f = 0; f < 257; f++) {
      let s = 0
      for (let o = -6; o <= 6; o++)
        s += mf[this._reflect(f + o, 257)] * this.gf[o + 6]
      fm[f] = s
    }
    this.frames[this.frameCount++ % 32] = { fm, frontR, frontI }
    this._pipeline(false)
  }

  _reflect(i: number, n: number) {
    while (i < 0 || i >= n) {
      if (i < 0)
        i = -i - 1
      else
        i = 2 * n - 1 - i
    }
    return i
  }

  _pipeline(atEnd: boolean) {
    const n = this.frameCount
    // Only Mask's four-frame Gaussian lookahead remains. No hard/Gate decisions.
    while (this.didMask < n) {
      if (!atEnd && this.didMask + 4 >= n)
        break
      const k = this.didMask++
      const smooth = new Float64Array(257)
      for (let f = 0; f < 257; f++) {
        let val = 0
        for (let off = -4; off <= 4; off++) {
          const ix = this._reflect(k + off, n)
          val += this.gt[off + 4] * this.frames[ix % 32].fm[f]
        }
        smooth[f] = val
      }
      this._synthFrame(k, this.frames[k % 32], smooth)
    }
    if (atEnd)
      this._emitReady(this.samples16)
  }

  _synthFrame(k: number, frame: MaskFrame, mask: Float64Array) {
    const { frontR, frontI } = frame
    for (let f = 0; f < 257; f++) {
      this.fftR[f] = frontR[f] * mask[f]
      this.fftI[f] = frontI[f] * mask[f]
    }
    for (let f = 257; f < 512; f++) {
      this.fftR[f] = this.fftR[512 - f]
      this.fftI[f] = -this.fftI[512 - f]
    }
    this._fft(true)
    const start = k * 256 - 256
    for (let j = 0; j < 512; j++) {
      let ix = start + j
      if (ix < 0)
        continue
      ix %= this.capacity
      const hann = this.window[j]
      const v = this.fftR[j] * 256 * hann
      this.accMask[ix] += v
      this.norm[ix] += hann * hann
    }
    this.finalFrameCount++
    this._emitReady(Math.min(this.samples16, k * 256))
  }

  _emitReady(end: number) {
    end = Math.max(this.finalized, Math.min(end, this.samples16))
    this.finalized = end
    // Run short chunks during the recording; avoid accumulating all output until stop.
    while ((this.finalized - this.sent >= 512 || (this.final && this.sent < this.finalized))) {
      const n = Math.min(512, this.finalized - this.sent)
      const raw = new Float32Array(n)
      const mask = new Float32Array(n)
      for (let j = 0; j < n; j++) {
        const ix = (this.sent + j) % this.capacity
        const inv = this.norm[ix] > 1e-12 ? 1 / this.norm[ix] : 0
        raw[j] = this.raw16[ix]
        mask[j] = this.accMask[ix] * inv
        this.accMask[ix] = 0
        this.norm[ix] = 0
      }
      this.sent += n
      this.onOutput({ raw, mask, offsetFrames: this.sent - n })
    }
  }

  finish() {
    if (this.final)
      return
    this.final = true
    const true48 = this.samples48
    this.originalInputFrames = true48
    this.outputLength = Math.ceil(true48 / 3)
    // Pad the 48 kHz decimator to include all valid 16 kHz output centers.
    const final16 = Math.ceil(true48 / 3)
    for (let p = 0; this.samples16 < final16 && p < 64; p++) {
      const idx = this.samples48
      for (let ch = 0; ch < 7; ch++)
        this.ring48[ch][idx % 128] = 0
      this.samples48++
      const center = idx - 30
      if (center >= 0 && center % 3 === 0) {
        const down = this.downScratch
        for (let ch = 0; ch < 7; ch++) {
          let s = 0
          const ring = this.ring48[ch]
          for (let off = -30; off <= 30; off++) {
            const sample = center + off
            if (sample >= 0)
              s += this.fir[off + 30] * ring[sample % 128]
          }
          down[ch] = s
        }
        this._one16(down)
      }
    }
    // scipy stft boundary='zeros', padded=True: final center ceil(N/H)*H.
    const lastCenter = Math.ceil(final16 / 256) * 256
    let finalFrameCenter = (this.frameCount - 1) * 256
    while (finalFrameCenter < lastCenter) {
      const center = finalFrameCenter + 256
      for (let k = this.samples16; k <= center + 255; k++) {
        for (let ch = 0; ch < 7; ch++)
          this.ring16[ch][k % 1024] = 0
      }
      this._computeFrame(center)
      finalFrameCenter = center
    }
    this._pipeline(true)
  }

  /** Fixed storage limits; useful for long-running capture telemetry. */
  get statistics() {
    return { inputFrames: this.final ? this.originalInputFrames : this.samples48, outputFrames: this.sent, retainedFrames: this.frames.length, historyCapacity: 32, synthesisCapacity: this.capacity }
  }
}
