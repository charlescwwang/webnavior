import type { InferOutput } from 'valibot'

import type { CatalogItem } from '../../../order-menu-server/src/domain/contracts'

import { array, boolean, integer, maxLength, minLength, minValue, nullable, number, picklist, pipe, safeParse, strictObject, string } from 'valibot'

const effects = ['ADD', 'QUERY', 'RECOMMEND', 'RECOMMEND_NEXT', 'VIEW', 'MODIFY_QUANTITY', 'MODIFY_OPTION', 'REMOVE', 'REPLACE', 'FULFILLMENT', 'PARTY_SIZE', 'CHECKOUT', 'DECLINE', 'CHAT', 'UNFINISHED', 'UNCERTAIN'] as const
const topics = ['AVAILABILITY', 'PRICE', 'COMPOSITION', 'DIET', 'CATEGORY', 'PRICE_FILTER'] as const
const rawText = pipe(string(), minLength(1), maxLength(500))
const quantity = nullable(pipe(number(), integer(), minValue(1)))
const requirementSchema = strictObject({
  source: rawText,
  effect: picklist(effects),
  targetRaw: nullable(rawText),
  replacementRaw: nullable(rawText),
  quantity,
  conditions: pipe(array(rawText), maxLength(12)),
  queryTopics: array(picklist(topics)),
  contextRequired: boolean(),
  value: nullable(picklist(['dine-in', 'takeout'])),
})
const proposalSchema = strictObject({
  requirements: pipe(array(requirementSchema), minLength(1), maxLength(16)),
  unresolved: pipe(array(rawText), maxLength(16)),
  summaryCount: quantity,
})

/** Experimental advice only. No target IDs, tool calls, receipts or authorization. */
export type Proposal = InferOutput<typeof proposalSchema>
/** Frozen assessment fields never enter the provider request. */
export interface Scenario {
  id: string
  group: string
  utterance: string
  dialogue?: Array<{ role: 'user' | 'assistant', content: string }>
  currentQuestion?: string
  expected: Array<Partial<Omit<Proposal['requirements'][number], 'source'>> & { effect: Proposal['requirements'][number]['effect'] }>
  unresolved?: string[]
  summaryCount?: number
}
/** Local catalog facts for an advisory feasibility check, not a new domain resolver. */
export type MenuFact = Pick<CatalogItem, 'name' | 'aliases' | 'category' | 'available' | 'optionGroups'>

// Defines the same fields as the runtime validator; length/content constraints
// remain application-owned even when the provider accepts this response schema.
// Google's compatibility API accepts response_format json_schema:
// https://ai.google.dev/gemini-api/docs/openai#structured-output
const nullableString = { type: ['string', 'null'] }
export const responseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'requirements_proposal',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['requirements', 'unresolved', 'summaryCount'],
      properties: {
        requirements: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            additionalProperties: false,
            required: Object.keys(requirementSchema.entries),
            properties: {
              source: { type: 'string' },
              effect: { type: 'string', enum: effects },
              targetRaw: nullableString,
              replacementRaw: nullableString,
              quantity: { type: ['integer', 'null'], minimum: 1 },
              conditions: { type: 'array', items: { type: 'string' } },
              queryTopics: { type: 'array', items: { type: 'string', enum: topics } },
              contextRequired: { type: 'boolean' },
              // Keep null outside enum: Google's compatibility conversion may
              // reject non-string enum members before model inference.
              value: { anyOf: [{ type: 'string', enum: ['dine-in', 'takeout'] }, { type: 'null' }] },
            },
          },
        },
        unresolved: { type: 'array', items: { type: 'string' } },
        summaryCount: { type: ['integer', 'null'], minimum: 1 },
      },
    },
  },
} as const

/** Omits gold labels and hypotheses; history informs interpretation, not execution. */
export function createInput(scenario: Scenario) {
  return { utterance: scenario.utterance, dialogue: scenario.dialogue ?? [], currentQuestion: scenario.currentQuestion ?? null }
}

/**
 * Validates shape and literal evidence, without claiming semantic correctness.
 * A source covering the whole utterance can still omit an entire requirement.
 */
export function parseProposal(raw: string, utterance: string) {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  }
  catch {
    return { valid: false as const, reason: 'INVALID_JSON' }
  }
  const result = safeParse(proposalSchema, decoded)
  if (!result.success)
    return { valid: false as const, reason: 'INVALID_SCHEMA' }
  const proposal = result.output
  const evidence = [...proposal.unresolved, ...proposal.requirements.flatMap(item => [item.source, item.targetRaw, item.replacementRaw, ...item.conditions].filter((value): value is string => value !== null))]
  if (evidence.some(text => !utterance.includes(text)))
    return { valid: false as const, reason: 'INVENTED_SOURCE_TEXT' }
  return { valid: true as const, proposal }
}

function semanticFields(item: Scenario['expected'][number]) {
  return {
    effect: item.effect,
    targetRaw: item.targetRaw ?? null,
    replacementRaw: item.replacementRaw ?? null,
    quantity: item.quantity ?? null,
    conditions: [...(item.conditions ?? [])].sort(),
    queryTopics: [...(item.queryTopics ?? [])].sort(),
    contextRequired: item.contextRequired ?? false,
    value: item.value ?? null,
  }
}

/**
 * Compares with independent authored gold, preserving duplicate ADDs and order.
 * Exact semantic-field match excludes evidence segmentation. Precision/recall
 * use multiset matching so duplicate outputs cannot inflate correct coverage.
 */
export function assess(scenario: Scenario, raw: string) {
  const parsed = parseProposal(raw, scenario.utterance)
  const expected = scenario.expected.map(semanticFields)
  const actual = parsed.valid ? parsed.proposal.requirements.map(semanticFields) : []
  const remaining = actual.map(item => JSON.stringify(item))
  let matched = 0
  for (const item of expected) {
    const index = remaining.indexOf(JSON.stringify(item))
    if (index !== -1) {
      matched++
      remaining.splice(index, 1)
    }
  }
  const differences = [...new Set(expected.flatMap((item, index) => {
    const observed = actual[index]
    if (!observed)
      return ['requirement_count']
    return Object.keys(item).filter(key => JSON.stringify(item[key as keyof typeof item]) !== JSON.stringify(observed[key as keyof typeof observed]))
  }))]
  if (actual.length !== expected.length)
    differences.push('requirement_count')
  if (!parsed.valid)
    differences.push(parsed.reason)
  if (parsed.valid && JSON.stringify([...parsed.proposal.unresolved].sort()) !== JSON.stringify([...(scenario.unresolved ?? [])].sort()))
    differences.push('unresolved')
  if (parsed.valid && parsed.proposal.summaryCount !== (scenario.summaryCount ?? null))
    differences.push('summaryCount')
  return {
    valid: parsed.valid,
    exact: differences.length === 0,
    matched,
    expectedCount: expected.length,
    actualCount: actual.length,
    missingOrWrong: expected.length - matched,
    extraOrWrong: actual.length - matched,
    differences: [...new Set(differences)],
    expected,
    actual,
  }
}

/**
 * Diagnostic feasibility only. No plan/authorization, fuzzy matching or writes.
 * No target resolution is attempted for context-dependent proposals. Empty
 * option groups explicitly reject requested customization; unknown capability
 * remains unknown rather than treating valid model JSON as executable.
 */
export function inspectFeasibility(proposal: Proposal, menu: MenuFact[]) {
  const findings = proposal.requirements.map((item) => {
    const issues: string[] = []
    if (item.contextRequired)
      issues.push('NEEDS_CONTEXT_RESOLVER')
    if (['ADD', 'REPLACE'].includes(item.effect)) {
      const raw = item.effect === 'REPLACE' ? item.replacementRaw : item.targetRaw
      const matches = menu.filter(entry => entry.available && (entry.name === raw || entry.aliases?.includes(raw ?? '') || entry.category === raw))
      if (!item.contextRequired) {
        if (!matches.length)
          issues.push('UNKNOWN_OR_UNRESOLVED_TARGET')
        if (matches.length > 1)
          issues.push('AMBIGUOUS_TARGET')
        if (item.quantity === null)
          issues.push('MISSING_QUANTITY')
        if (item.conditions.length && matches.some(entry => entry.optionGroups.length === 0))
          issues.push('UNSUPPORTED_CUSTOMIZATION')
      }
      if (item.effect === 'REPLACE')
        issues.push('CART_SOURCE_NOT_VALIDATED')
    }
    // This PoC has no recipe/price/reference query executor or action guard.
    if (!['ADD', 'REPLACE'].includes(item.effect))
      issues.push('NO_DOMAIN_EXECUTION_EVALUATED')
    return { effect: item.effect, targetRaw: item.targetRaw, issues, executionAuthorized: false as const }
  })
  // Frozen scenarios use 樣 (distinct newly requested dishes), not total portions.
  const additions = proposal.requirements.filter(item => item.effect === 'ADD')
  return {
    findings,
    unresolved: proposal.unresolved,
    summaryMismatch: proposal.summaryCount !== null && proposal.summaryCount !== additions.length,
    executionAuthorized: false as const,
  }
}
