/** Actual ingredient facts. Completeness is relative to the declared source scope. */
export interface Composition {
  ingredients: string[]
  complete: boolean
  source: 'simulation' | 'merchant'
  revision: string
  /** Positive merchant-confirmed dietary suitability; absence is not a claim. */
  dietaryLabels?: Array<'vegetarian'>
  /** Verified option settings that remove ingredients; never applied by a search. */
  removals: Array<{ ingredients: string[], groupId: string, valueId: string }>
}

/** Finite ingredient vocabulary shared by POS facts, bounded slots and tools. */
export const ingredientDefinitions = [
  { id: 'pork', label: '豬肉', aliases: ['豬肉'] },
  { id: 'beef', label: '牛肉', aliases: ['牛肉'] },
  { id: 'chicken', label: '雞肉', aliases: ['雞肉'] },
  { id: 'seafood', label: '海鮮', aliases: ['海鮮'] },
  { id: 'shrimp', label: '蝦', aliases: ['蝦'] },
  { id: 'fish', label: '魚', aliases: ['魚'] },
  { id: 'egg', label: '蛋', aliases: ['雞蛋', '蛋'] },
  { id: 'milk', label: '奶', aliases: ['牛奶', '奶'] },
  { id: 'rice', label: '米飯', aliases: ['米飯'] },
  { id: 'wheat', label: '麵粉', aliases: ['麵粉'] },
  { id: 'vegetables', label: '青菜', aliases: ['青菜', '蔬菜'] },
] as const

/** Vegetarian eligibility also requires a positive POS label, not just absent meat facts. */
export const vegetarianIngredients = ['pork', 'beef', 'chicken', 'seafood'] as const

/** Specific POS facts satisfy their broader food group, never the reverse. */
export function ingredientMatches(actual: string, requested: string) {
  return actual === requested || (requested === 'seafood' && (actual === 'shrimp' || actual === 'fish'))
}

/** Rejects malformed facts instead of interpreting missing data as ingredient absence. */
export function parseComposition(value: unknown): Composition {
  if (!value || typeof value !== 'object')
    throw new Error('POS must provide composition facts.')
  const input = value as Record<string, unknown>
  const ids = (value: unknown): string[] => {
    if (!Array.isArray(value) || !value.every(id => typeof id === 'string' && ingredientDefinitions.some(definition => definition.id === id)) || new Set(value).size !== value.length)
      throw new Error('Invalid or unsupported ingredient IDs.')
    return value
  }
  if (typeof input.complete !== 'boolean' || !['simulation', 'merchant'].includes(String(input.source)) || typeof input.revision !== 'string' || !input.revision.trim() || !Array.isArray(input.removals))
    throw new Error('Invalid composition provenance.')
  const ingredients = ids(input.ingredients)
  if (input.dietaryLabels !== undefined && (!Array.isArray(input.dietaryLabels) || input.dietaryLabels.some(label => label !== 'vegetarian') || new Set(input.dietaryLabels).size !== input.dietaryLabels.length))
    throw new Error('Invalid dietary labels.')
  if (Array.isArray(input.dietaryLabels) && input.dietaryLabels.includes('vegetarian') && vegetarianIngredients.some(id => ingredients.some(actual => ingredientMatches(actual, id))))
    throw new Error('Vegetarian label contradicts declared ingredients.')
  return {
    ingredients,
    complete: input.complete,
    source: input.source as Composition['source'],
    revision: input.revision,
    ...(Array.isArray(input.dietaryLabels) ? { dietaryLabels: input.dietaryLabels as Composition['dietaryLabels'] } : {}),
    removals: input.removals.map((value) => {
      if (!value || typeof value !== 'object' || typeof value.groupId !== 'string' || !value.groupId || typeof value.valueId !== 'string' || !value.valueId)
        throw new Error('Invalid composition removal option.')
      const removed = ids(value.ingredients)
      if (!removed.length || removed.some(id => !ingredients.includes(id)))
        throw new Error('Removal ingredients are not present in the composition.')
      return { ingredients: removed, groupId: value.groupId, valueId: value.valueId }
    }),
  }
}
