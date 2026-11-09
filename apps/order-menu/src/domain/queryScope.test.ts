import { describe, expect, it } from 'vitest'

import { createQueryScope } from './queryScope'

const revisions = { menu: 1, recommendation: 2 }
function offer(expiresAt = 200) {
  return createQueryScope({ questionId: 'scope-1', expiresAt, revisions, shownItemIds: ['dumpling', 'beef-noodles'], conditions: { maxPrice: 120, excludeIngredients: ['wheat'], dietary: 'vegetarian' } })
}

describe('query scope prototype state', () => {
  it('explains the two search universes after an unclear answer without changing authority or conditions', () => {
    const flow = offer()
    const original = flow.question.question
    expect(flow.resolve({ questionId: 'scope-1', choice: 'ASK' }, revisions, 100)).toMatchObject({ status: 'WAITING', question: { question: original } })
    const result = flow.resolve({ questionId: 'scope-1', choice: 'ASK', transcript: '兩個有什麼差別？' }, revisions, 100)
    expect(result).toMatchObject({ status: 'WAITING', question: { questionId: 'scope-1', expiresAt: 200, choices: flow.question.choices } })
    expect(result).toHaveProperty('question.question', '剛才推薦的是只查剛才介紹的那幾道；整份菜單是查店裡所有餐點。你想查哪個範圍？')
    expect(flow.resolve({ questionId: 'scope-1', choice: 'SHOWN', transcript: '前面的' }, revisions, 100)).toMatchObject({ status: 'QUERY', scope: 'SHOWN', itemIds: ['dumpling', 'beef-noodles'], conditions: { maxPrice: 120 } })
  })
  // Report: this chat, 2026-10-19; scope answers must not drop new conditions.
  it('hands off new price evidence even when the model only selects the catalog', () => {
    const flow = offer()
    expect(flow.resolve({ questionId: 'scope-1', choice: 'CATALOG', transcript: '整份菜單，不過改成100以下' }, revisions, 100)).toEqual({ status: 'NEW_REQUEST', transcript: '整份菜單，不過改成100以下' })
    expect(flow.resolve({ questionId: 'scope-1', choice: 'CATALOG' }, revisions, 100)).toEqual({ status: 'STALE' })
  })

  it('preserves the pending question after an uncertain interpretation', () => {
    const flow = offer()
    expect(flow.resolve({ questionId: 'scope-1', choice: 'ASK', transcript: '好' }, revisions, 100)).toMatchObject({ status: 'WAITING', question: { questionId: 'scope-1' } })
    expect(flow.resolve({ questionId: 'scope-1', choice: 'SHOWN' }, revisions, 100)).toMatchObject({ status: 'QUERY', itemIds: ['dumpling', 'beef-noodles'], conditions: { maxPrice: 120, excludeIngredients: expect.arrayContaining(['wheat', 'pork', 'beef']), dietary: 'vegetarian' } })
  })

  it('does not create a new-request handoff without the original customer input', () => {
    const flow = offer()
    expect(flow.resolve({ questionId: 'scope-1', choice: 'NEW_REQUEST' }, revisions, 100)).toMatchObject({ status: 'WAITING' })
    expect(flow.resolve({ questionId: 'scope-1', choice: 'CATALOG' }, revisions, 100)).toMatchObject({ status: 'QUERY', scope: 'CATALOG' })
  })

  it.each([
    { questionId: 'another-question', current: revisions, now: 100 },
    { questionId: 'scope-1', current: { menu: 2, recommendation: 2 }, now: 100 },
    { questionId: 'scope-1', current: { menu: 1, recommendation: 3 }, now: 100 },
  ])('rejects stale or mismatched authority: %j', ({ questionId, current, now }) => {
    expect(offer().resolve({ questionId, choice: 'CATALOG' }, current, now)).toEqual({ status: 'STALE' })
  })
  it('binds a complete ordinal to the question options even if the model proposes the other scope', () => {
    const flow = offer()
    expect(flow.resolve({ questionId: 'scope-1', choice: 'SHOWN', transcript: '第二個' }, revisions, 100)).toMatchObject({ status: 'QUERY', scope: 'CATALOG' })
  })

  it('does not consume only the ordinal part of a changed-price request', () => {
    const flow = offer()
    expect(flow.resolve({ questionId: 'scope-1', choice: 'SHOWN', transcript: '第二個，改成100以下' }, revisions, 100)).toMatchObject({ status: 'NEW_REQUEST', transcript: '第二個，改成100以下' })
  })
})

// Silence does not change the meaning of a still-visible scope question.
it('accepts a scope answer after the former time limit while retaining one-use consumption', () => {
  const flow = offer()
  expect(flow.resolve({ questionId: 'scope-1', choice: 'CATALOG' }, revisions, 90000)).toMatchObject({ status: 'QUERY', scope: 'CATALOG' })
  expect(flow.resolve({ questionId: 'scope-1', choice: 'CATALOG' }, revisions, 90001)).toEqual({ status: 'STALE' })
})
