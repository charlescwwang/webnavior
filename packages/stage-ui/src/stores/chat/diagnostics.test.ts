import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useChatDiagnosticsStore } from './diagnostics'

describe('useChatDiagnosticsStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('reports a missing final response when a tool result has no following text', () => {
    const diagnostics = useChatDiagnosticsStore()

    diagnostics.startRound()
    diagnostics.recordEvent({ type: 'tool-call', toolName: 'cart_add_item', toolCallId: 'call-1', input: {} })
    diagnostics.recordEvent({ type: 'tool-result', toolCallId: 'call-1', result: '{}' })
    diagnostics.completeRound()

    expect(diagnostics.latest.status).toBe('missing-final-response')
  })

  it('reports completion when the model replies after the final tool result', () => {
    const diagnostics = useChatDiagnosticsStore()

    diagnostics.startRound()
    diagnostics.recordEvent({ type: 'tool-call', toolName: 'cart_add_item', toolCallId: 'call-1', input: {} })
    diagnostics.recordEvent({ type: 'tool-result', toolCallId: 'call-1', result: '{}' })
    diagnostics.recordEvent({ type: 'text-delta', text: '雞排已加入購物車。' })
    diagnostics.completeRound()

    expect(diagnostics.latest.status).toBe('completed')
  })
})
