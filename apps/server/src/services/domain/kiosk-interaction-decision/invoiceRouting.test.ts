import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const donation = { id: 'intent:choose-invoice:donation', description: '略過，捐贈發票；進入付款方式，尚不付款。', requiresHighConfidence: true }
const policy = { decisionInstruction: '', storeInstruction: '' }

describe('visible checkout phase without a spoken question', () => {
  // Report: this chat, 2026-10-19; retained session zloUV_0YpdMnMhQlGEFvp entries 7/9.
  it('grounds the short invoice command in the current checkout instead of earlier meal references', async () => {
    const invoke = vi.fn().mockResolvedValue({ answers: { route: { choice: donation.id, confidence: 0.95 } } })
    const result = await decideInteraction({
      transcript: '略過',
      policy,
      invoke,
      candidates: [donation],
      decisionState: { phase: 'checkout_invoice', checkoutSnapshot: { stage: 'invoice', carrierCode: '/SECRET', taxId: '12345678' }, references: [{ refId: 'ITEM_1', label: '剛展示的便當' }] },
    })

    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: donation.id })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(JSON.parse(invoke.mock.calls[0]![0])).toEqual({ customerUtterance: '略過', phase: 'checkout_invoice', checkout: { stage: 'invoice', hasCarrier: true, hasTaxId: true }, pendingQuestion: null })
    expect(invoke.mock.calls[0]![0]).not.toContain('剛展示的便當')
    expect(invoke.mock.calls[0]![0]).not.toContain('/SECRET')
    expect(invoke.mock.calls[0]![0]).not.toContain('12345678')
  })

  it('does not turn a weak invoice classification into execution authority', async () => {
    const invoke = vi.fn().mockResolvedValue({ answers: { route: { choice: donation.id, confidence: 0.4 } } })
    const result = await decideInteraction({ transcript: '略過', policy, invoke, candidates: [donation], decisionState: { phase: 'checkout_invoice', checkoutSnapshot: { stage: 'invoice' } } })

    expect(result.kind).toBe('UNAVAILABLE')
    expect(result).not.toHaveProperty('actionId')
  })
})
