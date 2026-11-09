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
  localStorage.removeItem('kiosk/audio/dynamic-spatial-enabled')
})

function fixture(label = 'miniDSP UMA-8 v2', capture?: Parameters<typeof useArrayMicrophone>[3]) {
  const context = new AudioContext()
  const raw = context.createMediaStreamDestination().stream
  const track = raw.getAudioTracks()[0]!
  vi.spyOn(track, 'label', 'get').mockReturnValue(label)
  const apply = vi.spyOn(track, 'applyConstraints').mockResolvedValue()
  const scope = effectScope()
  const input = ref<MediaStream | undefined>(raw)
  const enabled = ref(true)
  const audio = scope.run(() => useArrayMicrophone(input, enabled, undefined, capture))!
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
    expect(f.audio.inputGainDb.value).toBe(0)
    expect(f.audio.earlyBargeIn.value).toBe(false)
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

it('keeps the dynamic trial gain fixed across TTS edges and removes it on standard fallback', async () => {
  localStorage.setItem('kiosk/audio/dynamic-spatial-enabled', 'true')
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
    expect(audio.inputGainDb.value).toBe(15)
    expect(audio.earlyBargeIn.value).toBe(true)
    playing.value = false
    expect(audio.inputGainDb.value).toBe(15)
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
it('retains an explicit operator disable and the soft path across restart', async () => {
  localStorage.setItem('kiosk/audio/dynamic-spatial-enabled', 'false')
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
    f.enabled.value = false
    f.enabled.value = true
    await vi.waitFor(() => expect(createSpatialInput).toHaveBeenCalledTimes(2))
    expect(vi.mocked(createSpatialInput).mock.calls[1][1].processing).toBe('soft')
    expect(f.audio.dynamicProcessing.value).toBe(false)
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

// Report: this chat Nov09 — applyConstraints can resolve without enabling Chrome audio processing.
it('requests standard reacquisition once and reports failure instead of retrying a processing-disabled fresh stream', async () => {
  vi.mocked(inspectChannels).mockResolvedValue(1)
  const mode = ref<'raw' | 'standard'>('raw')
  const requestStandardCapture = vi.fn()
  const f = fixture('Laptop microphone', { mode, requestStandardCapture })
  vi.spyOn(f.input.value!.getAudioTracks()[0]!, 'getSettings').mockReturnValue({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('reacquiring-standard'))
    expect(requestStandardCapture).toHaveBeenCalledOnce()
    expect(f.audio.stream.value).toBeUndefined()
    mode.value = 'standard'
    await vi.waitFor(() => expect(f.audio.status.value).toBe('error'))
    expect(requestStandardCapture).toHaveBeenCalledOnce()
    expect(f.audio.stream.value).toBeUndefined()
    expect(f.audio.error.value).toContain('瀏覽器未能啟用一般收音')
  }
  finally { await f.close() }
})

it('never requests standard processing for a verified eight-channel array', async () => {
  vi.mocked(inspectChannels).mockResolvedValue(8)
  vi.mocked(createSpatialInput).mockResolvedValue(processor())
  const requestStandardCapture = vi.fn()
  const f = fixture('Eight-channel array', { mode: ref('raw'), requestStandardCapture })
  vi.spyOn(f.input.value!.getAudioTracks()[0]!, 'getSettings').mockReturnValue({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('ready'))
    expect(f.audio.mode.value).toBe('mask')
    expect(requestStandardCapture).not.toHaveBeenCalled()
    expect(f.apply.mock.calls[0]![0]).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
  }
  finally { await f.close() }
})

it('keeps AEC-enabled standard capture usable when optional NS or AGC remains disabled', async () => {
  vi.mocked(inspectChannels).mockResolvedValue(1)
  const requestStandardCapture = vi.fn()
  const f = fixture('Laptop microphone', { mode: ref('standard'), requestStandardCapture })
  vi.spyOn(f.input.value!.getAudioTracks()[0]!, 'getSettings').mockReturnValue({ echoCancellation: true, noiseSuppression: false, autoGainControl: false })
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('standard'))
    expect(f.audio.stream.value).toBe(f.input.value)
    expect(requestStandardCapture).not.toHaveBeenCalled()
    expect(f.apply.mock.calls[0]![0]).toMatchObject({ echoCancellation: true })
  }
  finally { await f.close() }
})

// A delayed native constraint response belongs only to its original capture generation.
it('does not reacquire from a retired standard-processing check', async () => {
  vi.mocked(inspectChannels).mockResolvedValue(1)
  const pending = Promise.withResolvers<void>()
  const requestStandardCapture = vi.fn()
  const f = fixture('Laptop microphone', { mode: ref('raw'), requestStandardCapture })
  f.apply.mockResolvedValueOnce().mockImplementationOnce(() => pending.promise)
  vi.spyOn(f.input.value!.getAudioTracks()[0]!, 'getSettings').mockReturnValue({ echoCancellation: false })
  try {
    await vi.waitFor(() => expect(f.apply).toHaveBeenCalledTimes(2))
    f.enabled.value = false
    pending.resolve()
    await vi.waitFor(() => expect(f.audio.status.value).toBe('stopped'))
    await Promise.resolve()
    expect(requestStandardCapture).not.toHaveBeenCalled()
  }
  finally {
    pending.resolve()
    await f.close()
  }
})

// Report: this chat Nov09 — 8CH ready retained the old default-off preference,
// so TTS never selected the already-integrated Binary Mask playback path.
it.each([false, true])('defaults to dynamic processing after actual 8CH detection (old saved off: %s)', async (savedOff) => {
  if (savedOff)
    localStorage.setItem('kiosk/audio/dynamic-spatial', 'false')
  vi.mocked(inspectChannels).mockResolvedValue(8)
  vi.mocked(createSpatialInput).mockResolvedValue(processor())
  const f = fixture()
  try {
    await vi.waitFor(() => expect(f.audio.status.value).toBe('ready'))
    expect(f.audio.channelCount.value).toBe(8)
    expect(f.audio.dynamicProcessing.value).toBe(true)
    expect(vi.mocked(createSpatialInput).mock.calls[0][1].processing).toBe('dynamic')
    expect(f.audio.inputGainDb.value).toBe(15)
    expect(f.audio.earlyBargeIn.value).toBe(true)
    expect(createSpatialInput).toHaveBeenCalledOnce()
  }
  finally { await f.close() }
})
