/** Service policy is independent from microphone, speech admission and presence settings. */
export type ServiceMode = 'kiosk' | 'table-service'
export type BackgroundSpeechMode = 'off' | 'observe' | 'enforce'

/** Server-issued order-round configuration; a cart retains this snapshot until reset. */
export interface OrderingContext {
  id: string
  serviceMode: ServiceMode
  table?: { id: string, label: string }
  directSubmissionSupported: boolean
}

const policies = {
  'kiosk': { requiresPayment: true, choosesFulfillment: true, showsPickupNumber: true },
  'table-service': { requiresPayment: false, choosesFulfillment: false, showsPickupNumber: false },
} as const

/** Use the pinned order context rather than a freshly refreshed device preference. */
export function servicePolicy(mode: ServiceMode) {
  return policies[mode]
}
