import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'
import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { createMenuToolRuntime } from './webmcp'

const original = '我要炒鱔魚意麵，小辣不要香菜，還要一碗牛肉麵小辣，還要一個排骨便當，總共3樣'

async function replay(transcript: string, uncertain = false) {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript })
  // The attachment begins AFTER the initial ADD path entered clarification.
  // Reconstruct that observed state without claiming the missing first Jev
  // choice was captured; only the following route/relation choices are frozen.
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '對' }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
  const first = context.candidates[0]!
  const decision = await decideInteraction({
    transcript: '對',
    policy: { decisionInstruction: '', storeInstruction: '' },
    candidates: context.candidates,
    decisionState: context,
    conversation: { messages: [{ role: 'user', content: transcript }, { role: 'assistant', content: context.waitingFor!.question }] },
    invoke: async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: { choice: first.id, confidence: 0.8694 } } }
      : { answers: { relation: { choice: uncertain ? 'UNCERTAIN' : first.id, confidence: uncertain ? 0.95 : 0.7259 } } },
  })
  if (decision.kind === 'FAST_ACTION')
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId })
  return { context, decision, cart: await runtime.invoke('cart_get', { display: false }) }
}

describe('multiple meals treated as single-target clarification diagnosis', () => {
  // Report: local customer attachment fedc8278-d9eb-4c98-87cf-49410f34fd88, no public URL.
  // NOTICE: This expected-safe replay remains opt-in red. Frozen model choices
  // test the current authorization contract, not live model accuracy.
  it.skipIf(process.env.KIOSK_CLARIFICATION_DIAGNOSIS !== '1')('does not authorize the first dish from 對 to a question naming two requested dishes', async () => {
    const result = await replay(original)
    expect(result.decision.kind).not.toBe('FAST_ACTION')
  })

  it.each([original, '牛肉麵一碗，還要一個排骨便當'])('reproduces the single-target question and one-meal execution for %s', async (transcript) => {
    const result = await replay(transcript)
    expect(result.context.waitingFor?.question).toBe('您指的是炸排骨便當、紅燒牛肉麵？')
    expect(result.context.candidates.map(candidate => candidate.description)).toEqual(['顧客指的是炸排骨便當。', '顧客指的是紅燒牛肉麵。', '顧客取消這次待釐清的需求；保留購物車。'])
    expect(result.decision).toMatchObject({ kind: 'FAST_ACTION', confidence: 0.7259 })
    expect(result.cart).toMatchObject({ cart: { lines: [{ itemId: 'fried-pork-chop-bento' }] } })
  })

  it('does not execute the first dish when the concrete answer remains uncertain', async () => {
    const result = await replay('牛肉麵一碗，還要一個排骨便當', true)
    expect(result.decision).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })
    expect(result.cart).toMatchObject({ cart: { lines: [] } })
  })
})
