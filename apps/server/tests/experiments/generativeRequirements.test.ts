import type { Proposal, Scenario } from './generativeRequirements'

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { assess, createInput, inspectFeasibility, parseProposal } from './generativeRequirements'
import { admissionDelay, experimentLimits } from './requestBudget'

const frozen: { turns: Scenario[] } = JSON.parse(readFileSync(new URL('../../../../test_prompt/turnClassifierPoc/generativeRequirementsScenarios.json', import.meta.url), 'utf8'))
function gold(scenario: Scenario): Proposal {
  return {
    requirements: scenario.expected.map(item => ({ source: scenario.utterance, targetRaw: null, replacementRaw: null, quantity: null, conditions: [], queryTopics: [], contextRequired: false, value: null, ...item })),
    unresolved: scenario.unresolved ?? [],
    summaryCount: scenario.summaryCount ?? null,
  }
}

describe('independent generative requirement benchmark (offline, not model accuracy)', () => {
  it.each(frozen.turns)('$id gold is schema-valid and never sent to the provider', (scenario) => {
    const input = createInput(scenario)
    expect(Object.keys(input)).toEqual(['utterance', 'dialogue', 'currentQuestion'])
    expect(parseProposal(JSON.stringify(gold(scenario)), scenario.utterance).valid).toBe(true)
    expect(assess(scenario, JSON.stringify(gold(scenario))).exact).toBe(true)
  })

  it('rejects a partial proposal even when its source spans the entire utterance', () => {
    const scenario = frozen.turns.find(item => item.id === 'g12')!
    const proposal = gold(scenario)
    proposal.requirements.pop()
    expect(parseProposal(JSON.stringify(proposal), scenario.utterance).valid).toBe(true)
    expect(assess(scenario, JSON.stringify(proposal)).exact).toBe(false)
    expect(assess(scenario, JSON.stringify(proposal)).missingOrWrong).toBe(1)
  })

  it('rejects query-to-add, duplicate ADD, invented quantity and conditions on the wrong meal', () => {
    const query = frozen.turns.find(item => item.id === 'g04')!
    const changedQuery = gold(query)
    changedQuery.requirements[0]!.effect = 'ADD'
    expect(assess(query, JSON.stringify(changedQuery)).exact).toBe(false)
    const compound = frozen.turns.find(item => item.id === 'g16')!
    const changed = gold(compound)
    changed.requirements.push({ ...changed.requirements[0]! })
    expect(assess(compound, JSON.stringify(changed)).extraOrWrong).toBe(1)
    changed.requirements.pop()
    changed.requirements[0]!.conditions = ['不要蒜頭']
    changed.requirements[1]!.conditions = ['小辣']
    expect(assess(compound, JSON.stringify(changed)).differences).toContain('conditions')
    const noQuantity = frozen.turns.find(item => item.id === 'g03')!
    const invented = gold(noQuantity)
    invented.requirements[0]!.quantity = 1
    expect(assess(noQuantity, JSON.stringify(invented)).differences).toContain('quantity')
  })

  it('rejects non-JSON, unknown keys and corrected ASR targets not in the utterance', () => {
    expect(parseProposal('not JSON', '水餃').valid).toBe(false)
    const scenario = frozen.turns.find(item => item.id === 'g38')!
    expect(parseProposal(JSON.stringify({ ...gold(scenario), authorized: true }), scenario.utterance).valid).toBe(false)
    const changed = gold(scenario)
    changed.requirements[0]!.targetRaw = '椒麻雞便當'
    expect(parseProposal(JSON.stringify(changed), scenario.utterance)).toEqual({ valid: false, reason: 'INVENTED_SOURCE_TEXT' })
  })

  it('preserves unavailable dishes and unsupported options without granting execution', () => {
    const proposal = gold(frozen.turns.find(item => item.id === 'g13')!)
    const result = inspectFeasibility(proposal, [
      { name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵', available: true, optionGroups: [] },
      { name: '炸排骨便當', aliases: ['排骨便當'], category: '便當', available: true, optionGroups: [] },
    ])
    expect(result.findings[0]!.issues).toContain('UNKNOWN_OR_UNRESOLVED_TARGET')
    expect(result.findings[1]!.issues).toContain('UNSUPPORTED_CUSTOMIZATION')
    expect(result.findings[2]!.issues).toEqual([])
    expect(result.executionAuthorized).toBe(false)
    expect(result.findings.every(item => !item.executionAuthorized)).toBe(true)
    expect(result.summaryMismatch).toBe(false)
  })

  it('does not bind second-item references or hide inconsistent dish totals', () => {
    const referenced = inspectFeasibility(gold(frozen.turns.find(item => item.id === 'g25')!), [])
    expect(referenced.findings[0]!.issues).toContain('NEEDS_CONTEXT_RESOLVER')
    const mismatch = inspectFeasibility(gold(frozen.turns.find(item => item.id === 'g17')!), [])
    expect(mismatch.summaryMismatch).toBe(true)
  })
})

describe('independent experiment quota admission', () => {
  it('waits for RPM even when tokenizer requests consume zero generative tokens', () => {
    const history = Array.from({ length: 24 }, (_, index) => ({ at: index * 100, inputTokens: 0 }))
    expect(admissionDelay(history, 1000, 3000)).toBe(57_100)
  })

  it('waits for TPM even with ample RPM and keeps failed dispatch reservations', () => {
    const history = [{ at: 1000, inputTokens: 6400 }, { at: 2000, inputTokens: 6400 }]
    expect(admissionDelay(history, 1000, 3000)).toBe(58_100)
    expect(admissionDelay(history, 1000, 61_000)).toBe(0)
    expect(history).toHaveLength(2)
  })

  it('expires enough entries to satisfy both limits rather than only the first', () => {
    const history = [{ at: 1000, inputTokens: 100 }, { at: 2000, inputTokens: 12_700 }]
    expect(admissionDelay(history, 1000, 3000)).toBe(59_100)
  })

  it('rejects missing/excessive tokens and exhaustion without resetting history', () => {
    expect(() => admissionDelay([], Number.NaN, 0)).toThrow()
    expect(() => admissionDelay([], 16_000, 0)).toThrow()
    expect(() => admissionDelay([{ at: 0, inputTokens: 1 }], 1, 70_000, { ...experimentLimits, requestsPerRun: 1 })).toThrow()
  })
})
