import { AutoModel } from '@huggingface/transformers'
import { expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useVAD } from './vad'

// Model inference is the external boundary. Admission, Vue wiring and source
// buffering run unchanged; no Web Audio or global crypto APIs are replaced.
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

// Report: this chat, 2026-11-17 — UMA/external PCM must use visual admission before inference.
it('passes visual admission through useVAD for external PCM while preserving a whole short answer', async () => {
  let allowed = false
  const started = vi.fn()
  const ready = vi.fn()
  const scores = vi.fn()
  const scope = effectScope()
  const vad = scope.run(() => useVAD('unused-external-worklet', {
    externalPCM: true,
    canStartSpeech: () => allowed,
    speechPadMs: 64,
    minSilenceDurationMs: 32,
    minSpeechDurationMs: 1,
    onSpeechStart: started,
    onSpeechReady: ready,
    onSpeechProbability: scores,
  }))!
  try {
    await vad.init()
    expect(vad.loaded.value).toBe(true)
    await vad.processAudio(new Float32Array(512).fill(0.2), 32)
    expect(started).not.toHaveBeenCalled()
    allowed = true
    await vad.processAudio(new Float32Array(512).fill(1), 64)
    expect(started).toHaveBeenCalledTimes(1)
    await vad.processAudio(new Float32Array(512).fill(1), 96)
    // Every inference matters to sustained-speech admission, even if Vue's
    // probability ref does not change between identical consecutive scores.
    expect(scores.mock.calls.map(([probability]) => probability)).toEqual([0.99, 0.99])
    allowed = false
    await vad.processAudio(new Float32Array(512), 128)
    expect(ready).toHaveBeenCalledTimes(1)
    expect(scores.mock.calls.map(([probability]) => probability)).toEqual([0.99, 0.99, 0])
    expect(ready.mock.calls[0]![0].buffer[0]).toBeCloseTo(0.2)
    await vad.processAudio(new Float32Array(512).fill(1), 160)
    expect(started).toHaveBeenCalledTimes(1)
    expect(AutoModel.from_pretrained).toHaveBeenCalledOnce()
  }
  finally {
    vad.dispose()
    scope.stop()
  }
})
