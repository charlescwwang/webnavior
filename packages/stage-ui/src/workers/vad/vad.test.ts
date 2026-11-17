import { AutoModel } from '@huggingface/transformers'
import { expect, it, vi } from 'vitest'

import { VAD } from './vad'

// The external model boundary is deterministic here; the real VAD buffering,
// timestamps, segmentation and disposal below run without private-method mocks.
vi.mock('@huggingface/transformers', () => ({
  Tensor: class {
    constructor(public type: string, public data: Float32Array, public dims: number[]) {}
  },
  AutoModel: {
    from_pretrained: vi.fn(async () => Object.assign(async ({ input }: { input: { data: Float32Array } }) => ({
      stateN: {},
      output: { data: [input.data[0] ? 0.99 : 0] },
    }), { dispose: vi.fn(async () => {}) })),
  },
}))

it('reports the real capture start and sample count separately from synthetic VAD padding', async () => {
  const vad = new VAD({ minSilenceDurationMs: 32, speechPadMs: 32, minSpeechDurationMs: 1 })
  await vad.initialize()
  const ready = vi.fn()
  vad.on('speech-ready', ready)
  await vad.processAudio(new Float32Array(512), 32)
  await vad.processAudio(new Float32Array(512), 64)
  await vad.processAudio(new Float32Array(512).fill(1), 96)
  await vad.processAudio(new Float32Array(512).fill(1), 128)
  await vad.processAudio(new Float32Array(512), 160)
  expect(ready).toHaveBeenCalledTimes(1)
  const event = ready.mock.calls[0]![0]
  expect(event.startTimeMs).toBe(32)
  expect(event.capturedSamples).toBe(2048)
  expect(event.preSpeechSamples).toBe(512)
  expect(event.buffer.length).toBe(2560)
  expect(event.buffer[512]).toBe(1)
  expect(event.truncated).toBe(false)
  await vad.dispose()
})

it('marks a duration boundary as truncated so AV recognition cannot order from a partial sentence', async () => {
  const vad = new VAD({ maxBufferDuration: 0.064, speechPadMs: 0, minSpeechDurationMs: 1 })
  await vad.initialize()
  const ready = vi.fn()
  vad.on('speech-ready', ready)
  await vad.processAudio(new Float32Array(512).fill(1), 32)
  await vad.processAudio(new Float32Array(512).fill(1), 64)
  expect(ready).toHaveBeenCalledTimes(1)
  expect(ready.mock.calls[0]![0]).toMatchObject({ startTimeMs: 0, capturedSamples: 1024, truncated: true })
  await vad.dispose()
})

it('releases a model that finishes loading after its owner has been disposed', async () => {
  const model = await AutoModel.from_pretrained('test-only-model')
  let resolve!: (value: typeof model) => void
  vi.mocked(AutoModel.from_pretrained).mockImplementationOnce(() => new Promise(done => resolve = done))
  const vad = new VAD()
  const loading = vad.initialize()
  await vad.dispose()
  resolve(model)
  await loading
  expect(model.dispose).toHaveBeenCalledTimes(1)
})

it('segments using LCMV detection PCM while recording unchanged source-aligned Falcon reference PCM', async () => {
  const vad = new VAD({ minSilenceDurationMs: 32, speechPadMs: 32, minSpeechDurationMs: 1 })
  await vad.initialize()
  const ready = vi.fn()
  vad.on('speech-ready', ready)
  await vad.processAudio(new Float32Array(512), 32, new Float32Array(512).fill(0.01))
  await vad.processAudio(new Float32Array(512).fill(1), 64, new Float32Array(512).fill(0.02))
  await vad.processAudio(new Float32Array(512), 96, new Float32Array(512).fill(0.03))
  expect(ready).toHaveBeenCalledTimes(1)
  const event = ready.mock.calls[0]![0]
  expect(event.startTimeMs).toBe(0)
  expect(event.capturedSamples).toBe(1536)
  expect(event.preSpeechSamples).toBe(512)
  expect(event.buffer[0]).toBeCloseTo(0.01)
  expect(event.buffer[512]).toBeCloseTo(0.02)
  expect(event.buffer[1024]).toBeCloseTo(0.03)
  expect(event.buffer[1536]).toBe(0)
  await expect(vad.processAudio(new Float32Array(512), 128, new Float32Array(511))).rejects.toThrow('same sample clock')
  await vad.dispose()
})

// Report: this chat, 2026-11-17 — MediaPipe must authorize a new utterance before VAD inference.
it('buffers a closed visual gate without inference and retains the first audio after admission', async () => {
  const vad = new VAD({ speechPadMs: 64, minSilenceDurationMs: 32, minSpeechDurationMs: 1 })
  await vad.initialize()
  const score = vi.fn()
  const started = vi.fn()
  const ready = vi.fn()
  vad.on('debug', score)
  vad.on('speech-start', started)
  vad.on('speech-ready', ready)
  await vad.processAudio(new Float32Array(512).fill(0.2), 32, undefined, false)
  await vad.processAudio(new Float32Array(512).fill(0.3), 64, undefined, false)
  expect(score).not.toHaveBeenCalled()
  expect(started).not.toHaveBeenCalled()
  await vad.processAudio(new Float32Array(512).fill(1), 96, undefined, true)
  await vad.processAudio(new Float32Array(512), 128, undefined, false)
  expect(started).toHaveBeenCalledTimes(1)
  expect(ready).toHaveBeenCalledTimes(1)
  const event = ready.mock.calls[0]![0]
  expect(event.startTimeMs).toBe(0)
  expect(event.preSpeechSamples).toBe(1024)
  expect(event.buffer[0]).toBeCloseTo(0.2)
  expect(event.buffer[512]).toBeCloseTo(0.3)
  expect(event.buffer[1024]).toBe(1)
  await vad.dispose()
})

it('keeps an admitted phrase running through mouth closures until VAD silence ends it', async () => {
  const vad = new VAD({ speechPadMs: 0, minSilenceDurationMs: 64, minSpeechDurationMs: 1 })
  await vad.initialize()
  const ready = vi.fn()
  const started = vi.fn()
  vad.on('speech-ready', ready)
  vad.on('speech-start', started)
  await Promise.all([
    vad.processAudio(new Float32Array(512).fill(1), 32, undefined, true),
    vad.processAudio(new Float32Array(512).fill(1), 64, undefined, false),
    vad.processAudio(new Float32Array(512), 96, undefined, false),
    vad.processAudio(new Float32Array(512).fill(1), 128, undefined, false),
    vad.processAudio(new Float32Array(512), 160, undefined, false),
    vad.processAudio(new Float32Array(512), 192, undefined, false),
    vad.processAudio(new Float32Array(512).fill(1), 224, undefined, false),
  ])
  expect(started).toHaveBeenCalledTimes(1)
  expect(ready).toHaveBeenCalledTimes(1)
  expect(ready.mock.calls[0]![0].capturedSamples).toBe(3072)
  await vad.dispose()
})
