/** Short-lived bearer capability issued only with an accepted kiosk order. */
import type { FulfillmentMode, SubmissionEnvironment } from './contracts'

export interface ContinuationAccess {
  token: string
  expiresAt: number
}

/** Customer-visible order snapshot; it never exposes the original phone or payment capability. */
export interface ContinuationSnapshot {
  environment: SubmissionEnvironment
  /** Receipt links disclose order information without granting table/fulfillment writes. */
  readOnly?: boolean
  pickupNumber?: string
  expiresAt: number
  orderId: string
  /** Current test fulfillment choice; the original paid POS receipt is unchanged. */
  fulfillmentMode: FulfillmentMode
  phoneLabel?: string
  total: number
  lines: Array<{ name: string, quantity: number }>
  table?: { label: string, destination: string }
}
