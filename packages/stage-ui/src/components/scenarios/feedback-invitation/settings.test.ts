import { describe, expect, it } from 'vitest'

import { canShowFeedbackInvitation, defaultFeedbackInvitationSettings, normalizeFeedbackInvitationDuration } from './settings'

describe('feedback invitation settings', () => {
  it('requires an enabled static HTTP(S) survey URL', () => {
    expect(canShowFeedbackInvitation(defaultFeedbackInvitationSettings)).toBe(false)
    expect(canShowFeedbackInvitation({
      ...defaultFeedbackInvitationSettings,
      enabled: true,
      surveyUrl: 'https://survey.example.com/customer-feedback',
    })).toBe(true)
    expect(canShowFeedbackInvitation({
      ...defaultFeedbackInvitationSettings,
      enabled: true,
      surveyUrl: 'javascript:alert(1)',
    })).toBe(false)
  })

  it('keeps the completion countdown within a customer-readable range', () => {
    expect(normalizeFeedbackInvitationDuration(Number.NaN)).toBe(30)
    expect(normalizeFeedbackInvitationDuration(2)).toBe(5)
    expect(normalizeFeedbackInvitationDuration(90.8)).toBe(90)
    expect(normalizeFeedbackInvitationDuration(999)).toBe(300)
  })
})
