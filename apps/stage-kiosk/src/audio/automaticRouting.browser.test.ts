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
  localStorage.removeItem('kiosk/audio/automatic-device')
  localStorage.removeItem('kiosk/audio/dynamic-spatial')
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
  const audio = scope.run(() => useArrayMicrophone(input, enabled))!
  return { audio, input, enabled, apply, async close() {
    scope.stop()
    raw.getTracks().forEach(track => track.stop())
    await context.close()
  } }
}
function processor(): SpatialInput {
  return {
    start: vi.fn(),
    setPlayback: vi.fn(),
    finish: vi.fn(async () => {}),
    dispose: vi.fn(),
    cancelComparison: vi.fn(),
    recordComparison: vi.fn(async () => { throw new Error('Not recording') }),
    statistics: { inputFrames: 0, outputFrames: 0, consumedFrames: 0, lagSeconds: 0, maxWorkMs: 0, processingMode: 'soft', playbackTransitions: 0 },
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
    expect(inspectChannels).toHaveBeenCalledTimes(3)
    expect(f.audio.error.value).toBe('')
    expect(f.audio.warning.value).toBeUndefined()
    // A failed old generation cannot shut down the replacement Mask.
    vi.mocked(createSpatialInput).mock.calls[0][1].onError('Stale error')
    expect(f.audio.pcmSource.value).toBe(second)
  }
  finally { await f.close() }
})
it.each([1, 2])('uses standard capture for%i actual channels regardless of the device label', async (channels) => {
  vi.mocked(inspectChannels).mockResolvedValue(channels)
  const f = fixture()
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('standard'))
    expect(f.audio.stream.value).toBe(f.input.value)
    expect(f.audio.error.value).toBe('')
    expect(f.audio.warning.value).toBeUndefined()
    expect(createSpatialInput).not.toHaveBeenCalled()
  }
  finally { await f.close() }
})
// User requirement,2026-11-05: actual eight channels are sufficient; no allowlist.
it.each(['USB conference microphone', 'micArray RAW SPK', ''])('uses Mask for eight actual channels without relying on label%s', async (label) => {
  vi.mocked(inspectChannels).mockResolvedValue(8)
  const mask = processor()
  vi.mocked(createSpatialInput).mockResolvedValue(mask)
  const f = fixture(label)
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('ready'))
    expect(f.audio.mode.value).toBe('mask')
    expect(f.audio.channelCount.value).toBe(8)
    expect(f.audio.pcmSource.value).toBe(mask)
    expect(f.audio.warning.value).toBeUndefined()
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
  vi.mocked(inspectChannels).mockReturnValueOnce(pending.promise).mockResolvedValue(2)
  const f = fixture('USB conference microphone')
  try {
    await vi.waitFor(() => expect(inspectChannels).toHaveBeenCalledTimes(1))
    f.enabled.value = false
    f.enabled.value = true
    pending.resolve(8)
    await vi.waitFor(() => expect(f.audio.status.value).toBe('standard'))
    expect(f.audio.channelCount.value).toBe(2)
    expect(createSpatialInput).not.toHaveBeenCalled()
    expect(inspectChannels).toHaveBeenCalledTimes(3)
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

it('opts in once per graph, uses unamplified dynamic PCM and forwards TTS edges without restarting capture', async () => {
  localStorage.setItem('kiosk/audio/dynamic-spatial', 'true')
  vi.mocked(inspectChannels).mockResolvedValue(8)
  const processed = processor()
  vi.mocked(createSpatialInput).mockResolvedValue(processed)
  const context = new AudioContext()
  const raw = context.createMediaStreamDestination().stream
  const track = raw.getAudioTracks()[0]!
  vi.spyOn(track, 'applyConstraints').mockResolvedValue()
  const scope = effectScope()
  const playing = ref(true)
  const audio = scope.run(() => useArrayMicrophone(ref(raw), ref(true), playing))!
  try {
    await vi.waitFor(() => expect(audio.mode.value).toBe('mask'))
    expect(vi.mocked(createSpatialInput).mock.calls[0][1].processing).toBe('dynamic')
    expect(processed.setPlayback).toHaveBeenCalledWith(true)
    expect(audio.inputGainDb.value).toBe(0)
    expect(audio.earlyBargeIn.value).toBe(true)
    playing.value = false
    expect(processed.setPlayback).toHaveBeenLastCalledWith(false)
    expect(createSpatialInput).toHaveBeenCalledOnce()
    vi.mocked(createSpatialInput).mock.calls[0][1].onError('Worker failed')
    await vi.waitFor(() => expect(audio.status.value).toBe('fallback'))
    expect(audio.earlyBargeIn.value).toBe(false)
    expect(audio.inputGainDb.value).toBe(0)
  }
  finally {
    scope.stop()
    raw.getTracks().forEach(track => track.stop())
    await context.close()
  }
})
it('retains fixed65dB and semantic interruption when the dynamic feature is disabled', async () => {
  vi.mocked(inspectChannels).mockResolvedValue(8)
  const processed = processor()
  vi.mocked(createSpatialInput).mockResolvedValue(processed)
  const f = fixture()
  try {
    await vi.waitFor(() => expect(f.audio.mode.value).toBe('mask'))
    expect(f.audio.dynamicProcessing.value).toBe(false)
    expect(f.audio.inputGainDb.value).toBe(65)
    expect(f.audio.earlyBargeIn.value).toBe(false)
    expect(vi.mocked(createSpatialInput).mock.calls[0][1].processing).toBe('soft')
  }
  finally { await f.close() }
})

it('rebuilds standard two-channel capture to eight-channel Mask and back for replacement devices', async () => {
  vi.mocked(inspectChannels).mockImplementation(async raw => raw instanceof MediaStream && raw.getAudioTracks()[0].label === 'UMA-8' ? 8 : 2)
  const processed = processor()
  vi.mocked(createSpatialInput).mockResolvedValue(processed)
  const f = fixture('Conference input')
  const context = new AudioContext()
  const uma = context.createMediaStreamDestination().stream
  const ordinary = context.createMediaStreamDestination().stream
  // NOTICE: Only device direction/channel discovery is controlled; real stream
  // identity changes and production array-generation teardown run unchanged.
  vi.spyOn(uma.getAudioTracks()[0], 'label', 'get').mockReturnValue('UMA-8')
  vi.spyOn(uma.getAudioTracks()[0], 'applyConstraints').mockResolvedValue()
  vi.spyOn(ordinary.getAudioTracks()[0], 'applyConstraints').mockResolvedValue()
  try {
    await vi.waitFor(() => expect(f.audio.mode.value).toBe('standard'))
    await vi.waitFor(() => expect(f.audio.status.value).toBe('standard'))
    expect(f.audio.channelCount.value).toBe(2)
    f.input.value = uma
    await vi.waitFor(() => expect(f.audio.mode.value).toBe('mask'))
    expect(f.audio.channelCount.value).toBe(8)
    expect(f.audio.pcmSource.value).toBe(processed)
    f.input.value = ordinary
    await vi.waitFor(() => expect(f.audio.status.value).toBe('standard'))
    expect(f.audio.channelCount.value).toBe(2)
    expect(f.audio.pcmSource.value).toBeUndefined()
    expect(processed.dispose).toHaveBeenCalledOnce()
  }
  finally {
    await f.close()
    uma.getTracks().forEach(track => track.stop())
    ordinary.getTracks().forEach(track => track.stop())
    await context.close()
  }
})
it('reports the standard capture channel count after an eight-channel Mask failure', async () => {
  vi.mocked(inspectChannels).mockResolvedValueOnce(8).mockResolvedValue(1)
  vi.mocked(createSpatialInput).mockRejectedValue(new Error('DSP failed'))
  const f = fixture()
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('fallback'))
    expect(f.audio.channelCount.value).toBe(1)
    expect(f.audio.mode.value).toBe('standard')
    expect(f.audio.inputGainDb.value).toBe(0)
  }
  finally { await f.close() }
})
