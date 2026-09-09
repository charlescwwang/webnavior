import { afterEach, describe, expect, it, vi } from 'vitest'

import { startKioskRetentionSweep } from './retention-sweep'

describe('startKioskRetentionSweep', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs immediately, repeats on its schedule, and stops after disposal', async () => {
    vi.useFakeTimers()
    const purgeExpiredVisitorSessions = vi.fn(async () => 0)
    const sweep = startKioskRetentionSweep({ purgeExpiredVisitorSessions }, { intervalMs: 1_000 })

    await vi.runAllTicks()
    expect(purgeExpiredVisitorSessions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(purgeExpiredVisitorSessions).toHaveBeenCalledTimes(2)

    sweep.dispose()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(purgeExpiredVisitorSessions).toHaveBeenCalledTimes(2)
  })
})
