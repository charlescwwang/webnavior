import { expect, it } from 'vitest'

import { encodeFalconClip, encodeFalconWindow, falconAudioLimits } from './falconAudio'

it('encodes an entire three-second clip using the deployed server plain frame count', () => {
  const audio = new Float32Array(48000)
  audio[47999] = 0.25
  const mouths = Array.from({ length: 75 }, (_, index) => new Uint8Array(9216).fill(index))
  const packet = encodeFalconClip(audio, mouths)
  const view = new DataView(packet)
  expect(packet.byteLength).toBe(4 + 75 * (640 * 4 + 9216))
  expect(view.getUint32(0, true)).toBe(75)
  expect(view.getUint32(0, true) & 0x80000000).toBe(0)
  expect(view.getFloat32(4 + 47999 * 4, true)).toBe(0.25)
  expect(view.getUint8(packet.byteLength - 1)).toBe(74)
})

it('requires synchronized full-clip lengths within the client bounds without silently padding', () => {
  const frame = new Uint8Array(9216)
  expect(() => encodeFalconClip(new Float32Array(24 * 640), new Array<Uint8Array>(24).fill(frame))).toThrow()
  expect(() => encodeFalconClip(new Float32Array(1501 * 640), new Array<Uint8Array>(1501).fill(frame))).toThrow()
  expect(() => encodeFalconClip(new Float32Array(16001), new Array<Uint8Array>(25).fill(frame))).toThrow()
  expect(() => encodeFalconClip(new Float32Array(16000).fill(Infinity), new Array<Uint8Array>(25).fill(frame))).toThrow()
})

it('packs the documented header, Float32 LE audio and row-major mouth frames', () => {
  const audio = new Float32Array(16000)
  audio[0] = -0.5
  const mouths = Array.from({ length: 25 }, (_, index) => new Uint8Array(9216).fill(index))
  const packet = encodeFalconWindow(audio, mouths)
  const view = new DataView(packet)
  expect(packet.byteLength).toBe(294404)
  expect(view.getUint32(0, true)).toBe(25)
  expect(view.getFloat32(4, true)).toBe(-0.5)
  expect(view.getUint8(64004)).toBe(0)
  expect(view.getUint8(294403)).toBe(24)
  expect(audio[0]).toBe(-0.5)
})

it('rejects wrong frame counts, frame sizes and nonfinite audio without truncating', () => {
  const mouths = Array.from({ length: 25 }, () => new Uint8Array(9216))
  expect(() => encodeFalconWindow(new Float32Array(15999), mouths)).toThrow()
  expect(() => encodeFalconWindow(new Float32Array(16000), mouths.slice(1))).toThrow()
  expect(() => encodeFalconWindow(new Float32Array(16000), [...mouths.slice(1), new Uint8Array(9215)])).toThrow()
  expect(() => encodeFalconWindow(new Float32Array(16000).fill(Number.NaN), mouths)).toThrow()
  expect(() => encodeFalconWindow(new Float32Array(16000).fill(Infinity), mouths)).toThrow()
})

it('does not clamp finite source audio before model preprocessing', () => {
  const packet = encodeFalconWindow(new Float32Array(16000).fill(1.25), Array.from({ length: 25 }, () => new Uint8Array(9216)))
  expect(new DataView(packet).getFloat32(4, true)).toBe(1.25)
  expect(packet.byteLength).toBe(falconAudioLimits.packetBytes)
})
