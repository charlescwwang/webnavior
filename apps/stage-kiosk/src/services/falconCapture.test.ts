import { expect, it } from 'vitest'

import { InputGain } from '../audio/inputGain'
import { createFalconCapture } from './falconCapture'
import { createKioskUtteranceQueue } from './kioskUtteranceQueue'

const gray = (value: number, aperture = 0.1) => ({ pixels: new Uint8Array(96 * 96).fill(value), aperture })

// Report: this chat Nov17 — an outstanding Falcon request discarded the following utterance.
it('freezes consecutive clips independently and displays later ASR before executing it in capture order', async () => {
  const capture = createFalconCapture(15, 3000)
  const visible: string[] = []
  const executed: string[] = []
  const queue = createKioskUtteranceQueue({
    onReady: utterance => visible.push(utterance.text),
    process: async (utterance) => {
      executed.push(utterance.text)
    },
  })
  const first = queue.reserve('asr', 60000)
  const second = queue.reserve('asr', 60000)
  if (first.kind !== 'ACCEPTED' || second.kind !== 'ACCEPTED')
    throw new Error('Expected both captures to be admitted.')
  for (let index = 0; index < 25; index++)
    capture.push(index * 40 + 20, gray(1))
  const packet = capture.prepare({ buffer: new Float32Array(16000), duration: 1000, startTimeMs: 0, capturedSamples: 16000 })
  for (let index = 25; index < 50; index++)
    capture.push(index * 40 + 20, gray(2))
  const following = capture.prepare({ buffer: new Float32Array(16000), duration: 1000, startTimeMs: 1000, capturedSamples: 16000 })
  expect(new Uint8Array(packet.packet, 4 + 16000 * 4)[0]).toBe(1)
  expect(new Uint8Array(following.packet, 4 + 16000 * 4)[0]).toBe(2)
  second.complete({ text: '第二句', recognitionMode: 'falcon' })
  expect(visible).toEqual(['第二句'])
  expect(executed).toEqual([])
  first.complete({ text: '第一句', recognitionMode: 'falcon' })
  await queue.idle()
  expect(executed).toEqual(['第一句', '第二句'])
})

it('aligns every mouth frame with its audio samples and preserves complete VAD padding', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 75; index++)
    capture.push(index * 40 + 20, gray(index))
  const buffer = new Float32Array(5 * 16000)
  buffer[32000] = 0.25
  const packet = capture.prepare({ buffer, duration: 3000, startTimeMs: 0, capturedSamples: 48000 })
  const view = new DataView(packet.packet)
  expect(view.getUint32(0, true)).toBe(125)
  expect(view.getFloat32(4 + 32000 * 4, true)).toBe(0.25)
  const pixels = new Uint8Array(packet.packet, 4 + buffer.length * 4)
  expect(pixels[0]).toBe(0)
  expect(pixels[74 * 9216]).toBe(74)
  expect(pixels[124 * 9216]).toBe(74)
})

it('pads only a short silent tail to the minimum one-second protocol window', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 10; index++)
    capture.push(index * 40 + 20, gray(10))
  const buffer = new Float32Array(6400).fill(0.2)
  const packet = capture.prepare({ buffer, duration: 400, startTimeMs: 0, capturedSamples: buffer.length })
  expect(new DataView(packet.packet).getUint32(0, true)).toBe(25)
  expect(new DataView(packet.packet).getFloat32(4 + 6400 * 4, true)).toBe(0)
})

it('rejects a missing real-video interval, unknown timestamps and truncated speech instead of sending a partial order', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 25; index++)
    capture.push(index * 40 + 20, index >= 10 && index <= 17 ? undefined : gray(1))
  const event = { buffer: new Float32Array(16000), duration: 1000, startTimeMs: 0, capturedSamples: 16000 }
  expect(() => capture.prepare(event)).toThrow('visible mouth')
  expect(() => capture.prepare({ ...event, startTimeMs: undefined })).toThrow('incomplete')
  expect(() => capture.prepare({ ...event, truncated: true })).toThrow('incomplete')
  expect(() => capture.prepare({ ...event, buffer: new Float32Array(16 * 16000) })).toThrow('duration')
})

it('bounds idle history, active history and reset memory independently of camera runtime', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 10000; index++)
    capture.push(index * 40, gray(1))
  expect(capture.retainedBytes).toBeLessThanOrEqual(76 * 9216)
  capture.begin()
  for (let index = 10000; index < 20000; index++)
    capture.push(index * 40, gray(1))
  expect(capture.retainedBytes).toBeLessThanOrEqual(379 * 9216)
  capture.reset()
  expect(capture.retainedBytes).toBe(0)
})

// Report: DEV-642583, this chat — initial VAD silence preceded a visible mouth.
it('pads only pre-speech camera history with the first visible mouth without losing audio', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 75; index++)
    capture.push(index * 40 + 20, index < 45 ? undefined : gray(index))
  const buffer = new Float32Array(48000)
  buffer[33000] = 0.25
  const packet = capture.prepare({ buffer, duration: 1000, startTimeMs: 0, capturedSamples: 48000, preSpeechSamples: 32000 })
  const pixels = new Uint8Array(packet.packet, 4 + buffer.byteLength)
  expect(new DataView(packet.packet).getFloat32(4 + 33000 * 4, true)).toBe(0.25)
  expect(pixels[0]).toBe(45)
  expect(pixels[50 * 9216]).toBe(50)
  capture.reset()
  for (let index = 0; index < 75; index++)
    capture.push(index * 40 + 20, index < 55 ? undefined : gray(index))
  expect(() => capture.prepare({ buffer, duration: 1000, startTimeMs: 0, capturedSamples: 48000, preSpeechSamples: 32000 })).toThrow('visible mouth')
})

// Report: this chat, 2026-11-17 — the framed customer stays silent while a bystander speaks.
it('rejects a complete closed-mouth utterance even when microphone speech is loud', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 25; index++)
    capture.push(index * 40 + 20, gray(index, 0.01 + index % 3 * 0.003))
  expect(() => capture.prepare({ buffer: new Float32Array(16000).fill(0.7), duration: 1000, startTimeMs: 0, capturedSamples: 16000 })).toThrowError(expect.objectContaining({ reason: 'inactive' }))
})

it('ignores mouth opening in pre-roll and synthetic tail when the actual speech interval is closed', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 50; index++)
    capture.push(index * 40 + 20, gray(index, index < 25 || index >= 40 ? 0.2 : 0.01))
  expect(() => capture.prepare({ buffer: new Float32Array(32000).fill(0.5), duration: 600, startTimeMs: 0, preSpeechSamples: 16000, capturedSamples: 25600 })).toThrowError(expect.objectContaining({ reason: 'inactive' }))
})

it('preserves complete audio when a short affirmative has visible mouth opening among closed frames', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 10; index++)
    capture.push(index * 40 + 20, gray(index, index === 3 ? 0.08 : 0.01))
  const audio = new Float32Array(6400).fill(0.2)
  const packet = capture.prepare({ buffer: audio, duration: 400, startTimeMs: 0, capturedSamples: audio.length })
  expect(new DataView(packet.packet).getUint32(0, true)).toBe(25)
  expect(new Float32Array(packet.packet, 4, audio.length)).toEqual(audio)
})

it('does not reuse an earlier speaking turn to admit the next closed-mouth turn', () => {
  const capture = createFalconCapture(15, 3000)
  for (let index = 0; index < 50; index++)
    capture.push(index * 40 + 20, gray(index, index < 25 ? 0.2 : 0.01))
  expect(capture.prepare({ buffer: new Float32Array(16000), duration: 1000, startTimeMs: 0, capturedSamples: 16000 }).diagnostics.maximumAperture).toBe(0.2)
  expect(() => capture.prepare({ buffer: new Float32Array(16000).fill(0.7), duration: 1000, startTimeMs: 1000, capturedSamples: 16000 })).toThrowError(expect.objectContaining({ reason: 'inactive' }))
})

it('rejects invalid lip evidence instead of treating it as an open mouth', () => {
  const capture = createFalconCapture(15, 3000)
  expect(() => capture.push(20, gray(1, Number.NaN))).toThrow('Invalid mouth frame')
  expect(() => capture.push(20, gray(1, -0.1))).toThrow('Invalid mouth frame')
})

// Report: this chat, 2026-11-17 — amplify the UMA-8 reference before serializing Falcon audio.
it('encodes independently amplified and peak-limited Falcon PCM without changing audio-video timing', () => {
  const capture = createFalconCapture(15, 3000)
  const raw = new Float32Array(16000).fill(0.01)
  raw[8000] = 0.9
  const before = raw.slice()
  const vadGain = new InputGain()
  const falconGain = new InputGain()
  vadGain.process(new Float32Array(512).fill(1), 30)
  const gained = falconGain.process(raw, 6)
  for (let index = 0; index < 25; index++)
    capture.push(index * 40 + 20, gray(index))
  const { packet } = capture.prepare({ buffer: gained.samples, duration: 1000, startTimeMs: 0, capturedSamples: raw.length })
  const encoded = new Float32Array(packet, 4, raw.length)
  expect(encoded[0]).toBeCloseTo(0.01 * 10 ** (6 / 20), 6)
  expect(encoded[8000]).toBeCloseTo(0.98, 6)
  expect(encoded.every(sample => Math.abs(sample) <= 0.980001)).toBe(true)
  expect(new DataView(packet).getUint32(0, true)).toBe(25)
  expect(encoded.length).toBe(raw.length)
  expect(raw).toEqual(before)
  expect(falconGain.process(raw, 0).samples).toBe(raw)
})
