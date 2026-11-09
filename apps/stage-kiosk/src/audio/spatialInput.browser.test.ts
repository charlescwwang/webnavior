import { encodeComparisonRecording } from '@proj-airi/stage-shared/kiosk-audio'
import { expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { effectScope, ref } from 'vue'

import { useArrayMicrophone } from '../composables/useArrayMicrophone'
import { playKioskAudio } from '../services/kioskPlayback'
import { createSpatialInput } from './spatialInput'

async function fixture(channels = 8) {
  const context = new AudioContext({ sampleRate: 48000 })
  const destination = context.createMediaStreamDestination()
  destination.channelCount = channels
  destination.channelCountMode = 'explicit'
  destination.channelInterpretation = 'discrete'
  const source = context.createBufferSource()
  const buffer = context.createBuffer(channels, 48000, 48000)
  for (let ch = 0; ch < channels; ch++) {
    const samples = buffer.getChannelData(ch)
    for (let i = 0; i < samples.length; i++)
      samples[i] = 0.03 * Math.sin(2 * Math.PI * 1300 * i / 48000)
  }
  source.buffer = buffer
  source.loop = true
  source.connect(destination)
  source.start()
  const button = document.createElement('button')
  button.textContent = 'Enable synthetic input'
  button.onclick = () => {
    void context.resume()
  }
  document.body.append(button)
  await userEvent.click(button)
  button.remove()
  return { source, context, stream: destination.stream, async close() {
    destination.stream.getTracks().forEach(track => track.stop())
    await context.close()
  } }
}
it('transports real eight-channel Worklet audio through the Worker, serially drains all PCM and keeps its borrowed audio graph live', async () => {
  const f = await fixture()
  const errors: string[] = []
  const input = await createSpatialInput(f.source, { generation: 51, channelMap: [0, 1, 2, 3, 4, 5, 6], radiusMm: 45, onError: reason => errors.push(reason) })
  let count = 0
  let inFlight = 0
  let maximum = 0
  try {
    input.start(async (samples) => {
      inFlight++
      maximum = Math.max(maximum, inFlight)
      expect(samples.length).toBeLessThanOrEqual(512)
      expect(samples.every(Number.isFinite)).toBe(true)
      count += samples.length
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--
    })
    await vi.waitFor(() => expect(input.statistics.inputFrames).toBeGreaterThan(48000), { timeout: 6000 })
    await input.finish()
    expect(errors).toEqual([])
    expect(maximum).toBe(1)
    expect(count).toBe(Math.ceil(input.statistics.inputFrames / 3))
    expect(input.statistics.consumedFrames).toBe(count)
    expect(input.statistics.referenceLevel?.rmsDbfs).not.toBeNull()
    expect(input.statistics.referenceLevel?.peakDbfs).toBeLessThan(0)
    expect(input.statistics.maskLevel?.rmsDbfs).not.toBeNull()
    expect(f.context.state).toBe('running')
    const stopped = count
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(count).toBe(stopped)
  }
  finally {
    input.dispose()
    await f.close()
  }
}, 15000)

// Report: this chat, 2026-11-09 — a screenshot taken during reported TTS shows
// Gate. Exercise native media events through the real capture clock and Worker;
// synthetic playback/capture cannot reproduce physical loudspeaker echo.
it('follows actual native playback events into Binary and back to Gate across repeated replies', async () => {
  const f = await fixture()
  const errors: string[] = []
  const input = await createSpatialInput(f.source, { generation: 72, channelMap: [0, 1, 2, 3, 4, 5, 6], radiusMm: 45, processing: 'dynamic', onError: reason => errors.push(reason) })
  const audio = encodeComparisonRecording(new Float32Array(16000), { role: 'processed', channels: 1, frameCount: 16000, sampleRate: 16000 })
  let playback: ReturnType<typeof playKioskAudio> | undefined
  let count = 0
  try {
    input.start(async (samples) => {
      count += samples.length
    })
    await vi.waitFor(() => expect(input.statistics.outputFrames).toBeGreaterThan(512))
    for (let reply = 0; reply < 2; reply++) {
      playback = playKioskAudio(audio, new AbortController().signal, f.context, {
        loop: true,
        onPlaying: () => input.setPlayback(true),
        onStopped: () => input.setPlayback(false),
      })
      await vi.waitFor(() => expect(input.statistics.processingMode).toBe('binary'))
      expect(input.statistics.playbackTransitions).toBe(reply * 2 + 1)
      playback.stop()
      expect(await playback.finished).toEqual({ kind: 'stopped' })
      await vi.waitFor(() => expect(input.statistics.processingMode).toBe('gate'))
      expect(input.statistics.playbackTransitions).toBe(reply * 2 + 2)
    }
    await input.finish()
    expect(count).toBe(Math.ceil(input.statistics.inputFrames / 3))
    expect(input.statistics.consumedFrames).toBe(count)
    expect(errors).toEqual([])
  }
  finally {
    playback?.stop()
    input.dispose()
    await f.close()
  }
}, 15000)
it('fails boundedly when VAD cannot keep up, without silently skipping audio', async () => {
  const f = await fixture()
  const errors: string[] = []
  const input = await createSpatialInput(f.source, { generation: 52, channelMap: [0, 1, 2, 3, 4, 5, 6], radiusMm: 45, onError: reason => errors.push(reason) })
  const blocked = Promise.withResolvers<void>()
  try {
    input.start(() => blocked.promise)
    await vi.waitFor(() => expect(errors.some(reason => reason.includes('falling behind'))).toBe(true), { timeout: 7000 })
    expect(input.statistics.outputFrames - input.statistics.consumedFrames).toBeLessThanOrEqual(16512)
    expect(f.stream.getAudioTracks()[0].readyState).toBe('live')
  }
  finally {
    blocked.resolve()
    input.dispose()
    await f.close()
  }
}, 15000)
it('automatically uses ordinary mono capture without a suppression failure warning', async () => {
  localStorage.removeItem('kiosk/audio/array-mode')
  const f = await fixture(1)
  // NOTICE: Synthetic Web Audio tracks have no physical microphone DSP controls.
  // The actual stream and channel-count Worklet remain live in this test.
  const apply = vi.spyOn(f.stream.getAudioTracks()[0]!, 'applyConstraints').mockResolvedValue()
  const scope = effectScope()
  const enabled = ref(false)
  const audio = scope.run(() => useArrayMicrophone(ref(f.stream), enabled))!
  try {
    enabled.value = true
    await vi.waitFor(() => expect({ status: audio.status.value, error: audio.error.value }).toEqual({ status: 'standard', error: '' }), { timeout: 7000 })
    await vi.waitFor(() => expect(audio.stream.value).toBe(f.stream))
    expect(audio.pcmSource.value).toBeUndefined()
    expect(audio.error.value).toBe('')
    expect(f.stream.getAudioTracks()[0].readyState).toBe('live')
  }
  finally {
    scope.stop()
    apply.mockRestore()
    await f.close()
    localStorage.removeItem('kiosk/audio/array-mode')
  }
}, 15000)
it('records an aligned local raw/reference/mask interval with explicit 48k/16k clocks', async () => {
  const f = await fixture()
  const errors: string[] = []
  const input = await createSpatialInput(f.source, { generation: 53, channelMap: [0, 1, 2, 3, 4, 5, 6], radiusMm: 45, onError: reason => errors.push(reason) })
  try {
    input.start(async () => {
    })
    await vi.waitFor(() => expect(input.statistics.inputFrames).toBeGreaterThan(2048))
    const data = await input.recordComparison()
    expect(data.sampleStart).toBeGreaterThan(0)
    expect(data.sampleStart % 3).toBe(0)
    expect(data.raw.length).toBe(15 * 48000 * 8)
    expect(data.reference.length).toBe(15 * 16000)
    expect(data.processed.length).toBe(15 * 16000)
    expect(data.processed.every(Number.isFinite)).toBe(true)
    expect(data.raw.some(value => value !== 0)).toBe(true)
    expect(errors).toEqual([])
  }
  finally {
    input.dispose()
    await f.close()
  }
}, 25000)

// Opt-in wall-clock test; the default suite keeps its shorter transport checks.
it.runIf(import.meta.env.VITE_MASK_BROWSER_STRESS === 'true')('continues for130seconds without a hidden session cap or accumulating PCM', async () => {
  const f = await fixture()
  const errors: string[] = []
  const input = await createSpatialInput(f.source, { generation: 54, channelMap: [0, 1, 2, 3, 4, 5, 6], radiusMm: 45, onError: reason => errors.push(reason) })
  let received = 0
  try {
    input.start(async (samples) => {
      received += samples.length
    })
    for (let second = 0; second < 130; second++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      expect(errors).toEqual([])
      expect(input.statistics.lagSeconds).toBeLessThan(1)
    }
    await input.finish()
    expect(input.statistics.inputFrames).toBeGreaterThan(120 * 48000)
    expect(received).toBe(Math.ceil(input.statistics.inputFrames / 3))
    expect(input.statistics.consumedFrames).toBe(received)
  }
  finally {
    input.dispose()
    await f.close()
  }
}, 150000)

// Report: this chat,2026-11-07 — playback transitions must share capture's clock,
// and a partial capture block must not lose or duplicate microphone samples.
it('switches native playback state in one live Worker graph and drains a continuous PCM stream', async () => {
  const f = await fixture()
  const errors: string[] = []
  const input = await createSpatialInput(f.source, { generation: 71, channelMap: [0, 1, 2, 3, 4, 5, 6], radiusMm: 45, processing: 'dynamic', onError: reason => errors.push(reason) })
  let count = 0
  try {
    input.start(async (samples) => {
      count += samples.length
    })
    await vi.waitFor(() => expect(input.statistics.outputFrames).toBeGreaterThan(512))
    expect(input.statistics.processingMode).toBe('gate')
    input.setPlayback(true)
    await vi.waitFor(() => expect(input.statistics.processingMode).toBe('binary'))
    input.setPlayback(false)
    await vi.waitFor(() => expect(input.statistics.processingMode).toBe('tail'))
    await vi.waitFor(() => expect(input.statistics.processingMode).toBe('gate'))
    expect(input.statistics.playbackTransitions).toBe(2)
    await input.finish()
    expect(count).toBe(Math.ceil(input.statistics.inputFrames / 3))
    expect(input.statistics.consumedFrames).toBe(count)
    expect(errors).toEqual([])
    input.setPlayback(true) // retired graphs cannot feed a later capture generation
    expect(input.statistics.playbackTransitions).toBe(2)
  }
  finally {
    input.dispose()
    await f.close()
  }
}, 15000)
