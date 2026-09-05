/** Settings for a short, host-owned invitation shown after an interaction completes. */
export interface FeedbackInvitationSettings {
  /** Whether a completed interaction should show the invitation. @default false */
  enabled: boolean
  /** The HTTP(S) survey page encoded into the locally generated QR code. */
  surveyUrl: string
  /** Seconds before the invitation closes itself. @default 30 */
  displayDurationSeconds: number
  /** Customer-facing invitation heading. */
  title: string
  /** Customer-facing context shown below the heading. */
  description: string
  /** Customer-facing action that closes the invitation immediately. */
  dismissLabel: string
}

/** Default copy and behavior for a newly configured interactive-service host. */
export const defaultFeedbackInvitationSettings: FeedbackInvitationSettings = {
  enabled: false,
  surveyUrl: '',
  displayDurationSeconds: 30,
  title: '感謝您的訂購',
  description: '歡迎掃描 QR Code 填寫簡短問卷，協助我們提供更好的服務。',
  dismissLabel: '略過，結束本次接待',
}

/**
 * Returns whether an invitation can safely be presented to a customer.
 *
 * The first release deliberately accepts only a static HTTP(S) URL. Hosts must
 * not append orders, conversations, member identifiers, or other customer data
 * before placing the URL in the QR code.
 */
export function canShowFeedbackInvitation(settings: FeedbackInvitationSettings) {
  if (!settings.enabled || !settings.surveyUrl.trim())
    return false

  try {
    const url = new URL(settings.surveyUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

/** Clamps administrator-entered countdown values to a customer-readable interval. */
export function normalizeFeedbackInvitationDuration(value: number) {
  if (!Number.isFinite(value))
    return defaultFeedbackInvitationSettings.displayDurationSeconds

  return Math.min(300, Math.max(5, Math.trunc(value)))
}
