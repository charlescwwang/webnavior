import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { createSpeechPlayer } from './kioskSpeech'

afterEach(() => document.body.replaceChildren())

// Silent, real WAV media exercises HTMLAudioElement lifecycle without replacing
// browser globals or depending on the configured merchant/audio provider.
function silence() {
  const buffer = new ArrayBuffer(844)
  const data = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, index) => data.setUint8(offset + index, char.charCodeAt(0)))
  text(0, 'RIFF')
  data.setUint32(4, 836, true)
  text(8, 'WAVEfmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true)
  data.setUint16(22, 1, true)
  data.setUint32(24, 8000, true)
  data.setUint32(28, 8000, true)
  data.setUint16(32, 1, true)
  data.setUint16(34, 8, true)
  text(36, 'data')
  data.setUint32(40, 800, true)
  new Uint8Array(buffer, 44).fill(128)
  return new Blob([buffer], { type: 'audio/wav' })
}
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
