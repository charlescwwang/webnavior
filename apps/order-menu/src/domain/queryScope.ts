import type { PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { PriceConditions } from '../../../server/src/services/domain/kiosk-interaction-decision/priceContracts'
import type { ScopeChoice } from '../../../server/src/services/domain/kiosk-interaction-decision/queryScopeContracts'
import type { IngredientFilters } from './composition'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { resolveClarificationReference } from '../kiosk-intents'
import { ingredientFilters } from './composition'
import { priceConditions, priceEvidence } from './pricing'

/** Confirmed search universe; food exclusions remain a separate condition. */
export interface SelectedQueryScope {
  scope: Extract<ScopeChoice, 'SHOWN' | 'CATALOG'>
  itemIds?: readonly string[]
}

/** A scope question is valid only for its original catalog and displayed batch. */
export interface ScopeRevision { menu: number, recommendation: number }

/** Owns one revision-bound scope question answered through the Kiosk conversation. */
export function createQueryScope(input: {
  questionId: string
  expiresAt: number
  revisions: ScopeRevision
  shownItemIds: readonly string[]
  conditions: PriceConditions & Partial<IngredientFilters>
}) {
  const { questionId, expiresAt } = input
  const prices = priceConditions({ ...input.conditions })
  const filters = ingredientFilters({ ...input.conditions })
  const itemIds = [...new Set(input.shownItemIds)]
  const expected = { ...input.revisions }
  const copy = orderingMessages['zh-Hant'].queryScope
  let consumed = false
  const question: PresentedQuestion = {
    questionId,
    purpose: 'menu-query-scope',
    question: copy.question,
    expiresAt,
    choices: [{ id: 'SHOWN', description: copy.shown }, { id: 'CATALOG', description: copy.catalog }],
  }
  return {
    question,
    get conditions() { return { ...prices, ...filters, includeIngredients: [...filters.includeIngredients], excludeIngredients: [...filters.excludeIngredients] } },
    /** Consumes one qualified choice; unknown replies preserve the question. */
    resolve(answer: { questionId: string, choice: ScopeChoice, transcript?: string }, current: ScopeRevision, _now = Date.now()) {
      if (consumed || answer.questionId !== questionId || expected.menu !== current.menu || expected.recommendation !== current.recommendation)
        return { status: 'STALE' as const }
      // A complete label or ordinal is already a bounded domain reference.
      // Reuse the existing reference parser so a model cannot reinterpret the
      // second question option as the second meal in the previous batch.
      const reference = answer.transcript ? resolveClarificationReference(answer.transcript, question.choices.map(choice => ({ refId: choice.id, label: choice.description }))) : undefined
      const choice = reference === 'SHOWN' || reference === 'CATALOG' ? reference : answer.choice
      if (choice === 'IGNORE')
        return { status: 'IGNORE' as const }
      // Any new price evidence needs a fresh interpretation, even if a model
      // selects a scope and misses the changed amount. This grants no new filter.
      if (choice === 'NEW_REQUEST' && !answer.transcript?.trim())
        return { status: 'WAITING' as const, question }
      if (choice === 'NEW_REQUEST' || (answer.transcript && priceEvidence(answer.transcript))) {
        consumed = true
        return { status: 'NEW_REQUEST' as const, transcript: answer.transcript ?? '' }
      }
      if (choice !== 'SHOWN' && choice !== 'CATALOG') {
        // Context/validation probes also use ASK without speech. Only a real
        // unclear reply changes the spoken question; snapshots remain reads.
        if (answer.transcript?.trim())
          question.question = copy.clarification
        return { status: 'WAITING' as const, question }
      }
      consumed = true
      return { status: 'QUERY' as const, scope: choice, conditions: { ...prices, ...filters, excludeIngredients: [...filters.excludeIngredients], includeIngredients: [...filters.includeIngredients] }, ...(choice === 'SHOWN' ? { itemIds: [...itemIds] } : {}) }
    },
  }
}
