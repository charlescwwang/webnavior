import { expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

// Report: docs/plans/2026-10-22-kiosk-field-investigation.md, repeated 好/謝謝 greetings.
it.each(['好', '好的。', '謝謝', '了解'])('keeps standalone acknowledgement %s silent without an actionable question', async (transcript) => {
  const invoke = vi.fn(async () => ({ answers: { service: { choice: 'HELLO_ONLY', confidence: 0.94 } } }))
  expect(await decideInteraction({ transcript, candidates: [], decisionState: { phase: 'customer_entry' }, invoke, policy: { decisionInstruction: '', storeInstruction: '' } })).toMatchObject({ kind: 'IGNORE' })
  expect(invoke).not.toHaveBeenCalled()
})
