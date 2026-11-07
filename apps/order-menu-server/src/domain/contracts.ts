import type { Composition } from './composition'
import type { RecommendationSignal } from './recommendation'
import type { HoldRequest, SeatingSnapshot, TableHold } from './seatingContracts'

export type FulfillmentMode = 'dine-in' | 'takeout'
export type SubmissionEnvironment = 'test' | 'live'
export type SubmissionStatus = 'accepted' | 'rejected' | 'uncertain'
export type PaymentMethod = 'card' | 'mobile' | 'linepay' | 'jkopay'
export type PaymentStatus = 'authorized' | 'pending' | 'rejected' | 'uncertain'

export interface PaymentIntent {
  amount: number
  id: string
  method: PaymentMethod
  status: PaymentStatus
  /** Private seating capability bound to this payment, not a model reference. */
  tableHoldId?: string
}

export interface CatalogOptionValue {
  id: string
  label: string
  priceDelta: number
}

export interface CatalogOptionGroup {
  id: string
  label: string
  required: boolean
  values: CatalogOptionValue[]
}

export interface CatalogItem {
  recommendationSignals?: RecommendationSignal[]
  composition: Composition
  available: boolean
  aliases?: string[]
  category: string
  description: string
  id: string
  imageUrl: string
  name: string
  optionGroups: CatalogOptionGroup[]
  price: number
  recommendationTags: Array<'fried' | 'rice'>
  /** Textual fallback when the POS catalog does not provide a product image. */
  symbol: string
}

export interface CatalogSnapshot {
  items: CatalogItem[]
  revision: string
  store: {
    fulfillmentModes: Array<{ id: FulfillmentMode, label: string }>
    name: string
    slogan: string
    symbol: string
  }
}

export interface CartLine {
  id: string
  itemId: string
  name: string
  options: Record<string, string>
  quantity: number
  unitPrice: number
}

export interface CartSnapshot {
  catalogRevision: string
  fulfillmentMode: FulfillmentMode
  itemCount: number
  paymentId: string
  tableHoldId?: string
  lines: CartLine[]
  total: number
}

export interface SubmissionReceipt {
  customerMessage: string
  environment: SubmissionEnvironment
  /** Application-issued three-digit collection number, assigned only to accepted orders. */
  pickupNumber?: string
  posOrderId?: string
  retryable: boolean
  status: SubmissionStatus
}

export interface SubmittedOrder {
  cart: CartSnapshot
  id: string
  receipt: SubmissionReceipt
}

/** Explicit unpaid table order; never a paid cart with a fabricated payment identifier. */
export interface TableOrderSubmission {
  confirmedByUser: true
  contextId: string
  idempotencyKey: string
  cart: Pick<CartSnapshot, 'catalogRevision' | 'itemCount' | 'lines' | 'total'>
}

export interface SubmittedTableOrder {
  id: string
  serviceMode: 'table-service'
  table: { id: string, label: string }
  cart: TableOrderSubmission['cart'] & { fulfillmentMode: 'dine-in' }
  receipt: SubmissionReceipt
}

export interface PosSubmission {
  cart: CartSnapshot
  idempotencyKey: string
}

/** The only vendor-facing port used by the POS Bridge. */
export interface PosGateway {
  /** Absent means the adapter has no explicit unpaid table-order capability. */
  submitTableOrder?: (submission: TableOrderSubmission & { table: { id: string, label: string } }) => Promise<SubmissionReceipt>
  createPayment: (amount: number, method: PaymentMethod, tableHoldId?: string) => Promise<PaymentIntent>
  getSeating: () => Promise<SeatingSnapshot>
  reserveTables: (request: HoldRequest) => Promise<TableHold>
  getTableHold: (id: string) => Promise<TableHold | undefined>
  releaseTables: (id: string) => Promise<void>
  getPayment: (paymentId: string) => Promise<PaymentIntent | undefined>
  getCatalog: () => Promise<CatalogSnapshot>
  submit: (submission: PosSubmission) => Promise<SubmissionReceipt>
}
