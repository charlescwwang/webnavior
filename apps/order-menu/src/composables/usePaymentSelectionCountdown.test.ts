import type { EffectScope } from 'vue'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { usePaymentSelectionCountdown } from './usePaymentSelectionCountdown'

const scopes: EffectScope[] = []
afterEach(() => {
  for (const scope of scopes.splice(0))
    scope.stop()
  vi.useRealTimers()
})

function selection() {
  vi.useFakeTimers()
  const active = shallowRef(true)
  const expire = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const remaining = scope.run(() => usePaymentSelectionCountdown(() => active.value, expire))!
  return { active, expire, scope, remaining }
}

describe('payment selection deadline', () => {
  // Report: this chat, 2026-11-04 — hidden 30-second timeout returned to order review.
  it('shows 60 seconds and returns exactly once at the visible deadline, never at 30 seconds', async () => {
    const f = selection()
    expect(f.remaining.value).toBe(60)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(f.remaining.value).toBe(30)
    expect(f.expire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(f.remaining.value).toBe(1)
    expect(f.expire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f.remaining.value).toBe(0)
    expect(f.expire).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.expire).toHaveBeenCalledOnce()
  })

  it('cancels the old deadline when selection ends and grants a fresh minute on return', async () => {
    const f = selection()
    await vi.advanceTimersByTimeAsync(59_999)
    f.active.value = false
    expect(f.remaining.value).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.expire).not.toHaveBeenCalled()
    f.active.value = true
    expect(f.remaining.value).toBe(60)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(f.expire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f.expire).toHaveBeenCalledOnce()
  })

  it('uses the actual deadline when a hidden tab resumes after throttled timers', async () => {
    const f = selection()
    vi.setSystemTime(Date.now() + 65_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(f.remaining.value).toBe(0)
    expect(f.expire).toHaveBeenCalledOnce()
  })

  it('never navigates after its owning page is disposed', async () => {
    const f = selection()
    await vi.advanceTimersByTimeAsync(59_999)
    f.scope.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.expire).not.toHaveBeenCalled()
  })
})
