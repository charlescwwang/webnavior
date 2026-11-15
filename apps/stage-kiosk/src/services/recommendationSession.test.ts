import { expect, it } from 'vitest'

import { createRecommendationSession } from './recommendationSession'

const products = [{ name: '牛肉湯', category: '湯', configurations: [{ unitPrice: 120 }] }, { name: '蛋花湯', category: '湯', configurations: [{ unitPrice: 40 }] }, { name: '雞腿飯', category: '飯', configurations: [{ unitPrice: 130 }] }]
it('preserves reception price/exclusions across categories and clears only an accepted price relaxation', () => {
  const session = createRecommendationSession(() => 'one')
  session.update({ maxUnitPrice: 100, priceScope: 'reception', excludedTerms: ['牛肉'] })
  session.update({ category: '湯' })
  expect(session.filter(products).map(product => product.name)).toEqual(['蛋花湯'])
  session.update({ clearPrice: true })
  expect(session.snapshot().excludedTerms).toEqual(['牛肉'])
  expect(session.snapshot().maxUnitPrice).toBeUndefined()
})
it('drops a category-only price when changing category and isolates a new reception', () => {
  let owner = 'one'
  const session = createRecommendationSession(() => owner)
  session.update({ category: '飯', maxUnitPrice: 100, priceScope: 'category' })
  expect(session.filter(products)).toEqual([])
  session.update({ category: '湯' })
  expect(session.filter(products)).toHaveLength(2)
  owner = 'two'
  expect(session.snapshot().category).toBeUndefined()
  expect(session.filter(products)).toHaveLength(3)
})

it('adds exclusions without erasing earlier ones and can relax one named exclusion', () => {
  const session = createRecommendationSession(() => 'one')
  session.update({ excludedTerms: ['牛肉'] })
  session.update({ excludedTerms: ['豬肉'] })
  expect(session.snapshot().excludedTerms).toEqual(['牛肉', '豬肉'])
  session.update({ allowedTerms: ['牛肉'] })
  expect(session.snapshot().excludedTerms).toEqual(['豬肉'])
})
