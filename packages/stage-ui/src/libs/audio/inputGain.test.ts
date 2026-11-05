import { expect, it } from 'vitest'

import { InputGain, measurePcmLevel } from './inputGain'

// Report: this chat, 2026-11-05 — +65dB after Mask, once before VAD/STT, with limiting.
it('boosts quiet PCM by65dB without changing the original or sample boundaries', () => {
  const input = Float32Array.of(0.0001, 0, -0.0001, 1e-9)
  const result = new InputGain().process(input, 65)
  expect(result.samples.length).toBe(input.length)
  expect(result.samples[0]).toBeCloseTo(0.17782794, 6)
  expect(result.samples[1]).toBe(0)
  expect(result.samples[2]).toBeCloseTo(-0.17782794, 6)
  expect(result.samples[3]).toBeGreaterThan(0)
  expect(result.clippedSamples).toBe(0)
  expect(input[0]).toBeCloseTo(0.0001, 8)
})

it('limits the first transient and holds attenuation across blocks before gradual recovery', () => {
  const gain = new InputGain()
  const first = gain.process(Float32Array.of(0.01, -0.01), 65)
  expect(first.samples[0]).toBeCloseTo(0.98, 6)
  expect(first.samples[1]).toBeCloseTo(-0.98, 6)
  expect(first.clippedSamples).toBe(2)
  const quiet = gain.process(new Float32Array(1600).fill(0.0001), 65)
  expect(quiet.samples[0]).toBeLessThan(0.02)
  expect(quiet.samples[1599]).toBeGreaterThan(quiet.samples[0])
  expect(quiet.samples[1599]).toBeLessThan(0.177828)
  gain.reset()
  expect(gain.process(Float32Array.of(0.0001), 65).samples[0]).toBeCloseTo(0.17782794, 6)
})

it('leaves ordinary microphone PCM untouched at0dB after a limited array input', () => {
  const gain = new InputGain()
  gain.process(Float32Array.of(0.1), 65)
  const input = Float32Array.of(0.1, -0.3, 0)
  const result = gain.process(input, 0)
  expect(result.samples).toBe(input)
  expect(result.clippedSamples).toBe(0)
  expect(gain.process(Float32Array.of(0.0001), 65).samples[0]).toBeCloseTo(0.17782794, 6)
})

it('produces identical bounded audio across different streaming block boundaries', () => {
  const input = Float32Array.from({ length: 16333 }, (_, i) => Math.sin(i * 0.12) * (i < 300 ? 0.01 : 0.0001))
  const whole = new InputGain().process(input, 65)
  const streaming = new InputGain()
  const split = new Float32Array(input.length)
  let limited = 0
  for (let offset = 0; offset < input.length; offset += 512) {
    const result = streaming.process(input.subarray(offset, offset + 512), 65)
    split.set(result.samples, offset)
    limited += result.clippedSamples
  }
  expect(split).toEqual(whole.samples)
  expect(limited).toBe(whole.clippedSamples)
  expect(split.every(value => Number.isFinite(value) && Math.abs(value) <= 0.980001)).toBe(true)
})

it('rejects corrupt input without poisoning subsequent valid audio', () => {
  const gain = new InputGain()
  expect(() => gain.process(Float32Array.of(Number.NaN), 65)).toThrow('finite')
  expect(() => gain.process(Float32Array.of(1), Number.NaN)).toThrow('between')
  expect(() => gain.process(Float32Array.of(1), -1)).toThrow('between')
  expect(() => gain.process(Float32Array.of(1), 71)).toThrow('between')
  expect(gain.process(Float32Array.of(0.0001), 65).samples[0]).toBeCloseTo(0.17782794, 6)
})

// Report: this chat,2026-11-05 — audible comparison audio did not trigger live ASR.
it('measures digital RMS independently of audition volume and recognition gain', () => {
  const raw = new Float32Array(512).fill(0.0001)
  const before = measurePcmLevel(raw)
  const after = measurePcmLevel(new InputGain().process(raw, 65).samples)
  expect(before.rmsDbfs).toBeCloseTo(-80, 4)
  expect(before.peakDbfs).toBeCloseTo(-80, 4)
  expect(after.rmsDbfs).toBeCloseTo(-15, 4)
  expect(after.peakDbfs).toBeCloseTo(-15, 4)
  expect(raw[0]).toBeCloseTo(0.0001, 8)
})

it('distinguishes digital silence from a very quiet nonzero signal', () => {
  expect(measurePcmLevel(new Float32Array(512)).rmsDbfs).toBeNull()
  expect(measurePcmLevel(new Float32Array()).peakDbfs).toBeNull()
  expect(measurePcmLevel(Float32Array.of(1e-9)).rmsDbfs).toBeCloseTo(-180, 4)
  expect(measurePcmLevel(Float32Array.of(1, -1)).rmsDbfs).toBe(0)
})
