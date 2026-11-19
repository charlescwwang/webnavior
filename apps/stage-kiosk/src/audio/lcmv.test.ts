import { expect, it } from 'vitest'

import { InputGain } from './inputGain'
import { fftSize } from './lcmv'
import { LcmvStream } from './lcmvStream'
import { designTunedWeights } from './lcmvWeights'
import { defaultLcmv, validateLcmv } from './tuning'

const map = [0, 1, 2, 3, 4, 5, 6]
const join = (parts: Float32Array[]) => Float32Array.from(parts.flatMap(part => Array.from(part)))

it('calculates real weights for three 70 degree elevations and rejects coincident directions', () => {
  const weights = designTunedWeights()
  expect(weights.length).toBe((fftSize / 2 + 1) * 14)
  expect(weights.every(Number.isFinite)).toBe(true)
  const horizontal = designTunedWeights(44, 48000, { ...defaultLcmv, frontElevationDeg: 0, suppress1ElevationDeg: 0, suppress2ElevationDeg: 0 })
  expect(weights.some((value, index) => Math.abs(value - horizontal[index]!) > 0.01)).toBe(true)
  expect(() => validateLcmv({ ...defaultLcmv, suppress1Deg: 0 })).toThrow('不同')
})

it('keeps mapped channel 6 and LCMV sample clocks identical across irregular chunks and delay compensation', () => {
  const channels = Array.from({ length: 8 }, (_, ch) => Float32Array.from({ length: 10001 }, (_, i) => Math.sin(i * (ch + 1) * 0.03) * 0.01))
  function run(chunk: number) {
    const raw: Float32Array[] = []
    const processed: Float32Array[] = []
    let offset = 0
    const engine = new LcmvStream((packet) => {
      expect(packet.offsetFrames).toBe(offset)
      expect(packet.mask.length).toBe(packet.raw.length)
      offset += packet.raw.length
      raw.push(packet.raw)
      processed.push(packet.mask)
    }, 44, map)
    for (let i = 0; i < channels[0]!.length; i += chunk)
      engine.push(channels.map(channel => channel.subarray(i, i + chunk)))
    engine.finish()
    expect(offset).toBe(Math.ceil(10001 / 3))
    return { raw: join(raw), processed: join(processed) }
  }
  const a = run(127)
  const b = run(2048)
  expect(a.raw).toEqual(b.raw)
  expect(a.processed).toEqual(b.processed)
  expect(a.raw.every(Number.isFinite)).toBe(true)
  expect(a.processed.some(sample => Math.abs(sample) > 0.00001)).toBe(true)
})

it('gains and limits only the VAD branch without altering reference samples or sample count', () => {
  const raw = new Float32Array([0.01, 0.3, -0.4, 0.9])
  const before = raw.slice()
  const gain = new InputGain()
  const result = gain.process(raw, 15)
  expect(raw).toEqual(before)
  expect(result.samples.length).toBe(raw.length)
  expect(result.samples[0]).toBeGreaterThan(raw[0]!)
  expect(result.samples.every(sample => Math.abs(sample) <= 0.980001)).toBe(true)
})
