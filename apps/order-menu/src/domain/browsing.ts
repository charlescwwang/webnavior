import type { RecommendationStrategy } from '../../../order-menu-server/src/domain/recommendation'
import type { PriceConditions } from '../../../server/src/services/domain/kiosk-interaction-decision/priceContracts'
import type { IngredientFilters } from './composition'
import type { MenuItem, RecommendationTag } from './order-machine'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { ingredientDefinitions, vegetarianIngredients } from '../../../order-menu-server/src/domain/composition'
import { priceDescription } from './pricing'

const vegetarianExclusions = new Set<string>(vegetarianIngredients)

/** The existing recommendation owner supplies these facts; views never infer them from speech. */
export interface QueryConditions {
  category: string
  queries: string[]
  prices: PriceConditions
  filters: IngredientFilters
  excludedItemIds: string[]
  needs: RecommendationTag[]
  strategy?: RecommendationStrategy
}

/** A structured touch target, correlated with its displayed query revision. */
export interface QueryCondition {
  group: 'category' | 'query' | 'price' | 'includeIngredients' | 'excludeIngredients' | 'dietary' | 'excludedItems' | 'needs' | 'strategy'
  value?: string
}

/** Detached current query facts for a customer-facing condition strip. */
export interface QueryView {
  revision: number
  menuRevision: number
  conditions: Array<QueryCondition & { label: string, removable: boolean }>
}

/** Projects only active constraints; price labels require real price conditions. */
export function describeConditions(query: QueryConditions, menu: readonly MenuItem[]): QueryView['conditions'] {
  const result: QueryView['conditions'] = []
  if (query.category)
    result.push({ group: 'category', label: query.category, removable: true })
  for (const value of query.queries)
    result.push({ group: 'query', value, label: `查找：${value}`, removable: true })
  const price = priceDescription(query.prices)
  if (price)
    result.push({ group: 'price', label: price, removable: true })
  if (query.filters.dietary)
    result.push({ group: 'dietary', label: '素食', removable: true })
  for (const group of ['includeIngredients', 'excludeIngredients'] as const) {
    for (const value of query.filters[group]) {
      const label = ingredientDefinitions.find(definition => definition.id === value)?.label
      if (!label)
        continue
      const impliedByDietary = group === 'excludeIngredients' && query.filters.dietary && vegetarianExclusions.has(value)
      // Vegetarian's implied exclusions cannot be removed independently while
      // the positive vegetarian requirement remains active.
      if (!impliedByDietary)
        result.push({ group, value, label: `${group === 'includeIngredients' ? '想吃' : '不含'}：${label}`, removable: true })
    }
  }
  for (const value of query.excludedItemIds) {
    const item = menu.find(item => item.id === value)
    if (item)
      result.push({ group: 'excludedItems', value, label: `不看：${item.name}`, removable: true })
  }
  for (const value of query.needs)
    result.push({ group: 'needs', value, label: value === 'rice' ? '飯類' : '油炸餐點', removable: true })
  if (query.strategy) {
    const labels = { POPULAR: '人氣餐點', NEW_ARRIVAL: '新餐點', CHEF_SPECIAL: '主廚推薦' }
    result.push({ group: 'strategy', label: labels[query.strategy], removable: true })
  }
  return result
}

/** Removes exactly the clicked condition using existing explicit update/clear semantics. */
export function removeCondition(query: QueryConditions, target: QueryCondition): Record<string, unknown> {
  const action = 'update'
  switch (target.group) {
    case 'includeIngredients':
      return { action, clear: ['includeIngredients'], includeIngredients: query.filters.includeIngredients.filter(value => value !== target.value) }
    case 'excludeIngredients':
      return { action, clear: ['ingredients'], includeIngredients: query.filters.includeIngredients, excludeIngredients: query.filters.excludeIngredients.filter(value => value !== target.value) }
    case 'query': {
      const queries = query.queries.filter(value => value !== target.value)
      return { action, clear: ['query'], ...(queries.length ? { queries } : {}) }
    }
    case 'excludedItems':
      return { action, clear: ['excludedItems'], excludeItemIds: query.excludedItemIds.filter(value => value !== target.value) }
    case 'needs': {
      const needs = query.needs.filter(value => value !== target.value)
      return { action, clear: ['needs'], ...(needs.length ? { needs } : {}) }
    }
    // Removing a dietary label never silently releases existing food exclusions.
    // Those remain visible and require their own explicit customer removal.
    default:
      return { action, clear: [target.group] }
  }
}

/** Uses actual available candidates; it never claims another food category exists. */
export function describeGuidance(reason: 'unclear' | 'empty' | 'exhausted', candidates: readonly MenuItem[]) {
  const copy = orderingMessages['zh-Hant'].queryActions
  const prefix = reason === 'exhausted' ? copy.exhausted : reason === 'empty' ? copy.empty : ''
  const names = candidates.slice(0, 2).map(item => `「${item.name}」`).join('或')
  return `${prefix}${names ? copy.choose.replace('{items}', names) : copy.clarify}`
}
