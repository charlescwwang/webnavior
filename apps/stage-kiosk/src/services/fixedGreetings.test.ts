import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { describe, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { createFixedGreetings, createGreetingDelivery, greetingPhase, readGreetingPhase } from './fixedGreetings'

// Report: this chat, 2026-11-17 — Windows DEV-904267 detects visitors but never welcomes them.
it('reads PB table and menu pages without requiring the owned-menu state tool', async () => {
  const tool: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn().mockResolvedValue({ ok: true, source: 'browser', page: 'table', code: 'table-selection-required' })
  const client = { tools: readonly(shallowRef<readonly ServiceTool[]>([tool])), execute }
  await expect(readGreetingPhase(client, () => false)).resolves.toBe('ordering')
  await expect(readGreetingPhase(client, () => false, 'reminder')).resolves.toBeUndefined()
  execute.mockResolvedValue({ ok: true, source: 'browser', page: 'menu', menuReady: true, itemSelectionOpen: false })
  await expect(readGreetingPhase(client, () => false)).resolves.toBe('ordering')
  expect(execute).toHaveBeenCalledWith(tool, { includeCatalog: false })
  for (const facts of [
    { ok: true, source: 'browser', page: 'cart' },
    { ok: true, source: 'browser', page: 'menu', menuReady: true, itemSelectionOpen: true },
    { ok: false, source: 'browser', page: 'menu', menuReady: true },
  ]) {
    execute.mockResolvedValue(facts)
    await expect(readGreetingPhase(client, () => false)).resolves.toBeUndefined()
  }
  execute.mockClear()
  await expect(readGreetingPhase(client, () => true)).resolves.toBeUndefined()
  expect(execute).not.toHaveBeenCalled()
})

it('rechecks pending questions after a read and keeps owned-menu entry behavior', async () => {
  const tool: ServiceTool = { name: 'kiosk_interaction_state', description: '', inputSchema: { type: 'object' }, origin: 'https://menu.test' }
  let pending = false
  const execute = vi.fn(async () => ({ phase: 'customer_entry' }))
  const client = { tools: readonly(shallowRef<readonly ServiceTool[]>([tool])), execute }
  await expect(readGreetingPhase(client, () => pending)).resolves.toBe('customer_entry')
  execute.mockImplementationOnce(async () => {
    pending = true
    return { phase: 'ordering' }
  })
  await expect(readGreetingPhase(client, () => pending)).resolves.toBeUndefined()
})

describe('fixed welcome playback', () => {
  // Report: this chat, 2026-11-18 — DEV-757106's welcome briefly starts,
  // then vanishes and leaves an active reception without another attempt.
  it('retries an interrupted welcome in the same reception with a bounded budget', () => {
    const delivery = createGreetingDelivery()
    const first = delivery.claim(1, 0)!
    expect(first).toBeDefined()
    expect(delivery.claim(1, 10)).toBeUndefined()
    delivery.finish(first, 'retry', 100)
    expect(delivery.canRetry(1, 1000)).toBe(false)
    expect(delivery.canRetry(1, 1700)).toBe(true)
    const second = delivery.claim(1, 1700)!
    delivery.finish(first, 'delivered', 1750)
    delivery.finish(second, 'retry', 1800)
    const third = delivery.claim(1, 3500)!
    delivery.finish(third, 'retry', 3600)
    expect(delivery.canRetry(1, 6000)).toBe(false)
    expect(delivery.claim(1, 6000)).toBeUndefined()
  })

  it('never retries after delivery, customer activity, expiration or a reception reset', () => {
    const delivery = createGreetingDelivery()
    const first = delivery.claim(1, 0)!
    delivery.finish(first, 'delivered', 100)
    expect(delivery.canRetry(1, 2000)).toBe(false)
    const second = delivery.claim(2, 3000)!
    delivery.finish(second, 'retry', 3100)
    delivery.cancel()
    expect(delivery.canRetry(2, 6000)).toBe(false)
    const third = delivery.claim(3, 7000)!
    delivery.finish(third, 'retry', 7100)
    expect(delivery.canRetry(4, 10000)).toBe(false)
    expect(delivery.canRetry(3, 30000)).toBe(false)
  })

  it('releases a cancelled visitor while keeping shared welcome synthesis reusable', async () => {
    let finish!: (audio: Blob) => void
    const greetings = createFixedGreetings(() => new Promise<Blob>(resolve => finish = resolve))
    const warming = greetings.prepare({ locale: 'zh-TW', openings: ['您好'], entryHint: '' })
    const controller = new AbortController()
    const pending = greetings.next('ordering', controller.signal)
    const rejected = expect(pending).rejects.toThrow()
    controller.abort()
    await rejected
    finish(new Blob(['welcome']))
    await warming
    expect((await greetings.next('ordering')).text).toBe('您好')
    greetings.dispose()
  })
  it('prepares speech once, rotates openings, and reuses audio across visitors', async () => {
    const synthesize = vi.fn(async ({ text }: { text: string }) => new Blob([text]))
    const greetings = createFixedGreetings(synthesize)
    await greetings.prepare({ locale: 'zh-TW', openings: ['歡迎光臨周氏蝦捲！', '您好，歡迎來到周氏蝦捲！'], entryHint: '手機可選填或略過。' })

    const first = await greetings.next('customer_entry')
    const second = await greetings.next('customer_entry')
    const third = await greetings.next('customer_entry')
    expect(first.text).toBe('歡迎光臨周氏蝦捲！手機可選填或略過。')
    expect(second.text).toBe('您好，歡迎來到周氏蝦捲！手機可選填或略過。')
    expect(third.audio).toBe(first.audio)
    expect(synthesize).toHaveBeenCalledTimes(4)
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
