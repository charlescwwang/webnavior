import { describe, expect, it } from 'vitest'

import { parseComposition } from './composition'

describe('pOS composition facts', () => {
  it('retains verified dietary labels and rejects unsupported or contradictory claims', () => {
    const facts = { ingredients: ['rice', 'vegetables'], complete: true, source: 'merchant', revision: '1', removals: [] }
    expect(parseComposition({ ...facts, dietaryLabels: ['vegetarian'] }).dietaryLabels).toEqual(['vegetarian'])
    expect(parseComposition(facts).dietaryLabels).toBeUndefined()
    expect(() => parseComposition({ ...facts, dietaryLabels: ['invented'] })).toThrow('Invalid dietary')
    expect(() => parseComposition({ ...facts, ingredients: ['pork'], dietaryLabels: ['vegetarian'] })).toThrow('contradicts')
    expect(() => parseComposition({ ...facts, ingredients: ['shrimp'], dietaryLabels: ['vegetarian'] })).toThrow('contradicts')
    expect(() => parseComposition({ ...facts, ingredients: ['fish'], dietaryLabels: ['vegetarian'] })).toThrow('contradicts')
  })
  it('rejects a removal claim for an ingredient not present in the declared composition', () => {
    expect(() => parseComposition({ ingredients: ['rice'], complete: true, source: 'merchant', revision: '1', removals: [{ ingredients: ['pork'], groupId: 'meat', valueId: 'none' }] })).toThrow('not present')
  })
})
