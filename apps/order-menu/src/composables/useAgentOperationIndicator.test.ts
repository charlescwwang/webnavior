import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAgentOperationIndicator } from './useAgentOperationIndicator'

describe('useAgentOperationIndicator', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps a synchronously completed WebMCP operation visible long enough to render', () => {
    vi.useFakeTimers()
    const indicator = useAgentOperationIndicator({ minimumVisibleMs: 600 })

    indicator.start()
    indicator.end()

    expect(indicator.isOperating.value).toBe(true)

    vi.advanceTimersByTime(599)
    expect(indicator.isOperating.value).toBe(true)

    vi.advanceTimersByTime(1)
    expect(indicator.isOperating.value).toBe(false)
  })

  it('does not hide a later operation when an earlier visibility lease ends', () => {
    vi.useFakeTimers()
    const indicator = useAgentOperationIndicator({ minimumVisibleMs: 600 })

    indicator.start()
    indicator.end()
    indicator.start()

    vi.advanceTimersByTime(600)
    expect(indicator.isOperating.value).toBe(true)

    indicator.end()
    vi.advanceTimersByTime(600)
    expect(indicator.isOperating.value).toBe(false)
  })
})
