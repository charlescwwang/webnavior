import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useKioskCartPreparation } from './useKioskCartPreparation'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))

// Report: this chat, 2026-11-17 — DEV-334570 cannot recover from a rejected preparation read.
it('retries a failed preparation in the same document without waiting for navigation', async () => {
  const scope = effectScope()
  cleanups.push(() => scope.stop())
  const context = shallowRef({ documentId: 'doc', serviceUrl: 'https://app.esgpb.com/menu', receptionState: 'active' as const })
  const prepare = vi.fn().mockRejectedValueOnce(new Error('temporary read failure')).mockResolvedValue('ready')
  const state = scope.run(() => useKioskCartPreparation({ context: () => context.value, prepare }))!
  await vi.waitFor(() => expect(state.failed.value).toBe(true))
  await state.retry()
  expect(state.failed.value).toBe(false)
  expect(state.pending.value).toBe(false)
  expect(prepare).toHaveBeenCalledTimes(2)
})

it('retires a pending preparation on navigation and ignores its late result', async () => {
  const scope = effectScope()
  cleanups.push(() => scope.stop())
  const context = shallowRef<{ documentId: string, serviceUrl: string, receptionState: 'active' } | undefined>({ documentId: 'old', serviceUrl: 'https://app.esgpb.com/menu', receptionState: 'active' })
  const deferred = Promise.withResolvers<void>()
  const state = scope.run(() => useKioskCartPreparation({ context: () => context.value, prepare: () => deferred.promise }))!
  expect(state.pending.value).toBe(true)
  context.value = undefined
  expect(state.pending.value).toBe(false)
  deferred.reject(new Error('retired read'))
  await Promise.resolve()
  expect(state.failed.value).toBe(false)
})

it('keeps failed reads blocked and refuses a retry after its document is gone', async () => {
  const scope = effectScope()
  cleanups.push(() => scope.stop())
  const context = shallowRef<{ documentId: string, serviceUrl: string, receptionState: 'active' } | undefined>({ documentId: 'doc', serviceUrl: 'https://app.esgpb.com/menu', receptionState: 'active' })
  const prepare = vi.fn(async () => {
    throw new Error('still unavailable')
  })
  const state = scope.run(() => useKioskCartPreparation({ context: () => context.value, prepare }))!
  await vi.waitFor(() => expect(state.failed.value).toBe(true))
  expect(await state.retry()).toBe(false)
  expect(state.failed.value).toBe(true)
  context.value = undefined
  expect(await state.retry()).toBe(false)
  expect(prepare).toHaveBeenCalledTimes(2)
})
