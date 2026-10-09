import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'
import type { SystemOneQuestion } from '../../server/src/services/domain/kiosk-system-one'

import { describe, expect, it } from 'vitest'

import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL
const cases = [
  { text: '100元以下的便當有哪些', choice: 'UPPER_INCLUSIVE' },
  { text: '不到100元的便當有哪些', choice: 'UPPER_EXCLUSIVE' },
  { text: '推薦80到120元的便當', choice: 'RANGE' },
  { text: '推薦最便宜的便當', choice: 'ASC' },
  { text: '便當0多少錢', choice: 'INFORMATION' },
  { text: '推薦100元左右的便當', choice: 'UNSUPPORTED' },
]

// Opt-in external-provider integration. Only this synthetic catalog/dialogue is
// sent; no customer logs, production setting changes, POS or payment gateway.
describe.skipIf(!replayUrl)('live price interpretation', () => {
  it.each(cases)('$text', async ({ text, choice }) => {
    const dishes = [120, 80, 100, 90, 180, 70, 60].map((price, index) => ({ ...menu[0]!, id: `dish-${index}`, name: `便當${index}`, aliases: [], category: '便當', price, optionGroups: [] }))
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const state = await runtime.invoke('kiosk_fast_path_context', { transcript: text }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const decision = await decideInteraction({ transcript: text, candidates: state.candidates, decisionState: state, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (state, questions: Record<string, SystemOneQuestion>) => {
      const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
      if (!response.ok)
        throw new Error(`Jev HTTP ${response.status}`)
      return await response.json() as { answers?: Record<string, unknown> }
    } })
    console.info(JSON.stringify({ text, kind: decision.kind, choice: decision.priceChoiceId, reason: decision.reason, modelCalls: decision.modelCalls, modelQuestions: decision.modelQuestions }))
    expect(decision.priceChoiceId).toBe(choice)
    if (choice === 'UNSUPPORTED') {
      expect(decision).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_PRICE' })
    }
    else {
      expect(decision.kind).toBe('FAST_ACTION')
      if (decision.kind !== 'FAST_ACTION')
        throw new Error(JSON.stringify(decision))
      const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId, priceChoiceId: decision.priceChoiceId, ...(decision.ingredientFilters ? { ingredientFilters: decision.ingredientFilters } : {}), ...(decision.searchInterpretation ? { searchInterpretation: decision.searchInterpretation } : {}) })
      const conditions = state.priceEvidence?.choices.find(candidate => candidate.id === choice)?.conditions ?? {}
      expect(result).toMatchObject({ appliedPriceConditions: conditions })
    }
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }, 90_000)
})
