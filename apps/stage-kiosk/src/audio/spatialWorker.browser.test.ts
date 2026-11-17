import { expect, it } from 'vitest'

import { createCaptureContext } from './captureProtocol'
import { SpatialMask } from './spatialMask'

it('preserves mapped source samples without fetching AEC3 when disabled', async () => {
  const worker = new Worker(new URL('./capture.worker.ts', import.meta.url), { type: 'module' })
  const transport = createCaptureContext(worker, 'client')
  const ready = Promise.withResolvers<void>()
  const map = [6, 2, 4, 0, 5, 1, 3]
  const actual: Float32Array[] = []
  let actualFrames = 0
  let processedFrames = 0
  const errors: string[] = []
  const expected: Float32Array[] = []
  const engine = new SpatialMask(packet => expected.push(packet.mask), 44)
  const count = 384 * 100
  const channels = Array.from({ length: 8 }, (_, channel) => Float32Array.from({ length: count }, (_, frame) => 0.01 * Math.sin(frame * 0.13 + channel * 0.03)))
  engine.push(map.map(index => channels[index]!))
  transport.context.on(transport.response, ({ body }) => {
    if (body?.type === 'ready') {
      ready.resolve()
    }
    else if (body?.type === 'error') {
      errors.push(body.reason)
      ready.reject(new Error(body.reason))
    }
    else if (body?.type === 'processed') {
      processedFrames = body.inputFrames
      expect(body.referenceSignalFrames).toBe(0)
    }
    else if (body?.type === 'pcm') {
      expect(body.packet.offsetFrames).toBe(actualFrames)
      actualFrames += body.packet.mask.length
      actual.push(body.packet.mask)
    }
  })
  try {
    // An intentionally unusable asset proves off does not require AEC/WASM;
    // this is the real Worker entry and production Eventa contract.
    transport.context.emit(transport.request, { type: 'start', processing: { algorithm: 'spatial-mask', aec3Enabled: false }, channelMap: map, radiusMm: 44, wasmUrl: '/must-not-load-aec3.wasm' })
    await ready.promise
    for (let offsetFrames = 0; offsetFrames < count; offsetFrames += 384) {
      transport.context.emit(transport.request, {
        type: 'block',
        offsetFrames,
        startTime: offsetFrames / 48000,
        channels: channels.map(channel => channel.slice(offsetFrames, offsetFrames + 384)),
        render: [new Float32Array(384).fill(1), new Float32Array(384).fill(1)],
      })
    }
    await expect.poll(() => processedFrames, { timeout: 10000 }).toBe(count)
    expect(errors).toEqual([])
    expect(actual.length).toBeGreaterThan(0)
    expect(actual.length).toBe(expected.length)
    for (let part = 0; part < expected.length; part++) {
      let maximumError = 0
      for (let frame = 0; frame < expected[part]!.length; frame++)
        maximumError = Math.max(maximumError, Math.abs(actual[part]![frame]! - expected[part]![frame]!))
      expect(maximumError).toBeLessThanOrEqual(1e-7)
    }
  }
  finally {
    transport.dispose()
    worker.terminate()
  }
}, 15000)
