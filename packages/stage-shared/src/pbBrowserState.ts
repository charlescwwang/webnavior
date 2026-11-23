import { array, finite, integer, literal, looseObject, maxLength, minLength, minValue, number, optional, picklist, pipe, regex, string, union } from 'valibot'

import { pbOrderStateSchema } from './pbCheckout'
import { productConfigurationSchema } from './productConfiguration'

const reference = pipe(string(), minLength(1), maxLength(200), regex(/\S/u))

/** Successful PB reads identify their current page before any planning branch. */
export const pbReadStateSchema = looseObject({
  ok: literal(true),
  source: literal('browser'),
  page: picklist(['table', 'menu', 'cart', 'checkout', 'payment', 'order-result']),
})

/** Explicit rows distinguish an observed empty cart from an unreadable cart. */
export const pbCartStateSchema = looseObject({
  version: reference,
  lines: array(looseObject({
    ref: reference,
    name: pipe(string(), minLength(1)),
    quantity: pipe(number(), integer(), minValue(1)),
    productRef: optional(reference),
    configuration: optional(string()),
    unitPrice: optional(pipe(number(), finite(), minValue(0))),
  })),
})

/** Table discovery has no cart or catalog requirement and cannot create food. */
export const pbTableStateSchema = looseObject({
  ...pbReadStateSchema.entries,
  page: literal('table'),
  tableChoices: pipe(array(reference), minLength(1)),
  selectedTable: optional(reference),
})

/** Common editor receipt; catalog validation belongs to reads that request it. */
export const pbEditorStateSchema = looseObject({
  ...pbReadStateSchema.entries,
  page: picklist(['menu', 'cart', 'checkout']),
  cart: pbCartStateSchema,
})

/** Completed orders expose read-only facts, never an editable cart. */
export const pbOrderReadStateSchema = looseObject({
  ...pbReadStateSchema.entries,
  page: picklist(['payment', 'order-result']),
  observedAt: number(),
  order: pbOrderStateSchema,
})

/** Successful context reads must satisfy exactly the current page's contract. */
export const pbBrowserStateSchema = union([pbTableStateSchema, pbEditorStateSchema, pbOrderReadStateSchema])

/** Full-catalog reads require an explicit catalog; [] means verified no matches. */
export const pbCatalogStateSchema = looseObject({
  ...pbEditorStateSchema.entries,
  products: array(looseObject({
    ref: reference,
    name: pipe(string(), minLength(1)),
    price: optional(pipe(number(), finite(), minValue(0))),
    configurations: array(productConfigurationSchema),
  })),
})
