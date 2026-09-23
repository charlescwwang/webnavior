export type FulfillmentMode = 'dine-in' | 'takeout'
export type SubmissionEnvironment = 'test' | 'live'
export type SubmissionStatus = 'accepted' | 'rejected' | 'uncertain'
export type PaymentMethod = 'card' | 'mobile'
export type PaymentStatus = 'authorized' | 'pending' | 'rejected' | 'uncertain'

export interface PaymentIntent {
  amount: number
  id: string
  method: PaymentMethod
  status: PaymentStatus
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
  available: boolean
  category: string
  description: string
  id: string
  imageUrl: string
  name: string
  optionGroups: CatalogOptionGroup[]
  price: number
  recommendationTags: Array<'fried' | 'pork-free' | 'rice'>
  /** Textual fallback when the POS catalog does not provide a product image. */
  symbol: string
}

export interface CatalogSnapshot {
  items: CatalogItem[]
  revision: string
  store: {
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
  lines: CartLine[]
  total: number
}

export interface SubmissionReceipt {
  customerMessage: string
  environment: SubmissionEnvironment
  posOrderId?: string
  retryable: boolean
  status: SubmissionStatus
}

export interface SubmittedOrder {
  cart: CartSnapshot
  id: string
  receipt: SubmissionReceipt
}

export interface PosSubmission {
  cart: CartSnapshot
  idempotencyKey: string
}

/** The only vendor-facing port used by the POS Bridge. */
export interface PosGateway {
  createPayment: (amount: number, method: PaymentMethod) => Promise<PaymentIntent>
  getPayment: (paymentId: string) => Promise<PaymentIntent | undefined>
  getCatalog: () => Promise<CatalogSnapshot>
  submit: (submission: PosSubmission) => Promise<SubmissionReceipt>
}
