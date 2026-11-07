import type { MenuItem } from './order-machine'

import { ingredientDefinitions, ingredientMatches, vegetarianIngredients } from '../../../order-menu-server/src/domain/composition'

/** Catalog-grounded filters; all requirements are intersected, never silently relaxed. */
export interface IngredientFilters {
  excludeIngredients: string[]
  includeIngredients: string[]
  dietary?: 'vegetarian'
}

/** Validates finite tool slots independently of either model's output. */
export function ingredientFilters(input: Record<string, unknown>): IngredientFilters {
  const parse = (value: unknown): string[] => {
    if (value === undefined)
      return []
    if (!Array.isArray(value) || value.length > ingredientDefinitions.length || !value.every(id => typeof id === 'string' && ingredientDefinitions.some(definition => definition.id === id)))
      throw new Error('Unsupported ingredient filter.')
    return [...new Set(value)]
  }
  if (input.dietary !== undefined && input.dietary !== 'vegetarian')
    throw new Error('Unsupported dietary filter.')
  return { excludeIngredients: [...new Set([...parse(input.excludeIngredients), ...(input.dietary === 'vegetarian' ? vegetarianIngredients : [])])], includeIngredients: parse(input.includeIngredients), ...(input.dietary === 'vegetarian' ? { dietary: 'vegetarian' } : {}) }
}

/** Returns verified matches and separate customization/unknown results, without mutating a dish. */
export function filterIngredients(menu: readonly MenuItem[], filters: IngredientFilters) {
  const matches: MenuItem[] = []
  const customizable: Array<{ item: MenuItem, requiredOptions: Array<{ groupId: string, valueId: string }> }> = []
  const unknown: MenuItem[] = []
  for (const item of menu) {
    if (item.available === false)
      continue
    if (!filters.dietary && !filters.excludeIngredients.length && !filters.includeIngredients.length) {
      matches.push(item)
      continue
    }
    const facts = item.composition
    if (filters.dietary && facts && vegetarianIngredients.some(id => facts.ingredients.some(actual => ingredientMatches(actual, id))))
      continue
    if (!facts?.complete) {
      unknown.push(item)
      continue
    }
    if (filters.dietary && !facts.dietaryLabels?.includes(filters.dietary)) {
      unknown.push(item)
      continue
    }
    // A broad seafood fact cannot prove absence of a particular seafood.
    if (facts.ingredients.includes('seafood') && [...filters.includeIngredients, ...filters.excludeIngredients].some(id => (id === 'shrimp' || id === 'fish') && !facts.ingredients.includes(id))) {
      unknown.push(item)
      continue
    }
    if (!filters.includeIngredients.every(id => facts.ingredients.some(actual => ingredientMatches(actual, id))))
      continue
    const excluded = facts.ingredients.filter(actual => filters.excludeIngredients.some(id => ingredientMatches(actual, id)))
    if (!excluded.length) {
      matches.push(item)
      continue
    }
    const options = facts.removals.filter(removal => removal.ingredients.some(id => excluded.includes(id)) && item.optionGroups.some(group => group.id === removal.groupId && group.values.some(value => value.id === removal.valueId)))
    const removed = new Set(options.flatMap(option => option.ingredients))
    if (excluded.every(id => removed.has(id)) && filters.includeIngredients.every(id => facts.ingredients.some(actual => !removed.has(actual) && ingredientMatches(actual, id))) && new Set(options.map(option => option.groupId)).size === options.length)
      customizable.push({ item, requiredOptions: options.map(({ groupId, valueId }) => ({ groupId, valueId })) })
  }
  return { matches, customizable, unknown }
}

/** Only finds finite referenced ingredients; inclusion/exclusion remains a bounded Jev choice. */
export function mentionedIngredients(transcript: string) {
  return ingredientDefinitions.filter(definition => definition.aliases.some(alias => transcript.includes(alias))).map(({ id, label }) => ({ id, label }))
}

/** Resolves a finite dietary reference, not the customer's intent or polarity. */
export function mentionedDietaryReferences(transcript: string): Array<{ id: 'vegetarian', label: string }> {
  return ['素食', '素的', '素菜'].some(alias => transcript.includes(alias)) ? [{ id: 'vegetarian', label: '素食（需店家明確標示）' }] : []
}

/** Finds topics the current composition contract cannot verify; Jev decides whether they are requirements. */
export function mentionedUnavailableConditions(transcript: string) {
  const definitions = [
    { id: 'preparation', label: '製作調整（依各餐點實際客製選項）', aliases: ['蔥', '香菜', '蒜'] },
    { id: 'spice', label: '辣度或製作調整（依餐點選項；沒有全面不辣保證）', aliases: ['辣'] },
    { id: 'sodium', label: '鈉含量（沒有營養數據）', aliases: ['鈉', '鹽分'] },
    { id: 'sugar', label: '糖含量（沒有營養數據）', aliases: ['糖'] },
    { id: 'energy', label: '熱量（沒有營養數據）', aliases: ['熱量', '卡路里'] },
    { id: 'fat', label: '脂肪含量（沒有營養數據）', aliases: ['脂肪', '低脂', '高脂'] },
    { id: 'protein', label: '蛋白質含量（沒有營養數據）', aliases: ['蛋白質', '高蛋白', '低蛋白'] },
    { id: 'allergen-safety', label: '過敏／交叉污染安全保證（成分表不提供保證）', aliases: ['過敏', '交叉污染', '保證'] },
    { id: 'strict-diet', label: '嚴格素別或飲食認證（只有一般素食標示）', aliases: ['純素', '全素', '奶蛋素', '清真'] },
  ]
  // Literal vocabulary lookup only, like ingredient references. 糖醋排骨 can
  // mention sugar without requesting a nutrition filter; do not route it here.
  return definitions.filter(definition => definition.aliases.some(alias => transcript.includes(alias))).map(({ id, label }) => ({ id, label }))
}

/** Empty known results and unknown recipes are different customer-facing outcomes. */
export function filterAvailability(result: ReturnType<typeof filterIngredients>, matchCount: number) {
  if (matchCount)
    return 'MATCHES' as const
  if (result.unknown.length)
    return 'UNKNOWN' as const
  if (result.customizable.length)
    return 'CUSTOMIZATION_REQUIRED' as const
  return 'NONE' as const
}

/** Shared wording prevents either lookup or recommendation from claiming unknown absence. */
export function emptyFilterMessage(availability: ReturnType<typeof filterAvailability>) {
  if (availability === 'UNKNOWN')
    return '目前成分或飲食標示資料不足，無法確認是否有符合條件的餐點。'
  if (availability === 'CUSTOMIZATION_REQUIRED')
    return '目前沒有可直接符合條件的餐點；另有餐點需要客製，尚未修改或加入。'
  return '目前沒有符合條件的餐點。'
}
