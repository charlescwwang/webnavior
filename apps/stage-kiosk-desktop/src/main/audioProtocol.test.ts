import { Buffer } from 'node:buffer'

import { expect, it } from 'vitest'

import { AudioFrameDecoder, encodeFrame } from './audioProtocol'

it('decodes arbitrary pipe boundaries and coalesced replies without losing float precision', () => {
  const samples = new Float32Array([1e-8, -0.125, 0.1234567])
  const bytes = Buffer.concat([encodeFrame({ id: 1 }, samples), encodeFrame({ id: 2 })])
  const decoder = new AudioFrameDecoder()
  const frames = []
  for (let i = 0; i < bytes.length; i += 3)
    frames.push(...decoder.push(bytes.subarray(i, i + 3)))
  expect(frames).toHaveLength(2)
  expect(frames[0]!.metadata).toEqual({ id: 1 })
  expect(frames[0]!.samples).toEqual(samples)
  expect(frames[1]!.metadata).toEqual({ id: 2 })
})

it('rejects oversized and unaligned native payloads before buffering them', () => {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(2, 0)
  header.writeUInt32LE(3, 4)
  expect(() => new AudioFrameDecoder().push(header)).toThrow('size')
  header.writeUInt32LE(3 * 1024 * 1024, 4)
  expect(() => new AudioFrameDecoder().push(header)).toThrow('size')
})
