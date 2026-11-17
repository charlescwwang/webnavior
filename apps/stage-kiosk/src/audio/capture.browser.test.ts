import { expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'

import { playKioskAudio } from '../services/kioskPlayback'
import { createSpeechPlayer } from '../services/kioskSpeech'
import { createArrayCapture } from './capture'
import { attachReferencePlayback, playbackReferenceContext } from './playbackReference'
import { defaultLcmv } from './tuning'

it('runs eight discrete channels through real AEC3 WASM, LCMV and source-clocked 16 kHz output', async () => {
  const context = new AudioContext({ sampleRate: 48000 })
  const merger = context.createChannelMerger(8)
  const oscillators = Array.from({ length: 8 }, (_, channel) => {
    const oscillator = context.createOscillator()
    oscillator.frequency.value = 300 + channel * 100
    const gain = context.createGain()
    gain.gain.value = 0.01
    oscillator.connect(gain).connect(merger, 0, channel)
    oscillator.start()
    return oscillator
  })
  const controller = new AbortController()
  const packets: Array<{ raw: Float32Array, mask: Float32Array, endTimeMs: number }> = []
  const errors: string[] = []
  let capture: Awaited<ReturnType<typeof createArrayCapture>> | undefined
  const button = document.createElement('button')
  button.textContent = 'Start UMA-8 synthetic capture'
  document.body.append(button)
  let starting: ReturnType<typeof createArrayCapture> | undefined
  button.onclick = () => {
    starting = createArrayCapture(context, merger, {
      channelMap: [0, 1, 2, 3, 4, 5, 6],
      radiusMm: 44,
      processing: { algorithm: 'lcmv', tuning: defaultLcmv },
      signal: controller.signal,
      onPcm: async (packet, endTimeMs) => { packets.push({ ...packet, endTimeMs }) },
      onError: reason => errors.push(reason),
    })
  }
  try {
    await userEvent.click(button)
    capture = await starting
    await expect.poll(() => packets.length, { timeout: 10000 }).toBeGreaterThan(8)
    expect(errors).toEqual([])
    expect(packets.every(packet => packet.raw.length === 512 && packet.mask.length === 512)).toBe(true)
    expect(packets.every(packet => packet.raw.every(Number.isFinite) && packet.mask.every(Number.isFinite))).toBe(true)
    expect(packets.some(packet => packet.raw.some(sample => Math.abs(sample) > 0.00001))).toBe(true)
    expect(packets[1]!.endTimeMs - packets[0]!.endTimeMs).toBeCloseTo(32, 6)
    expect(Math.abs(performance.now() - packets.at(-1)!.endTimeMs)).toBeLessThan(1000)
    const chimeResponse = await fetch(`${import.meta.env.BASE_URL}audio/kiosk_acknowledged_chime.wav`)
    const chime = (await chimeResponse.blob()).slice(0, undefined, 'audio/wav')
    const beforeCue = capture!.referenceSignalFrames
    const cue = playKioskAudio(chime, controller.signal)
    expect((await cue.finished).kind).toBe('ended')
    await expect.poll(() => capture!.referenceSignalFrames).toBeGreaterThan(beforeCue)
    const beforeTts = capture!.referenceSignalFrames
    const speech = createSpeechPlayer({ synthesize: async () => chime, onPlaying: () => {}, onSource: player => player ? attachReferencePlayback(player) : undefined })
    expect(await speech.play({ text: '您好。', locale: 'zh-TW', signal: controller.signal })).toBe('completed')
    await expect.poll(() => capture!.referenceSignalFrames).toBeGreaterThan(beforeTts)
    controller.abort()
    const stoppedAt = packets.length
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(packets.length).toBe(stoppedAt)
  }
  finally {
    controller.abort()
    capture?.dispose()
    button.remove()
    oscillators.forEach(oscillator => oscillator.stop())
    await context.close()
  }
}, 25000)

it.each([false, true])('runs Spatial Mask with AEC3=%s and releases its generation on abort', async (aec3Enabled) => {
  const context = new AudioContext({ sampleRate: 48000 })
  const merger = context.createChannelMerger(8)
  const source = context.createConstantSource()
  source.offset.value = 0.01
  for (let index = 0; index < 8; index++)
    source.connect(merger, 0, index)
  source.start()
  const controller = new AbortController()
  const packets: Array<{ offsetFrames: number, endTimeMs: number, samples: Float32Array }> = []
  const errors: string[] = []
  let capture: Awaited<ReturnType<typeof createArrayCapture>> | undefined
  const button = document.createElement('button')
  button.textContent = 'Start Spatial Mask'
  document.body.append(button)
  let starting: ReturnType<typeof createArrayCapture> | undefined
  button.onclick = () => {
    starting = createArrayCapture(context, merger, {
      channelMap: [6, 5, 4, 3, 2, 1, 0],
      radiusMm: 44,
      processing: { algorithm: 'spatial-mask', aec3Enabled },
      signal: controller.signal,
      onPcm: async (packet, endTimeMs) => { packets.push({ offsetFrames: packet.offsetFrames, endTimeMs, samples: packet.raw }) },
      onError: reason => errors.push(reason),
    })
  }
  try {
    await userEvent.click(button)
    capture = await starting
    await expect.poll(() => packets.length, { timeout: 10000 }).toBeGreaterThan(8)
    expect(errors).toEqual([])
    expect(Boolean(playbackReferenceContext())).toBe(aec3Enabled)
    expect(packets[0]!.offsetFrames).toBe(0)
    expect(packets.every((packet, index) => packet.offsetFrames === index * 512)).toBe(true)
    expect(packets.every(packet => packet.samples.length === 512 && packet.samples.every(Number.isFinite))).toBe(true)
    expect(packets[1]!.endTimeMs - packets[0]!.endTimeMs).toBeCloseTo(32, 6)
    expect(packets.some(packet => packet.samples.some(sample => Math.abs(sample) > 0.00001))).toBe(true)
    if (!aec3Enabled) {
      // Disabled capture owns no render bus; playback cannot feed it accidentally.
      expect(capture!.referenceSignalFrames).toBe(0)
      expect(packets.at(-1)!.samples[300]).toBeCloseTo(0.01, 5)
    }
    controller.abort()
    const stoppedAt = packets.length
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(packets.length).toBe(stoppedAt)
    expect(playbackReferenceContext()).toBeUndefined()
  }
  finally {
    controller.abort()
    capture?.dispose()
    source.stop()
    button.remove()
    await context.close()
  }
}, 20000)

it('requires a 48 kHz source clock even when AEC3 and its reference bus are disabled', async () => {
  const context = new AudioContext({ sampleRate: 44100 })
  try {
    await expect(createArrayCapture(context, context.createGain(), {
      channelMap: [0, 1, 2, 3, 4, 5, 6],
      radiusMm: 44,
      processing: { algorithm: 'spatial-mask', aec3Enabled: false },
      signal: new AbortController().signal,
      onPcm: async () => {},
      onError: () => {},
    })).rejects.toThrow('48 kHz')
    expect(playbackReferenceContext()).toBeUndefined()
  }
  finally {
    await context.close()
  }
})
