import { array, boolean, integer, looseObject, minLength, minValue, number, pipe, string } from 'valibot'

/** Explicit customer choices bound to one observed product configuration. */
export interface ProductSelection {
  version: string
  variantRef: string
  /** Quantities apply to one serving; the cart operation owns the number of meals. */
  choices: { ref: string, quantity: number }[]
}

/** Vendor option limits are per serving, not multiplied by the cart quantity. */
export interface ProductConfiguration {
  version: string
  variantRef: string
  name: string
  unitPrice: number
  groups: {
    ref: string
    name: string
    required: boolean
    maximum: number
    choices: { ref: string, name: string, unitPrice: number, maximum: number }[]
  }[]
}

/** Validates a configuration read across the browser/Host boundary. */
export const productConfigurationSchema = looseObject({
  version: pipe(string(), minLength(1)),
  variantRef: string(),
  name: string(),
  unitPrice: pipe(number(), minValue(0)),
  groups: array(looseObject({ ref: string(), name: string(), required: boolean(), maximum: pipe(number(), integer(), minValue(1)), choices: array(looseObject({ ref: string(), name: string(), unitPrice: pipe(number(), minValue(0)), maximum: pipe(number(), integer(), minValue(1)) })) })),
})
