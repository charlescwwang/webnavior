import { env } from 'node:process'

import { expect, it } from 'vitest'

import { SpatialMask } from './spatialMask'

// Opt-in accelerated audio-duration test. This does not claim 30 wall-clock minutes in Firefox.
it.runIf(env.MASK_STRESS_SECONDS)('keeps complete PCM and bounded history beyond the old 60-second cap', () => {
  const seconds = Number(env.MASK_STRESS_SECONDS)
  expect(seconds).toBeGreaterThanOrEqual(120)
  const target = seconds * 48000
  const block = Array.from({ length: 8 }, (_, ch) => Float32Array.from({ length: 4096 }, (_, i) => ch === 7 ? 0 : 0.03 * Math.sin(i * 0.17 + ch * 0.01)))
  let output = 0
  let invalid = 0
  const started = performance.now()
  let maxBatchMs = 0
  const engine = new SpatialMask(({ mask, offsetFrames }) => {
    if (offsetFrames !== output)
      throw new Error('Missing or repeated PCM')
    output += mask.length
    for (const sample of mask) {
      if (!Number.isFinite(sample))
        invalid++
    }
  })
  for (let frame = 0; frame < target;) {
    const length = Math.min(4096, target - frame)
    const begin = performance.now()
    engine.push(block.map(channel => channel.subarray(0, length)))
    maxBatchMs = Math.max(maxBatchMs, performance.now() - begin)
    frame += length
    if (frame % (4096 * 750) === 0)
      expect(engine.statistics.retainedFrames).toBeLessThanOrEqual(32)
  }
  engine.finish()
  expect(output).toBe(seconds * 16000)
  expect(invalid).toBe(0)
  expect(engine.statistics.retainedFrames).toBeLessThanOrEqual(32)
  console.info(JSON.stringify({ syntheticAudioSeconds: seconds, wallSeconds: (performance.now() - started) / 1000, outputSamples: output, maxBatchMs, statistics: engine.statistics }))
}, 360000)
