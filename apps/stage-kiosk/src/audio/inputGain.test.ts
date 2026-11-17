import { expect, it } from 'vitest'

import { InputGain } from './inputGain'

it('accepts 80 dB gain, preserves samples and limits amplified peaks', () => {
  const gain = new InputGain()
  const result = gain.process(Float32Array.of(0.000001, 0.1, -0.1), 80)
  expect(result.samples.length).toBe(3)
  expect(result.samples[0]).toBeCloseTo(0.01, 6)
  expect(result.samples[1]).toBeCloseTo(0.98, 6)
  expect(result.samples[2]).toBeCloseTo(-0.98, 6)
  expect(result.clippedSamples).toBe(2)
  expect(() => gain.process(Float32Array.of(0.1), 81)).toThrow('0 and 80 dB')
})
