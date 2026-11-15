import { expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useKioskVoiceTest } from './useKioskVoiceTest'

it('ignores a late operator transcription after closing and reopening the test', async () => {
  const scope = effectScope()
  const active = shallowRef(true)
  let finish!: (value: { text: string }) => void
  const transcribe = vi.fn(async () => new Promise<{ text: string }>(resolve => finish = resolve))
  const onResult = vi.fn()
  const test = scope.run(() => useKioskVoiceTest({ active, transcribe, synthesize: vi.fn(), locale: () => 'zh-TW', testText: () => 'test', onResult }))!
  try {
    const pending = test.transcribe(new Float32Array(1600))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    active.value = false
    active.value = true
    finish({ text: '舊測試結果' })
    await pending
    expect(onResult).toHaveBeenCalledWith({ status: 'recognizing' })
    expect(onResult).not.toHaveBeenCalledWith(expect.objectContaining({ text: '舊測試結果' }))
  }
  finally { scope.stop() }
})
it('never sends disabled operator audio to ASR or synthesis', async () => {
  const scope = effectScope()
  const transcribe = vi.fn()
  const synthesize = vi.fn()
  const test = scope.run(() => useKioskVoiceTest({ active: shallowRef(false), transcribe, synthesize, locale: () => 'zh-TW', testText: () => 'test', onResult: vi.fn() }))!
  try {
    await test.transcribe(new Float32Array(1600))
    await test.play()
    expect(transcribe).not.toHaveBeenCalled()
    expect(synthesize).not.toHaveBeenCalled()
  }
  finally { scope.stop() }
})
