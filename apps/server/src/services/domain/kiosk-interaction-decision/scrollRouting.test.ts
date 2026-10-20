import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const candidates = [
  { id: 'intent:scroll-menu:up', description: '顯示較前段、更接近菜單開頭的內容。', requiresHighConfidence: true },
  { id: 'intent:scroll-menu:down', description: '顯示較後段、更接近菜單結尾的內容。', requiresHighConfidence: true },
]
const policy = { decisionInstruction: '', storeInstruction: '' }

describe('menu scrolling direction', () => {
  // Report: this chat, 2026-10-19; session NOSb3gdRfHaSE-uu_s7wB entry 3 chose UP for 往下一點 at .8065.
  it.each([
    { transcript: '往下一點', proposed: 'up', destination: 'LATER', expected: 'down' },
    { transcript: '往上一點', proposed: 'down', destination: 'EARLIER', expected: 'up' },
  ])('verifies the direction of $transcript independently of the initial route', async ({ transcript, proposed, destination, expected }) => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: `intent:scroll-menu:${proposed}`, confidence: 0.8065 } } })
      .mockResolvedValueOnce({ answers: { destination: { choice: destination, confidence: 0.95 } } })
    const result = await decideInteraction({ transcript, policy, candidates, invoke, includeTrace: true, decisionState: { phase: 'ordering' } })

    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: `intent:scroll-menu:${expected}` })
    expect(result).toHaveProperty('trace.rawAnswer.choice', `intent:scroll-menu:${proposed}`)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(JSON.parse(invoke.mock.calls[1]![0])).toEqual({ customerUtterance: transcript })
  })

  it.each([
    { choice: 'LATER', confidence: 0.4 },
    { choice: 'OTHER', confidence: 0.95 },
  ])('does not scroll when direction is unverified: $choice at $confidence', async (destination) => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { route: { choice: candidates[0]!.id, confidence: 0.9 } } })
      .mockResolvedValueOnce({ answers: { destination } })
    const result = await decideInteraction({ transcript: '小陳，往下一點', policy, candidates, invoke, decisionState: { phase: 'ordering' } })

    expect(result.kind).toBe('UNAVAILABLE')
    expect(result).not.toHaveProperty('actionId')
  })
})
