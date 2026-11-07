import { describe, expect, it, vi } from 'vitest'

import { createFixedGreetings, greetingPhase } from './fixedGreetings'

describe('fixed welcome playback', () => {
  it('prepares speech once, rotates openings, and reuses audio across visitors', async () => {
    const synthesize = vi.fn(async ({ text }: { text: string }) => new Blob([text]))
    const greetings = createFixedGreetings(synthesize)
    await greetings.prepare({ locale: 'zh-TW', openings: ['歡迎光臨蝦捲！', '您好，歡迎來到蝦捲！'], entryHint: '手機可選填或略過。' })

    const first = await greetings.next('customer_entry')
    const second = await greetings.next('customer_entry')
    const third = await greetings.next('customer_entry')
    expect(first.text).toBe('歡迎光臨蝦捲！手機可選填或略過。')
    expect(second.text).toBe('您好，歡迎來到蝦捲！手機可選填或略過。')
    expect(third.audio).toBe(first.audio)
    expect(synthesize).toHaveBeenCalledTimes(4)
    expect((await greetings.next('ordering')).text).toBe('您好，歡迎來到蝦捲！')
    greetings.dispose()
  })

  it('shares a cold synthesis with playback and retries failed preparation', async () => {
    let release: (audio: Blob) => void = () => {}
    const synthesize = vi.fn().mockImplementationOnce(() => new Promise<Blob>((resolve) => {
      release = resolve
    })).mockResolvedValue(new Blob(['audio']))
    const greetings = createFixedGreetings(synthesize)
    const warming = greetings.prepare({ locale: 'zh-TW', openings: ['歡迎！'], entryHint: '可略過。' })
    const speaking = greetings.next('customer_entry')
    expect(synthesize).toHaveBeenCalledTimes(1)
    release(new Blob(['welcome']))
    await warming
    await speaking
    expect(synthesize).toHaveBeenCalledTimes(2)
    greetings.dispose()

    const flaky = vi.fn().mockRejectedValueOnce(new Error('TTS unavailable')).mockResolvedValue(new Blob(['retry']))
    const retried = createFixedGreetings(flaky)
    await retried.prepare({ locale: 'zh-TW', openings: ['歡迎！'], entryHint: '可略過。' })
    const result = await retried.next('customer_entry')
    expect(result.text).toBe('歡迎！可略過。')
    expect(flaky).toHaveBeenCalledTimes(3)
    retried.dispose()
  })

  it('invalidates old audio and cancels preparation when configuration changes or the scene closes', async () => {
    const signals: AbortSignal[] = []
    const synthesize = vi.fn(async (input: { signal: AbortSignal, text: string }) => {
      signals.push(input.signal)
      return new Blob([input.text])
    })
    const greetings = createFixedGreetings(synthesize)
    const config = { locale: 'zh-TW', openings: ['歡迎！'], entryHint: '可略過。' }
    await greetings.prepare(config)
    await greetings.prepare(config)
    expect(synthesize).toHaveBeenCalledTimes(2)
    await greetings.prepare({ ...config, locale: 'en' })
    expect(signals[0].aborted).toBe(true)
    expect(synthesize).toHaveBeenCalledTimes(4)
    await greetings.prepare(undefined)
    expect(signals.at(-1)?.aborted).toBe(true)
    await expect(greetings.next('ordering')).rejects.toThrow('Welcome phrases are not configured')
    await greetings.prepare(config)
    expect(synthesize).toHaveBeenCalledTimes(6)
    greetings.dispose()
    expect(signals.at(-1)?.aborted).toBe(true)
  })

  it('allows entry and menu welcomes while preserving question and checkout guards', () => {
    expect(greetingPhase({ phase: 'customer_entry' })).toBe('customer_entry')
    expect(greetingPhase({ phase: 'ordering' })).toBe('ordering')
    expect(greetingPhase({ phase: 'ordering', waitingFor: { questionId: 'q1', purpose: 'checkout-entry', question: '要結帳嗎？', choices: [], expiresAt: Date.now() + 30_000 } })).toBeUndefined()
    expect(greetingPhase({ phase: 'checkout_invoice' })).toBeUndefined()
    expect(greetingPhase({ phase: 'payment_locked' })).toBeUndefined()
    expect(greetingPhase(undefined)).toBeUndefined()
  })
})

// Report: this chat,2026-11-06 — visitors should hear a concise welcome without audio training.
it('warms and plays only the welcome and ordering invitation', async () => {
  const synthesize = vi.fn(async () => new Blob(['welcome']))
  const greetings = createFixedGreetings(synthesize)
  await greetings.prepare({ locale: 'zh-TW', openings: ['歡迎光臨！'], entryHint: '手機可略過。' })
  const welcome = await greetings.next('customer_entry')
  expect(welcome.text).toBe('歡迎光臨！手機可略過。')
  expect(synthesize).toHaveBeenCalledTimes(2)
  greetings.dispose()
})

// Report: this chat,2026-11-06 — the operator owns the Taiwanese ordering hint.
it('preserves configured welcome text in both warmup and playback without appending a language hint', async () => {
  const synthesize = vi.fn(async ({ text }: { text: string }) => new Blob([text]))
  const greetings = createFixedGreetings(synthesize)
  const opening = '歡迎光臨！這裡也可以用臺語點餐，今天想吃什麼？'
  await greetings.prepare({ locale: 'zh-TW', openings: [opening], entryHint: '手機可略過。' })
  const ordering = await greetings.next('ordering')
  expect(ordering.text).toBe(opening)
  const entry = await greetings.next('customer_entry')
  expect(entry.text).toBe(`${opening}手機可略過。`)
  expect(synthesize.mock.calls.map(([input]) => input.text)).toEqual([`${opening}手機可略過。`, opening])
  greetings.dispose()
})
