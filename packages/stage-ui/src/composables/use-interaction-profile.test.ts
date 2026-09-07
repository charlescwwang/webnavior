import { describe, expect, it } from 'vitest'

import { createDefaultInteractionProfile } from './use-interaction-profile'

describe('createDefaultInteractionProfile', () => {
  it('creates a clean profile without carrying settings from legacy host keys', () => {
    const profile = createDefaultInteractionProfile('http://localhost:5174')

    expect(profile).toEqual({
      version: 1,
      services: [{
        enabled: true,
        id: 'restaurant-ordering',
        title: '餐點點餐',
        description: '協助顧客瀏覽菜單、客製餐點、管理購物車與確認訂單。',
        serviceUrl: 'http://localhost:5174',
      }],
      agentInstructions: '',
      feedbackInvitation: expect.objectContaining({ enabled: false, surveyUrl: '' }),
    })
  })

  it('does not share mutable defaults between new profiles', () => {
    const first = createDefaultInteractionProfile('http://first.example')
    const second = createDefaultInteractionProfile('http://second.example')

    first.feedbackInvitation.title = '修改過的標題'

    expect(second.feedbackInvitation.title).toBe('感謝您的訂購')
  })
})
