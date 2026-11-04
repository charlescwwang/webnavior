import type { AudioComparison } from './kioskAudio'

import { safeParse } from 'valibot'
import { expect, it } from 'vitest'

import { audioComparisonSchema, audioWarningSchema, encodeComparisonRecording, sameComparisonCapture, validateComparisonRecording } from './kioskAudio'

const facts = { comparisonId: 'capture', sampleRate: 48000, frameCount: 128, sampleStart: 32, algorithm: 'lcmv-v1', radiusMm: 44, loading: 0.03, channelMap: [0, 1, 2, 3, 4, 5, 6], delayFrames: 1024 } as const
it.each(['raw', 'reference', 'processed'] as const)('preserves frame count, format and channels for %s WAV', async (role) => {
  const info: AudioComparison = { ...facts, channelMap: [...facts.channelMap], role, channels: role === 'raw' ? 8 : 1 }
  const samples = new Float32Array(info.frameCount * info.channels).fill(0.125)
  const data = new Uint8Array(await encodeComparisonRecording(samples, info).arrayBuffer())
  expect(safeParse(audioComparisonSchema, info).success).toBe(true)
  expect(validateComparisonRecording(data, info)).toBe(true)
  expect(validateComparisonRecording(data.subarray(0, data.length - 1), info)).toBe(false)
  expect(validateComparisonRecording(data, { ...info, sampleStart: 99 })).toBe(true)
  expect(validateComparisonRecording(data, { ...info, frameCount: info.frameCount + 1 })).toBe(false)
  expect(() => encodeComparisonRecording(new Float32Array([Number.NaN]), { ...info, frameCount: 1, channels: 1 })).toThrow()
})
it('requires distinct physical channels and refuses false multi-channel metadata', () => {
  const base = { ...facts, channelMap: [...facts.channelMap], role: 'raw', channels: 8 }
  expect(safeParse(audioComparisonSchema, base).success).toBe(true)
  expect(safeParse(audioComparisonSchema, { ...base, channels: 1 }).success).toBe(false)
  expect(safeParse(audioComparisonSchema, { ...base, channelMap: [0, 0, 1, 2, 3, 4, 5] }).success).toBe(false)
  expect(safeParse(audioComparisonSchema, { ...base, frameCount: 720001 }).success).toBe(false)
})
it('pairs roles by sample-clock facts independently of JSON key ordering', () => {
  const a: AudioComparison = { ...facts, channelMap: [...facts.channelMap], role: 'raw', channels: 8 }
  const b: AudioComparison = { channels: 1, role: 'processed', ...facts, channelMap: [...facts.channelMap] }
  expect(sameComparisonCapture(a, b)).toBe(true)
  expect(sameComparisonCapture(a, { ...b, sampleStart: 33 })).toBe(false)
  expect(sameComparisonCapture(a, { ...b, radiusMm: 45 })).toBe(false)
})

it('encodes local Mask PCM at16k without accepting it as the48k Admin contract', async () => {
  const info = { role: 'processed', sampleRate: 16000, channels: 1, frameCount: 123 } as const
  const blob = encodeComparisonRecording(new Float32Array(123).fill(0.5), info)
  const view = new DataView(await blob.arrayBuffer())
  expect(view.getUint32(24, true)).toBe(16000)
  expect(view.getUint32(40, true)).toBe(246)
  expect(view.getInt16(44, true)).toBe(16384)
  expect(safeParse(audioComparisonSchema, { ...facts, ...info, channelMap: [...facts.channelMap] }).success).toBe(false)
})

it('accepts bounded device warnings and rejects dialogue, invalid stages and channel counts', () => {
  const warning = { generation: 1, stage: 'mask_runtime', outcome: 'standard', channels: 8 }
  expect(safeParse(audioWarningSchema, warning).success).toBe(true)
  expect(safeParse(audioWarningSchema, { ...warning, outcome: 'unavailable' }).success).toBe(true)
  expect(safeParse(audioWarningSchema, { ...warning, transcript: 'customer words' }).success).toBe(false)
  expect(safeParse(audioWarningSchema, { ...warning, stage: 'unknown' }).success).toBe(false)
  expect(safeParse(audioWarningSchema, { ...warning, channels: 33 }).success).toBe(false)
  expect(safeParse(audioWarningSchema, { ...warning, generation: 0 }).success).toBe(false)
})
