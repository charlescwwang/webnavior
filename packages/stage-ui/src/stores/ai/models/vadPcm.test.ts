import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useVAD } from './vad'

const inference = vi.fn(async (feed: {
  input: {
    data: Float32Array
    dims: number[]
  }
  state: object
}) => ({
  stateN: feed.state,
  output: { data: Float32Array.of(feed.input.data.some(value => value !== 0) ? 0.9 : 0) },
}))
// NOTICE: Only the external inference runtime is replaced. Real VAD segmentation,
// sample accounting and useVAD lifecycle run unchanged, without model downloads.
vi.mock('@huggingface/transformers', () => ({
  Tensor: class {
    constructor(public type: string, public data: Float32Array | number[], public dims: number[]) {
    }
  },
  AutoModel: { from_pretrained: async () => inference },
}))
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  inference.mockClear()
})
afterEach(() => {
  for (const scope of scopes.splice(0))
    scope.stop()
})
describe('existing VAD with Mask PCM input', () => {
  it('does not open another audio graph and preserves partial-frame audio length through segmentation', async () => {
    const segments: Float32Array[] = []
    const scope = effectScope()
    scopes.push(scope)
    const vad = scope.run(() => useVAD('unused-in-pcm-mode', { speechPadMs: 0, minSpeechDurationMs: 0, minSilenceDurationMs: 1, onSpeechReady: ({ buffer }) => segments.push(buffer) }))!
    await vad.init('pcm')
    expect(vad.loaded.value).toBe(true)
    expect(vad.inferenceError.value).toBe('')
    await vad.processPcm(new Float32Array(512).fill(0.1))
    await vad.processPcm(new Float32Array(123).fill(0.1))
    await vad.processPcm(new Float32Array(512))
    expect(inference.mock.calls[1][0].input.dims).toEqual([1, 512])
    expect(inference.mock.calls[1][0].input.data.subarray(123).every(value => value === 0)).toBe(true)
    expect(segments).toHaveLength(1)
    expect(segments[0].length).toBe(512 + 123 + 512)
    expect(segments[0].subarray(0, 635).every(value => Math.abs(value - 0.1) < 1e-7)).toBe(true)
    expect(segments[0].subarray(635).every(value => value === 0)).toBe(true)
    vad.dispose()
    await expect(vad.processPcm(new Float32Array(512))).rejects.toThrow('not initialized')
  })
  it('rejects malformed PCM before model inference', async () => {
    const scope = effectScope()
    scopes.push(scope)
    const vad = scope.run(() => useVAD('unused-in-pcm-mode'))!
    await vad.init('pcm')
    await expect(vad.processPcm(new Float32Array(513))).rejects.toThrow('512')
    await expect(vad.processPcm(Float32Array.of(Number.NaN))).rejects.toThrow('finite')
    await expect(vad.processPcm(new Float32Array())).rejects.toThrow('512')
    expect(inference).not.toHaveBeenCalled()
    vad.dispose()
  })
})
