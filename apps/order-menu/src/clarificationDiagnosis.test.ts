import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'
import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { createMenuToolRuntime } from './webmcp'

const original = '我要炒鱔魚意麵，小辣不要香菜，還要一碗牛肉麵小辣，還要一個排骨便當，總共3樣'

async function replay(transcript: string, uncertain = false, service: 'REQUEST' | 'UNCERTAIN' | 'INVALID' = 'REQUEST', recipient: 'KIOSK' | 'OTHER' | 'UNCERTAIN' = 'KIOSK') {
  const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
  const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_fast_path_context', { transcript })
  // The recorded route/relation scores are exercised against a real ambiguous
  // category. Compound requests must no longer create that single-choice state.
  await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const answer = uncertain ? '呃' : '對'
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript: answer }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
  const first = context.candidates[0]!
  const decision = await decideInteraction({
    transcript: answer,
    policy: { decisionInstruction: '', storeInstruction: '' },
    candidates: context.candidates,
    decisionState: context,
    conversation: { messages: [{ role: 'user', content: transcript }, { role: 'assistant', content: context.waitingFor!.question }] },
    invoke: async (_state: string, questions: Record<string, unknown>) => {
      if (questions.route)
        return { answers: { route: { choice: first.id, confidence: 0.8694 } } }
      if (questions.relation)
        return { answers: { relation: { choice: uncertain ? 'UNCERTAIN' : first.id, confidence: uncertain ? 0.95 : 0.7259 } } }
      if (questions.serviceRequest)
        return service === 'INVALID' ? { answers: {} } : { answers: { serviceRequest: { choice: service, confidence: 0.95 } } }
      if (questions.recipient)
        return { answers: { recipient: { choice: recipient, confidence: 0.95 } } }
      throw new Error('Unexpected decision question')
    },
  })
  if (decision.kind === 'FAST_ACTION')
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId })
  return { context, decision, runtime, cart: await runtime.invoke('cart_get', { display: false }) }
}

describe('multiple meals treated as single-target clarification diagnosis', () => {
  // Report: local customer attachment fedc8278-d9eb-4c98-87cf-49410f34fd88, no public URL.
  it.each([original, '牛肉麵一碗，還要一個排骨便當'])('does not turn a compound order into a single-target question even when the route incorrectly chooses ADD: %s', async (transcript) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    expect(result).toMatchObject({ needsAssistant: true, handoff: { intent: 'ADD_ITEM', itemIds: expect.arrayContaining(['beef-noodle-soup', 'fried-pork-chop-bento']) } })
    expect(result).not.toHaveProperty('pendingClarification')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [] } })
  })

  it('does not let a high-confidence provider turn 對 into the first choice of a real single-target question', async () => {
    const result = await replay('我要一份便當')
    expect(result.decision.kind).toBe('CLARIFICATION')
    expect(result.cart).toMatchObject({ cart: { lines: [] } })
    expect(result.context.waitingFor!.question).toContain('其中一項')
    const next = await result.runtime.invoke('kiosk_fast_path_context', { transcript: '第二項' }) as { resolvedCandidateId: string }
    expect(await result.runtime.invoke('kiosk_fast_path_execute', { candidateId: next.resolvedCandidateId })).toMatchObject({ cart: { itemCount: 1 } })
  })

  it.each(['對', '是的。', '好，', '沒錯', 'yes'])('rejects a direct first-target execution for a bare acknowledgement: %s', async (transcript) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我要一份便當' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as { candidates: Array<{ id: string }> }
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: context.candidates[0]!.id })).rejects.toThrow('does not identify')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [] } })
  })

  it.each([{ recipient: 'OTHER', expected: 'IGNORE' }, { recipient: 'UNCERTAIN', expected: 'UNAVAILABLE' }] as const)('does not ask a target question for acknowledgement addressed to $recipient', async ({ recipient, expected }) => {
    const result = await replay('我要一份便當', false, 'REQUEST', recipient)
    expect(result.decision.kind).toBe(expected)
    expect(result.cart).toMatchObject({ cart: { lines: [] } })
  })

  it.each([original, '牛肉麵一碗，還要一個排骨便當'])('hands off the complete compound request without choosing its first dish: %s', async (transcript) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const decision = await decideInteraction({ transcript, candidates: context.candidates, decisionState: context, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (_state, questions) => {
      if (questions.route)
        return { answers: { route: { choice: 'MULTI_ACTION', confidence: 0.99 } } }
      if (questions.recipient)
        return { answers: { recipient: { choice: 'KIOSK', confidence: 0.99 } } }
      throw new Error('Unexpected question')
    } })
    expect(decision.kind).toBe('NEEDS_ASSISTANT')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [] } })
  })

  it('does not execute the first dish when the concrete answer remains uncertain', async () => {
    const result = await replay('我要一份便當', true)
    expect(result.decision).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
    expect(result.cart).toMatchObject({ cart: { lines: [] } })
  })
  it.each(['UNCERTAIN', 'INVALID'] as const)('keeps an uncertain answer unexecuted when service admission is %s', async (service) => {
    const result = await replay('我要一份便當', true, service)
    expect(result.decision).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })
    expect(result.decision.recovery?.status).toBe(service === 'UNCERTAIN' ? 'eligible' : 'failed')
    expect(result.cart).toMatchObject({ cart: { lines: [] } })
  })
})
