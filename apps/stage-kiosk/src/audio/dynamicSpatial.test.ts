import { expect, it } from 'vitest'

import { SpatialEngine } from './fixtures/dynamicSpatial/reference.js'
import { SpatialMask } from './spatialMask'

function signal(frames: number, angle = 0, onset = 0, frequency = 1300) {
  const r = 0.045
  const h = r * Math.sqrt(3) / 2
  const positions = [[0, 0], [-r, 0], [-r / 2, h], [r / 2, h], [r, 0], [r / 2, -h], [-r / 2, -h]]
  return positions.map(([x, y]) => Float32Array.from({ length: frames }, (_, i) => {
    const time = i / 48000 + (x * Math.sin(angle * Math.PI / 180) - y * Math.cos(angle * Math.PI / 180)) / 343
    return i < onset ? 0 : 0.03 * (Math.sin(2 * Math.PI * frequency * time) + 0.2 * Math.sin(2 * Math.PI * frequency * 1.7 * time))
  }))
}
function run(raw: Float32Array[], events: { at: number, playing: boolean }[] = [], chunk = 2048) {
  const result = new Float32Array(Math.ceil(raw[0].length / 3))
  const reference = new Float32Array(result.length)
  let emitted = 0
  let firstAt = 0
  let fed = 0
  const engine = new SpatialMask(({ mask, raw, offsetFrames }) => {
    expect(offsetFrames).toBe(emitted)
    expect(mask.length).toBeLessThanOrEqual(512)
    result.set(mask, offsetFrames)
    reference.set(raw, offsetFrames)
    emitted += mask.length
    firstAt ||= fed
  }, 45, 'dynamic')
  for (let at = 0; at < raw[0].length;) {
    for (const event of events.filter(event => event.at === at))
      engine.setPlayback(event.playing, at)
    const nextEvent = events.find(event => event.at > at)?.at ?? raw[0].length
    const end = Math.min(at + chunk, nextEvent, raw[0].length)
    fed = end
    engine.push(raw.map(channel => channel.subarray(at, end)))
    at = end
  }
  engine.finish()
  expect(emitted).toBe(result.length)
  return { result, reference, firstAt, engine }
}
function rms(samples: Float32Array, start = 1600, end = samples.length - 1600) {
  return Math.sqrt(samples.subarray(start, end).reduce((sum, x) => sum + x * x, 0) / (end - start))
}
// Report: this chat, 2026-11-07 — live TTS switching must preserve the single
// VAD stream and onset without importing the v4 page's extra synthesis wait.
it('retains front Raw Gate audio and suppresses a side-only directional control', () => {
  const front = run(signal(48000))
  const side = run(signal(48000, 90))
  expect(rms(front.result) / rms(front.reference)).toBeGreaterThan(0.98)
  expect(rms(side.result) / rms(side.reference)).toBeLessThan(0.05)
})
// Report: this chat, 2026-11-09 — normal-volume UMA-8 speech is missed;
// reported input peaks range from about -44 to -59dBFS. These directional
// controls isolate DSP level sensitivity; they do not establish Silero/ASR
// acceptance or preservation of speech mixed with a stronger loudspeaker.
it.each([-44, -58, -67])('preserves front directional controls at %i dBFS peak in Gate and Binary', (peakDbfs) => {
  const original = signal(48000)
  const peak = original[0].reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0)
  const scale = 10 ** (peakDbfs / 20) / peak
  const quiet = original.map(channel => Float32Array.from(channel, sample => sample * scale))
  for (const events of [[], [{ at: 0, playing: true }]]) {
    const normal = run(original, events)
    const current = run(quiet, events)
    const retention = rms(current.result) / rms(current.reference)
    expect(retention).toBeGreaterThan(0.1)
    expect(retention).toBeCloseTo(rms(normal.result) / rms(normal.reference), 3)
    expect(current.result.every(Number.isFinite)).toBe(true)
  }
})
// Report: this chat, 2026-11-09 — distant normal-volume speech is missed.
// The v4 Gate averages directional evidence over time; requiring three raw
// frame decisions can instead mute a continuing front source indefinitely.
// This is a directional interference control, not proof of real speech/AEC.
it.each([0.25, 0.5])('retains continuing front Gate audio with intermittent side interference at duty %s', (duty) => {
  const period = 0.064
  const front = signal(96000, 0, 24000)
  const side = signal(96000, 90)
  const interference = side.map(channel => Float32Array.from(channel, (value, i) => i / 48000 % period < period * duty ? value / 30 : 0))
  const combined = front.map((channel, ch) => Float32Array.from(channel, (value, i) => value / 30 + interference[ch][i]))
  const original = new SpatialEngine()
  original.push(combined)
  original.finish()
  const expected = rms(original.result().gate, 8000, 16000)
  expect(expected).toBeGreaterThan(0.0001)
  const current = run(combined)
  expect(rms(current.result, 8000, 16000) / expected).toBeGreaterThan(0.7)
  const sideOnly = run(interference)
  expect(rms(sideOnly.result) / rms(sideOnly.reference)).toBeLessThan(0.05)
})
it('keeps the existing scheduling bound and retains a normal-level front onset', () => {
  const start = 24000
  const current = run(signal(48000, 0, start))
  expect(current.firstAt / 48000).toBeLessThan(0.15)
  expect(rms(current.result, start / 3, start / 3 + 2560) / rms(current.reference, start / 3, start / 3 + 2560)).toBeGreaterThan(0.9)
})
it('switches on source sample boundaries independently of transport chunk size', () => {
  const raw = signal(96000)
  const events = [{ at: 12001, playing: true }, { at: 48002, playing: false }, { at: 50003, playing: true }, { at: 66001, playing: false }]
  expect(run(raw, events, 127).result).toEqual(run(raw, events, 2048).result)
})
it('holds Binary Mask through a bounded post-TTS echo tail without resetting samples', () => {
  const { engine } = run(signal(96000), [{ at: 0, playing: true }, { at: 48000, playing: false }])
  expect(engine.statistics.processingMode).toBe('gate')
  expect(engine.statistics.playbackTransitions).toBe(2)
  expect(engine.statistics.retainedFrames).toBeLessThanOrEqual(32)
})
it.each([0, 1, 29, 511, 777, 16001])('drains %i source frames without padding or skipping speech', (frames) => {
  const { result } = run(signal(frames), [], 127)
  expect(result.every(Number.isFinite)).toBe(true)
})
it('rejects stale playback offsets instead of changing already processed audio', () => {
  const engine = new SpatialMask(() => {}, 45, 'dynamic')
  engine.push(signal(2048))
  expect(() => engine.setPlayback(true, 0)).toThrow('clock')
})

it.each([0, 90, -90])('matches the supplied v4 Binary samples at angle %i without its additional buffering', (angle) => {
  const raw = signal(48731, angle)
  const reference = new SpatialEngine()
  reference.push(raw)
  reference.finish()
  const expected = reference.result().mask
  const { result } = run(raw, [{ at: 0, playing: true }])
  let maximum = 0
  for (let i = 0; i < result.length; i++)
    maximum = Math.max(maximum, Math.abs(result[i] - expected[i]))
  expect(maximum).toBeLessThan(1e-7)
})
// A spatial mask cannot separate two coherent sources occupying the same bins.
// Keep this blocked control visible rather than treating offline v4 success as
// universal speech preservation. It must not be weakened to enable rollout.
it.fails('blocked (BLOCKED): preserves a weaker front source fully overlapping a coherent stronger side spectrum', () => {
  const front = signal(48000)
  const side = signal(48000, 90)
  const combined = front.map((channel, ch) => Float32Array.from(channel, (value, i) => value + side[ch][i] * 2))
  const { result } = run(combined, [{ at: 0, playing: true }])
  // Directional tones are a deterministic arithmetic control, not TTS, speech
  // recognition or proof that normal-volume hardware barge-in is accepted.
  expect(rms(result)).toBeGreaterThan(0.001)
  expect(result.every(Number.isFinite)).toBe(true)
})

it('retains a front source with spectrally distinct stronger side interference in Binary mode', () => {
  const front = signal(48000)
  const side = signal(48000, 90, 0, 1800)
  const combined = front.map((channel, ch) => Float32Array.from(channel, (value, i) => value + side[ch][i] * 2))
  const { result } = run(combined, [{ at: 0, playing: true }])
  expect(rms(result)).toBeGreaterThan(0.008)
})

it('keeps TTS and its tail identical to Binary, even inside partial capture blocks', () => {
  const raw = signal(96000)
  const always = run(raw, [{ at: 0, playing: true }]).result
  const switched = run(raw, [{ at: 12001, playing: true }, { at: 48002, playing: false }]).result
  const start = Math.ceil(12001 / 3)
  const tailEnd = Math.ceil(48002 / 3) + 5120
  expect(switched.subarray(start, tailEnd)).toEqual(always.subarray(start, tailEnd))
  const gate = run(raw).result
  expect(switched.subarray(tailEnd + 512)).toEqual(gate.subarray(tailEnd + 512))
})
it('does not accumulate unused TTS events when the dynamic feature is off', () => {
  const engine = new SpatialMask(() => {})
  for (let i = 0; i < 100; i++)
    engine.setPlayback(i % 2 === 0, 0)
  engine.push(signal(48000))
  engine.finish()
  expect(engine.statistics.processingMode).toBe('soft')
  expect(engine.statistics.playbackTransitions).toBe(0)
})
it('confirms the fully overlapping stronger-side limitation also exists in the supplied v4 Binary oracle', () => {
  const front = signal(48000)
  const side = signal(48000, 90)
  const combined = front.map((channel, ch) => Float32Array.from(channel, (value, i) => value + side[ch][i] * 2))
  const original = new SpatialEngine()
  original.push(combined)
  original.finish()
  expect(rms(original.result().mask)).toBeLessThan(1e-8)
})
