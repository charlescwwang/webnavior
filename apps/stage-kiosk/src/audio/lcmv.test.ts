import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { ArrayBeamformer, designWeights } from './lcmv'

function fixture(name: string) {
  const bytes = readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}
it('matches the supplied Python weights and streaming output across irregular browser blocks', () => {
  const expectedWeights = new Float64Array(fixture('weights.f64'))
  const weights = designWeights()
  expect(Math.max(...weights.map((value, i) => Math.abs(value - expectedWeights[i]!)))).toBeLessThan(1e-10)
  const input = new Float32Array(fixture('input.f32'))
  const expected = new Float32Array(fixture('output.f32'))
  const actual = new Float32Array(expected.length)
  const processor = new ArrayBeamformer(weights, [0, 1, 2, 3, 4, 5, 6])
  for (let position = 0; position < actual.length;) {
    const length = Math.min(127 + position % 131, actual.length - position)
    const channels = Array.from({ length: 8 }, (_, ch) => Float32Array.from({ length }, (_, i) => input[(position + i) * 8 + ch]!))
    processor.process(channels, actual.subarray(position, position + length))
    position += length
  }
  expect(Math.max(...actual.map((value, i) => Math.abs(value - expected[i]!)))).toBeLessThan(1e-6)
})
it('keeps silence finite and rejects incomplete channel maps', () => {
  const beam = new ArrayBeamformer(designWeights(), [0, 1, 2, 3, 4, 5, 6])
  const out = new Float32Array(4096)
  beam.process(Array.from({ length: 8 }, () => new Float32Array(4096)), out)
  expect([...out].every(value => value === 0)).toBe(true)
  expect(() => new ArrayBeamformer(designWeights(), [0, 0, 1, 2, 3, 4, 5])).toThrow()
  expect(() => beam.process([new Float32Array(128)], new Float32Array(128))).toThrow()
})

it('preserves front steering and suppresses both side directions at 1500Hz', () => {
  const weights = designWeights()
  const r = 0.044
  const h = Math.sqrt(3) / 2
  const positions = [[0, 0], [-r, 0], [-r / 2, -r * h], [r / 2, -r * h], [r, 0], [r / 2, r * h], [-r / 2, r * h]]
  const response = (angle: number) => {
    let re = 0
    let im = 0
    for (let ch = 0; ch < 7; ch++) {
      const [x, y] = positions[ch]!
      const phase = 2 * Math.PI * 1500 * (x! * Math.sin(angle) + y! * Math.cos(angle)) / 343
      const index = (32 * 7 + ch) * 2
      re += weights[index]! * Math.cos(phase) + weights[index + 1]! * Math.sin(phase)
      im += weights[index]! * Math.sin(phase) - weights[index + 1]! * Math.cos(phase)
    }
    return Math.hypot(re, im)
  }
  expect(response(0)).toBeCloseTo(1, 10)
  expect(response(Math.PI / 2)).toBeLessThan(0.5)
  expect(response(-Math.PI / 2)).toBeLessThan(0.5)
  const channels = Array.from({ length: 8 }, () => new Float32Array(128))
  channels[0]![1] = Number.NaN
  expect(() => new ArrayBeamformer(weights, [0, 1, 2, 3, 4, 5, 6]).process(channels, new Float32Array(128))).toThrow('Non-finite')
})
