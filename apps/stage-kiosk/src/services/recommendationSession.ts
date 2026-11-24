import type { InferOutput } from 'valibot'

import { array, boolean, integer, maxLength, maxValue, minValue, number, optional, picklist, pipe, strictObject, string } from 'valibot'

/** A semantic patch supplied by Main; omission preserves the existing restriction. */
export const recommendationCriteriaSchema = strictObject({
  category: optional(pipe(string(), maxLength(100))),
  maxUnitPrice: optional(pipe(number(), integer(), minValue(0), maxValue(100000))),
  priceScope: optional(picklist(['category', 'reception'])),
  excludedTerms: optional(pipe(array(pipe(string(), maxLength(100))), maxLength(20))),
  allowedTerms: optional(pipe(array(pipe(string(), maxLength(100))), maxLength(20))),
  clearPrice: optional(boolean()),
  clearExclusions: optional(boolean()),
})
export type RecommendationCriteria = InferOutput<typeof recommendationCriteriaSchema>
type State = Pick<RecommendationCriteria, 'category' | 'maxUnitPrice' | 'priceScope' | 'excludedTerms'>

/** Reception-owned recommendation restrictions; never changes the cart or infers ingredients. */
export function createRecommendationSession(owner: () => string | undefined) {
  let currentOwner: string | undefined
  let state: State = {}
  const dismissedProductRefs = new Set<string>()
  function snapshot() {
    const next = owner()
    if (next !== currentOwner) {
      currentOwner = next
      state = {}
      dismissedProductRefs.clear()
    }
    return { ...state, excludedTerms: state.excludedTerms ? [...state.excludedTerms] : undefined }
  }
  function update(patch: RecommendationCriteria) {
    snapshot()
    if (patch.category !== undefined && patch.category !== state.category && state.priceScope === 'category') {
      delete state.maxUnitPrice
      delete state.priceScope
    }
    if (patch.category !== undefined)
      state.category = patch.category || undefined
    if (patch.clearPrice) {
      delete state.maxUnitPrice
      delete state.priceScope
    }
    if (patch.maxUnitPrice !== undefined) {
      state.maxUnitPrice = patch.maxUnitPrice
      state.priceScope = patch.priceScope ?? (state.category ? 'category' : 'reception')
    }
    else if (patch.priceScope !== undefined && state.maxUnitPrice !== undefined) {
      state.priceScope = patch.priceScope
    }
    if (patch.clearExclusions)
      state.excludedTerms = []
    if (patch.excludedTerms !== undefined)
      state.excludedTerms = [...new Set([...(state.excludedTerms ?? []), ...patch.excludedTerms.filter(Boolean)])]
    if (patch.allowedTerms?.length)
      state.excludedTerms = state.excludedTerms?.filter(term => !patch.allowedTerms!.includes(term))
    return snapshot()
  }
  function filter<T extends { name: string, category?: string, configurations: readonly { unitPrice: number }[] }>(products: readonly T[]): T[] {
    const criteria = snapshot()
    return products.filter(product => (!criteria.category || product.category === criteria.category)
      && !criteria.excludedTerms?.some(term => product.name.includes(term))
      && (criteria.maxUnitPrice === undefined || product.configurations.some(configuration => configuration.unitPrice <= criteria.maxUnitPrice!)))
  }
  return {
    snapshot,
    update,
    filter,
    // Declining a suggestion only affects automatic follow-ups in this
    // reception. It does not create a dietary restriction or block a new order.
    dismissProducts(refs: readonly string[]) {
      snapshot()
      refs.forEach(ref => dismissedProductRefs.add(ref))
    },
    dismissedProducts() {
      snapshot()
      return [...dismissedProductRefs]
    },
  }
}
