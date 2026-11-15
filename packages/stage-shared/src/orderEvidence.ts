import type { InferOutput } from 'valibot'

import { check, integer, literal, maxLength, maxValue, minLength, minValue, number, picklist, pipe, regex, strictObject, string } from 'valibot'

const identifier = pipe(string(), minLength(1), maxLength(200))
const digest = pipe(string(), regex(/^[a-f0-9]{64}$/))
const instant = pipe(string(), check(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Use an exact UTC ISO timestamp'))
export const orderEvidenceMaxBytes = 1024 * 1024
/** JSON envelope quoting can double the UTF-8 content size; metadata is bounded separately. */
export const orderEvidenceMaxRequestBytes = 3 * orderEvidenceMaxBytes
export const orderEvidenceMerchantSchema = strictObject({ origin: pipe(string(), maxLength(200)), store: identifier, flow: picklist(['pick_up', 'internal_use']) })
/** Registration fixes ownership before the original visitor retires; it grants archival rights only. */
export const orderEvidenceRegistrationSchema = strictObject({ schemaVersion: literal(1), operationId: identifier, visitorSessionId: identifier, serviceId: identifier, documentId: identifier, source: picklist(['ai', 'touch']), merchant: orderEvidenceMerchantSchema, expectedDigest: digest })
export const orderEvidenceBindingSchema = strictObject({ schemaVersion: literal(1), bindingId: identifier, siteId: identifier, deviceId: identifier, createdAt: instant })
export type OrderEvidenceBinding = InferOutput<typeof orderEvidenceBindingSchema>
/** Hash and byteSize describe the exact canonical, sanitized UTF-8 payloadJson. */
export const orderEvidenceEnvelopeSchema = strictObject({ schemaVersion: literal(1), evidenceId: identifier, bindingId: identifier, source: picklist(['page', 'readonly']), capturedAt: instant, sourcePath: pipe(string(), minLength(1), maxLength(1000)), sanitizerVersion: literal(1), payloadJson: pipe(string(), maxLength(orderEvidenceMaxBytes)), payloadHash: digest, byteSize: pipe(number(), integer(), minValue(1), maxValue(orderEvidenceMaxBytes)) })
export const orderEvidenceAckSchema = strictObject({ schemaVersion: literal(1), evidenceId: identifier, payloadHash: digest, byteSize: pipe(number(), integer(), minValue(1), maxValue(orderEvidenceMaxBytes)), storedAt: instant, durabilityVersion: literal(1) })
export type OrderEvidenceRegistration = InferOutput<typeof orderEvidenceRegistrationSchema>
export type OrderEvidenceEnvelope = InferOutput<typeof orderEvidenceEnvelopeSchema>
export type OrderEvidenceAck = InferOutput<typeof orderEvidenceAckSchema>
export type OrderEvidenceMerchant = InferOutput<typeof orderEvidenceMerchantSchema>

/** Only exact same-store draft/result paths are archival sources, never payment-platform URLs. */
export function isOrderEvidencePath(path: string, merchant: OrderEvidenceMerchant) {
  const prefix = `/order/store/${merchant.store}/${merchant.flow}/orders/`
  if (!path.startsWith(prefix))
    return false
  const suffix = path.slice(prefix.length)
  return suffix === 'create' || (suffix.split('/')[0] !== 'create' && /^[\w-]{1,200}(?:\/choosePayment)?$/.test(suffix))
}

/**
 * Preserves unknown nested business fields while excluding credentials before any storage.
 * The sorted serialization is the wire/digest contract; array and detail-row order is retained.
 */
export function sanitizeOrderBusinessPayload(input: unknown, merchant: OrderEvidenceMerchant): string {
  const prohibited = /authorization|cookie|csrf|token|secret|password|credential|cardnumber|cardno|cardnum|cvv|cvc|accesskey|privatekey|signature|sessionid|securitycode/i
  function clean(value: unknown, depth: number): unknown {
    if (depth > 32)
      throw new Error('Order evidence exceeds the structural depth limit')
    if (value === null || typeof value === 'boolean' || typeof value === 'number')
      return value
    if (typeof value === 'string') {
      if (/^(?:https?:\/\/|\/order\/)/i.test(value)) {
        try {
          const url = new URL(value, merchant.origin)
          if (url.origin !== merchant.origin || url.username || url.password || !isOrderEvidencePath(url.pathname, merchant))
            return undefined
          return `${url.origin}${url.pathname}`
        }
        catch { return undefined }
      }
      return value
    }
    if (Array.isArray(value))
      return value.map(item => clean(item, depth + 1) ?? null)
    if (!value || typeof value !== 'object')
      return undefined
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).flatMap(([key, nested]) => {
      if (prohibited.test(key.replaceAll(/[^a-z0-9]/gi, '')) || key.toLowerCase() === 'pan' || ['__proto__', 'constructor', 'prototype'].includes(key))
        return []
      if (typeof nested === 'string' && /(?:url|href|link)$/i.test(key)) {
        try {
          const url = new URL(nested, merchant.origin)
          if (url.origin !== merchant.origin || url.username || url.password || !isOrderEvidencePath(url.pathname, merchant))
            return []
          nested = `${url.origin}${url.pathname}`
        }
        catch { return [] }
      }
      const filtered = clean(nested, depth + 1)
      return filtered === undefined ? [] : [[key, filtered]]
    }))
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Order evidence must contain a business object')
  const roots = new Set(['component', 'order', 'details', 'invoices', 'times', 'actions', 'totals', 'payMethods'])
  return JSON.stringify(clean(Object.fromEntries(Object.entries(input).filter(([key]) => roots.has(key))), 0))
}
