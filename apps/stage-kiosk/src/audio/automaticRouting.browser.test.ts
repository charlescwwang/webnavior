import type { SpatialInput } from './spatialInput'

import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

import { useArrayMicrophone } from '../composables/useArrayMicrophone'
import { inspectChannels } from './microphoneInput'
import { createSpatialInput } from './spatialInput'

// NOTICE: Only the hardware/DSP IO boundaries are controlled here to reproduce
// failures and delayed device replies. Real Worklet channel counts, PCM delivery
// and DSP arithmetic are exercised separately by microphoneInput/spatialInput tests.
vi.mock('./microphoneInput', { spy: true })
vi.mock('./spatialInput', { spy: true })

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(inspectChannels).mockReset()
  vi.mocked(createSpatialInput).mockReset()
  localStorage.removeItem('kiosk/audio/array-mode')
})

function fixture(label = 'miniDSP UMA-8 v2') {
  const context = new AudioContext()
  const raw = context.createMediaStreamDestination().stream
  const track = raw.getAudioTracks()[0]!
  vi.spyOn(track, 'label', 'get').mockReturnValue(label)
  const apply = vi.spyOn(track, 'applyConstraints').mockResolvedValue()
  const scope = effectScope()
  const input = ref<MediaStream | undefined>(raw)
  const enabled = ref(true)
  const audio = scope.run(() => useArrayMicrophone(input, enabled, ref()))!
  return { audio, input, enabled, apply, async close() {
    scope.stop()
    raw.getTracks().forEach(track => track.stop())
    await context.close()
  } }
}
function processor(): SpatialInput {
  return {
    start: vi.fn(),
    finish: vi.fn(async () => {}),
    dispose: vi.fn(),
    cancelComparison: vi.fn(),
    recordComparison: vi.fn(async () => { throw new Error('Not recording') }),
    statistics: { inputFrames: 0, outputFrames: 0, consumedFrames: 0, lagSeconds: 0, maxWorkMs: 0 },
  }
}
it('automatically starts Mask on UMA-8 and retries detection after a runtime failure and restart', async () => {
  localStorage.setItem('kiosk/audio/array-mode', 'standard')
  vi.mocked(inspectChannels).mockResolvedValue(8)
  const first = processor()
  const second = processor()
  vi.mocked(createSpatialInput).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
  const f = fixture()
  try {
    await vi.waitFor(() => expect(f.audio.mode.value).toBe('mask'))
    expect(f.audio.pcmSource.value).toBe(first)
    expect(f.apply.mock.calls[0][0]?.channelCount).toEqual({ ideal: 8 })
    vi.mocked(createSpatialInput).mock.calls[0][1].onError('Worker failed')
    await vi.waitFor(() => expect(f.audio.status.value).toBe('fallback'))
    expect(f.audio.pcmSource.value).toBeUndefined()
    expect(f.audio.error.value).toContain('Worker failed')
    expect(f.audio.warning.value).toEqual({ generation: 1, stage: 'mask_runtime', outcome: 'standard', channels: 8 })
    expect(first.dispose).toHaveBeenCalled()
    expect(f.apply.mock.lastCall?.[0]?.echoCancellation).toBe(true)
    expect(createSpatialInput).toHaveBeenCalledTimes(1)
    f.enabled.value = false
    f.enabled.value = true
    await vi.waitFor(() => expect(f.audio.pcmSource.value).toBe(second))
    expect(inspectChannels).toHaveBeenCalledTimes(2)
    expect(f.audio.error.value).toBe('')
    expect(f.audio.warning.value).toBeUndefined()
    // A failed old generation cannot shut down the replacement Mask.
    vi.mocked(createSpatialInput).mock.calls[0][1].onError('Stale error')
    expect(f.audio.pcmSource.value).toBe(second)
  }
  finally { await f.close() }
})
it.each([1, 2])('warns when an identified UMA-8 only delivers %i channels, without starting Mask', async (channels) => {
  vi.mocked(inspectChannels).mockResolvedValue(channels)
  const f = fixture()
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('fallback'))
    expect(f.audio.stream.value).toBe(f.input.value)
    expect(f.audio.error.value).toContain(`${channels} actual channels`)
    expect(f.audio.warning.value?.stage).toBe('channels')
    expect(createSpatialInput).not.toHaveBeenCalled()
  }
  finally { await f.close() }
})
it('keeps another eight-channel device on the normal path because its geometry is unknown', async () => {
  vi.mocked(inspectChannels).mockResolvedValue(8)
  const f = fixture('USB conference microphone')
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('standard'))
    expect(f.audio.error.value).toBe('')
    expect(f.audio.warning.value).toBeUndefined()
    expect(createSpatialInput).not.toHaveBeenCalled()
  }
  finally { await f.close() }
})
it('falls back once when Mask initialization rejects, with no permanent disabled-mode setting', async () => {
  vi.mocked(inspectChannels).mockResolvedValue(8)
  vi.mocked(createSpatialInput).mockRejectedValue(new Error('Worker unavailable'))
  const f = fixture()
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('fallback'))
    expect(f.audio.error.value).toContain('Worker unavailable')
    expect(f.audio.stream.value).toBe(f.input.value)
    expect(createSpatialInput).toHaveBeenCalledTimes(1)
  }
  finally { await f.close() }
})
it('ignores a late eight-channel result after a device-generation restart', async () => {
  const pending = Promise.withResolvers<number>()
  vi.mocked(inspectChannels).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(2)
  const f = fixture('USB conference microphone')
  try {
    await vi.waitFor(() => expect(inspectChannels).toHaveBeenCalledTimes(1))
    f.enabled.value = false
    f.enabled.value = true
    pending.resolve(8)
    await vi.waitFor(() => expect(f.audio.status.value).toBe('standard'))
    expect(f.audio.channelCount.value).toBe(2)
    expect(createSpatialInput).not.toHaveBeenCalled()
    expect(inspectChannels).toHaveBeenCalledTimes(2)
  }
  finally { await f.close() }
})

it('reports unavailable capture when restoring standard constraints also fails', async () => {
  vi.mocked(inspectChannels).mockResolvedValue(8)
  vi.mocked(createSpatialInput).mockRejectedValue(new Error('Worker unavailable'))
  const f = fixture()
  f.apply.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Device disconnected'))
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('error'))
    expect(f.audio.warning.value).toEqual({ generation: 1, stage: 'mask_init', outcome: 'unavailable', channels: 8 })
    expect(f.audio.stream.value).toBeUndefined()
  }
  finally { await f.close() }
})
