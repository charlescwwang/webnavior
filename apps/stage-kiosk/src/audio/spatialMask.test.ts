import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import provenance from './fixtures/spatialMask/provenance.json'

import { SpatialEngine } from './fixtures/spatialMask/reference.js'
import { SpatialMask } from './spatialMask'

function signal(frames: number, sources: {
  angle: number
  gain: number
  frequency: number
}[]) {
  const r = 0.045
  const h = r * Math.sqrt(3) / 2
  const positions = [[0, 0], [-r, 0], [-r / 2, h], [r / 2, h], [r, 0], [r / 2, -h], [-r / 2, -h]]
  return Array.from({ length: 8 }, (_, channel) => Float32Array.from({ length: frames }, (_, i) => {
    if (channel === 7)
      return 0
    let value = 0
    for (const source of sources) {
      const angle = source.angle * Math.PI / 180
      const delay = (positions[channel][0] * Math.sin(angle) - positions[channel][1] * Math.cos(angle)) / 343
      const time = i / 48000 + delay
      const envelope = 0.65 + 0.35 * Math.sin(2 * Math.PI * 3 * i / 48000)
      value += source.gain * envelope * (Math.sin(2 * Math.PI * source.frequency * time) + 0.2 * Math.sin(2 * Math.PI * source.frequency * 1.7 * time))
    }
    return value
  }))
}
function reference(raw: Float32Array[], chunk: number) {
  const engine = new SpatialEngine()
  for (let at = 0; at < raw[0].length; at += chunk)
    engine.push(raw.map(channel => channel.subarray(at, at + chunk)))
  engine.finish()
  return engine.result().mask
}
function process(raw: Float32Array[], chunk: number) {
  const parts: Float32Array[] = []
  let count = 0
  const engine = new SpatialMask(({ mask, offsetFrames }) => {
    expect(offsetFrames).toBe(count)
    count += mask.length
    parts.push(mask)
  })
  for (let at = 0; at < raw[0].length; at += chunk)
    engine.push(raw.map(channel => channel.subarray(at, at + chunk)))
  engine.finish()
  const result = new Float32Array(count)
  let at = 0
  for (const part of parts) {
    result.set(part, at)
    at += part.length
  }
  return { engine, result }
}
function error(a: Float32Array, b: Float32Array) {
  expect(a.length).toBe(b.length)
  let maximum = 0
  for (let i = 0; i < a.length; i++) {
    expect(Number.isFinite(a[i])).toBe(true)
    maximum = Math.max(maximum, Math.abs(a[i] - b[i]))
  }
  return maximum
}
describe('spatial mask synthetic acceptance, without Gate', () => {
  it('retains the original numerical oracle byte-for-byte', () => {
    const original = readFileSync(new URL('./fixtures/spatialMask/reference.js', import.meta.url))
    expect(createHash('sha256').update(original).digest('hex')).toBe(provenance.sha256)
  })
  // Source: user-supplied UMA8_Kiosk_STT_Integration_Kit_v1_redownload.zip, 2026-11-04.
  it.each([
    { name: 'front', sources: [{ angle: 0, gain: 0.1, frequency: 1300 }] },
    { name: 'left', sources: [{ angle: -90, gain: 0.1, frequency: 1100 }] },
    { name: 'right', sources: [{ angle: 90, gain: 0.1, frequency: 1700 }] },
    { name: 'overlap', sources: [{ angle: 0, gain: 0.05, frequency: 1300 }, { angle: 90, gain: 0.1, frequency: 1700 }] },
    { name: 'silence', sources: [] },
  ])('preserves the reference Mask samples for $name across smaller and irregular transport batches', ({ sources }) => {
    const raw = signal(48731, sources)
    const expected = reference(raw, 16384)
    expect(error(reference(raw, 2048), expected)).toBeLessThanOrEqual(1e-7)
    for (const chunk of [127, 2048, 4096]) {
      const current = process(raw, chunk)
      expect(current.result.length).toBe(Math.ceil(raw[0].length / 3))
      expect(error(current.result, expected)).toBeLessThanOrEqual(1e-7)
    }
  })
  it.each([0, 1, 29, 127, 511, 777, 16001])('flushes exactly the reference first and last samples for %i raw frames', (frames) => {
    const raw = signal(frames, [{ angle: 0, gain: 0.1, frequency: 1300 }])
    if (frames) {
      raw[0][0] += 0.1
      raw[5][frames - 1] += 0.1
    }
    const expected = reference(raw, 2048)
    const current = process(raw, 127)
    expect(error(current.result, expected)).toBeLessThanOrEqual(1e-7)
    const count = current.engine.statistics.outputFrames
    current.engine.finish()
    expect(current.engine.statistics.outputFrames).toBe(count)
  })
  it('rejects invalid geometry, mismatched channels and non-finite audio', () => {
    expect(() => new SpatialMask(() => {
    }, Number.NaN)).toThrow()
    const engine = new SpatialMask(() => {
    })
    expect(() => engine.push([new Float32Array(128)])).toThrow()
    const raw = signal(512, [])
    raw[0][0] = Number.NaN
    expect(() => engine.push(raw)).toThrow('Non-finite')
    raw[0][0] = 0
    raw[1] = new Float32Array(1)
    expect(() => engine.push(raw)).toThrow()
  })
  it('does not wait for the reference Gate history before emitting Mask PCM', () => {
    let first = 0
    let received = 0
    const engine = new SpatialMask(() => {
      first ||= received
    })
    const block = signal(2048, [{ angle: 0, gain: 0.1, frequency: 1300 }])
    for (let i = 0; i < 8; i++) {
      received += 2048
      engine.push(block)
    }
    expect(first).toBeGreaterThan(0)
    expect(first / 48000).toBeLessThan(0.2)
  })
})
