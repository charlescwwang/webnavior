import type { EffectScope } from 'vue'

import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useKioskServiceRecovery } from './useKioskServiceRecovery'

const scopes: EffectScope[] = []
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.useRealTimers()
})

function setup(recover: (isCurrent: () => boolean) => Promise<void>) {
  vi.useFakeTimers()
  const blocked = shallowRef(true)
  const busy = shallowRef(false)
  const context = shallowRef('visitor:document')
  const scope = effectScope()
  scopes.push(scope)
  const state = scope.run(() => useKioskServiceRecovery({ blocked: () => blocked.value, busy: () => busy.value, context: () => context.value, recover }))!
  return { blocked, busy, context, scope, state }
}

// Report: this chat, Nov17 — customers must not press a recovery button to continue ordering.
it('automatically verifies after active work ends and stops after success', async () => {
  const recover = vi.fn<(current: () => boolean) => Promise<void>>()
  const { blocked, busy, state } = setup(recover)
  recover.mockImplementation(async (current) => {
    expect(current()).toBe(true)
    blocked.value = false
  })
  busy.value = true
  await vi.advanceTimersByTimeAsync(5000)
  expect(recover).not.toHaveBeenCalled()
  busy.value = false
  await vi.advanceTimersByTimeAsync(500)
  expect(recover).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(10000)
  expect(recover).toHaveBeenCalledOnce()
  expect(state.exhausted.value).toBe(false)
})

it('bounds failed checks and invalidates a late result after reception changes or disposal', async () => {
  const recover = vi.fn(async (_current: () => boolean) => {})
  const { context, scope, state } = setup(recover)
  await vi.advanceTimersByTimeAsync(10000)
  expect(recover).toHaveBeenCalledTimes(3)
  expect(state.exhausted.value).toBe(true)
  let late!: () => boolean
  let finish!: () => void
  recover.mockImplementationOnce(async (current) => {
    late = current
    await new Promise<void>(resolve => finish = resolve)
  })
  context.value = 'another-visitor:document'
  expect(state.exhausted.value).toBe(false)
  await vi.advanceTimersByTimeAsync(500)
  expect(late()).toBe(true)
  context.value = 'third-visitor:document'
  expect(late()).toBe(false)
  scope.stop()
  finish()
  await vi.advanceTimersByTimeAsync(10000)
  expect(recover).toHaveBeenCalledTimes(4)
})
