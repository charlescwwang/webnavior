import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { effectScope } from 'vue'

import { useKioskInteractionTurn } from '../composables/useKioskInteractionTurn'
import { createSpeechPlayer } from './kioskSpeech'
import { createSpeechInterruption } from './speechInterruption'

afterEach(() => document.body.replaceChildren())

// Silent, real WAV media exercises HTMLAudioElement lifecycle without replacing
// browser globals or depending on the configured merchant/audio provider.
function silence(samples = 800) {
  const buffer = new ArrayBuffer(44 + samples)
  const data = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, index) => data.setUint8(offset + index, char.charCodeAt(0)))
  text(0, 'RIFF')
  data.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true)
  data.setUint16(22, 1, true)
  data.setUint32(24, 8000, true)
  data.setUint32(28, 8000, true)
  data.setUint16(32, 1, true)
  data.setUint16(34, 8, true)
  text(36, 'data')
  data.setUint32(40, samples, true)
  new Uint8Array(buffer, 44).fill(128)
  return new Blob([buffer], { type: 'audio/wav' })
}

// Report: this chat, 2026-11-17 — local interruption must stop real playback without cancelling the order or consulting a model.
it.each(['off', 'observe', 'enforce'] as const)('applies %s to local TTS interruption while preserving the active tool and speech candidate', async (mode) => {
  const scope = effectScope()
  const turn = scope.run(useKioskInteractionTurn)!
  const order = turn.begin('conversation', 'using-tool')
  const candidate = turn.beginCustomerVoiceCandidate()
  const interruption = createSpeechInterruption()
  interruption.begin(candidate.id)
  const onPlaying = vi.fn()
  let audio: HTMLAudioElement | undefined
  const player = createSpeechPlayer({ synthesize: async () => silence(16000), onPlaying, onSource: (source) => {
    audio = source
    source!.muted = true
    return undefined
  } })
  let playback: ReturnType<typeof player.play> | undefined
  const button = document.createElement('button')
  button.textContent = `開始 ${mode} 播放`
  button.onclick = () => {
    playback = player.play({ text: '正在處理餐點。', locale: 'zh-TW', signal: order.signal })
  }
  document.body.append(button)
  try {
    await page.getByRole('button', { name: button.textContent }).click()
    await vi.waitFor(() => expect(onPlaying).toHaveBeenCalledOnce())
    for (let time = 0; time <= 300; time += 50) {
      if (interruption.observe(candidate.id, time, 0.9, 0.5, true, mode))
        player.stop()
    }
    if (mode === 'enforce') {
      expect(audio!.paused).toBe(false)
      player.stop()
    }
    expect(await playback).toBe('cancelled')
    expect(audio!.paused).toBe(true)
    expect(order.signal.aborted).toBe(false)
    expect(turn.isCurrent(order)).toBe(true)
    expect(turn.isCurrentVoiceCandidate(candidate)).toBe(true)
    expect(turn.phase.value).toBe('using-tool')
  }
  finally {
    player.stop()
    scope.stop()
    button.remove()
  }
})
it('starts the first sentence while only the next sentence is prefetched and cancels its pending synthesis', async () => {
  const controller = new AbortController()
  const onPlaying = vi.fn()
  const onSynthesis = vi.fn()
  let nextSignal: AbortSignal | undefined
  const synthesize = vi.fn(async ({ text, signal }: { text: string, signal: AbortSignal }) => {
    if (text === '第一句。')
      return silence()
    nextSignal = signal
    return new Promise<Blob>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  })
  const player = createSpeechPlayer({ synthesize, onPlaying, onSynthesis, onSource: (audio) => {
    audio!.muted = true
    return undefined
  } })
  let pending: ReturnType<typeof player.play> | undefined
  const button = document.createElement('button')
  button.textContent = '播放測試'
  button.addEventListener('click', () => {
    pending = player.play({ text: '第一句。第二句。第三句。', locale: 'zh-TW', signal: controller.signal })
  })
  document.body.append(button)
  await page.getByRole('button', { name: '播放測試' }).click()
  await vi.waitFor(() => expect(onPlaying).toHaveBeenCalledWith('第一句。', true), { timeout: 5000 })
  expect(synthesize).toHaveBeenCalledTimes(2)
  expect(onSynthesis.mock.calls).toEqual([[0], [1]])
  controller.abort()
  expect(await pending).toBe('cancelled')
  expect(nextSignal!.aborted).toBe(true)
  expect(onPlaying).toHaveBeenCalledTimes(1)
})
it('plays a prepared long reply once without synthesizing duplicate trailing sentences', async () => {
  const synthesize = vi.fn(async () => silence())
  const onPlaying = vi.fn()
  const player = createSpeechPlayer({ synthesize, onPlaying, onSource: (audio) => {
    audio!.muted = true
    return undefined
  } })
  const text = '長回覆'.repeat(70)
  await player.play({ text, locale: 'zh-TW', signal: new AbortController().signal, preparedAudio: silence() })
  expect(synthesize).not.toHaveBeenCalled()
  expect(onPlaying).toHaveBeenCalledExactlyOnceWith(text, true)
})

// Report: this chat, Nov13; canceled synthesis can return after the next reception starts.
it('discards late old synthesis without clearing or aborting the replacement speech', async () => {
  let finishOld!: (audio: Blob) => void
  let finishNew!: (audio: Blob) => void
  let newSignal: AbortSignal | undefined
  const onPlaying = vi.fn()
  const onReady = vi.fn()
  const player = createSpeechPlayer({ synthesize: ({ text, signal }) => new Promise<Blob>((resolve) => {
    if (text === '舊回覆') {
      finishOld = resolve
    }
    else {
      newSignal = signal
      finishNew = resolve
    }
  }), onPlaying, onReady, onSource: () => undefined })
  const old = player.play({ text: '舊回覆', locale: 'zh-TW', signal: new AbortController().signal })
  player.stop()
  const next = player.play({ text: '新回覆', locale: 'zh-TW', signal: new AbortController().signal })
  finishOld(silence())
  expect(await old).toBe('cancelled')
  expect(newSignal!.aborted).toBe(false)
  expect(onReady).not.toHaveBeenCalled()
  expect(onPlaying).not.toHaveBeenCalled()
  player.stop()
  expect(newSignal!.aborted).toBe(true)
  finishNew(silence())
  expect(await next).toBe('cancelled')
})
