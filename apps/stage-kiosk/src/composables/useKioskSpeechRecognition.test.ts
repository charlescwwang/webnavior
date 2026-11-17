import { afterEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useKioskSpeechRecognition } from './useKioskSpeechRecognition'

afterEach(() => vi.useRealTimers())

it('synchronizes mode changes and cancels old capture without changing accepted ordering state', async () => {
  vi.useFakeTimers()
  const legacy = { mode: 'legacy' as const, maxUtteranceSeconds: 15, timeoutMs: 60000 }
  const falcon = { ...legacy, mode: 'falcon' as const }
  const read = vi.fn().mockResolvedValueOnce(legacy).mockResolvedValueOnce(falcon).mockRejectedValueOnce(new Error('offline'))
  const scope = effectScope()
  const recognition = scope.run(() => useKioskSpeechRecognition(() => true, read))!
  expect(recognition.policy.value).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1)
  expect(recognition.policy.value).toEqual(legacy)
  const oldCapture = recognition.captureSignal.value
  await vi.advanceTimersByTimeAsync(10000)
  expect(oldCapture.aborted).toBe(true)
  expect(recognition.policy.value).toEqual(falcon)
  const currentCapture = recognition.captureSignal.value
  await vi.advanceTimersByTimeAsync(10000)
  expect(recognition.error.value).toBe(true)
  expect(recognition.policy.value).toEqual(falcon)
  expect(currentCapture.aborted).toBe(false)
  scope.stop()
  expect(currentCapture.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(10000)
  expect(read).toHaveBeenCalledTimes(3)
})

it('does not adopt a late policy response after the scene closes', async () => {
  let resolve!: (value: { mode: 'falcon', maxUtteranceSeconds: number, timeoutMs: number }) => void
  const read = () => new Promise<{ mode: 'falcon', maxUtteranceSeconds: number, timeoutMs: number }>(done => resolve = done)
  const scope = effectScope()
  const recognition = scope.run(() => useKioskSpeechRecognition(() => true, read))!
  scope.stop()
  resolve({ mode: 'falcon', maxUtteranceSeconds: 15, timeoutMs: 60000 })
  await Promise.resolve()
  expect(recognition.policy.value).toBeUndefined()
})
