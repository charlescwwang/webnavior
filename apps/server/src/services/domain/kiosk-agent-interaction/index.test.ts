import { describe, expect, it } from 'vitest'

import { createInteractionInstructions, defaultKioskAgentInteractionState, recordCustomerInput, recordToolResults } from '.'

describe('kiosk Agent interaction', () => {
  it('treats an alternative request as exploration and excludes the prior batch', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll', 'minced-pork-rice'] } }),
      name: 'menu_show_recommendations',
    }])

    expect(recordCustomerInput(shown, '有沒有其他推薦的？')).toMatchObject({
      dismissedSubjectIds: ['shrimp-roll', 'minced-pork-rice'],
      recentUserIntent: 'request_alternatives',
      suggestedSubjectIds: [],
    })
  })

  it('enters decision guidance only after repeated unchanged rendered recommendations', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])
    const onceRepeated = recordToolResults(shown, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])
    const twiceRepeated = recordToolResults(onceRepeated, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])

    expect(onceRepeated.mode).toBe('active')
    expect(twiceRepeated.mode).toBe('decision_guidance')
    expect(createInteractionInstructions(twiceRepeated)).toContain('2 至 3 個')
  })

  it('returns to active exploration when the Agent actually presents unseen choices', () => {
    const stagnant = {
      ...defaultKioskAgentInteractionState,
      mode: 'decision_guidance' as const,
      noProgressCount: 2,
      suggestedSubjectIds: ['shrimp-roll'],
    }

    expect(recordToolResults(stagnant, [{
      content: JSON.stringify({ presentation: { itemIds: ['fish-floss-rice'] } }),
      name: 'menu_show_recommendations',
    }])).toMatchObject({ mode: 'active', noProgressCount: 0, suggestedSubjectIds: ['shrimp-roll', 'fish-floss-rice'] })
  })
})
