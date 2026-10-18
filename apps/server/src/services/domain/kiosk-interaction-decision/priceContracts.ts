/** Single-dish base-price conditions in the catalog's integer currency units. */
export interface PriceConditions {
  minPrice?: number
  maxPrice?: number
  minPriceExclusive?: boolean
  maxPriceExclusive?: boolean
  priceOrder?: 'ASC'
}

/** Application-issued semantic choices; model selections never supply amounts. */
export interface PriceChoice {
  id: string
  description: string
  kind: 'condition' | 'information' | 'none' | 'unsupported'
  conditions?: PriceConditions
}

/** Literal currency/comparison evidence does not establish intent, polarity or order authority. */
export interface PriceEvidence {
  amounts: Array<{ text: string, amount: number }>
  choices: PriceChoice[]
}
