import type { InferOutput } from 'valibot'

import { array, boolean, literal, number, object, optional, picklist, string } from 'valibot'

/** Values name actual PB invoice controls, not merchant-provided ingredient facts. */
export const pbInvoiceMethodSchema = picklist(['none', 'carrier', 'citizen', 'tax', 'donation'])
export type PbInvoiceMethod = InferOutput<typeof pbInvoiceMethodSchema>

/** Fresh rendered checkout fields. A snapshot never authorizes order submission. */
export const pbCheckoutSchema = object({
  methods: array(object({ method: pbInvoiceMethodSchema, label: string(), selected: boolean() })),
  fields: array(object({ kind: picklist(['carrier', 'citizen', 'tax', 'donation', 'phone', 'email']), label: string(), value: string(), valid: boolean() })),
  missing: array(string()),
  ready: boolean(),
  orderNote: string(),
  total: optional(number()),
  confirmationToken: optional(string()),
})
export type PbCheckout = InferOutput<typeof pbCheckoutSchema>

/** Native dispatch acknowledgement, never proof of merchant acceptance or payment. */
export const pbSubmissionDispatchSchema = object({ ok: literal(true), source: literal('browser'), code: literal('order-submission-starting'), effect: literal('pending'), confirmationToken: string(), customerMessage: string() })
