import type { kioskInteractionEntries } from '../../../schemas/kiosk'
import type { BrowserPlan } from './contracts'

import { quantityFromTranscript } from '@proj-airi/stage-shared/ordering-slots'

import { normalizeTranscript } from '../kiosk-interaction-decision/context'

/** Object key order is transport formatting; array order and all values remain significant. */
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`
  return JSON.stringify(value)
}

/**
 * Matches server-issued Main calls or a bounded Jev intent to the current demand.
 * Does not interpret language again. Fresh vendor identity/version/selection and
 * full-cart verification remain mandatory in the document executor.
 * The caller consumes the returned key atomically under the visitor row lock.
 */
export function resolvePlan(entries: (typeof kioskInteractionEntries.$inferSelect)[], plan: BrowserPlan) {
  const user = entries.findLast(entry => entry.kind === 'user_text')
  if (!user || user.content.trim() !== plan.effect.transcript.trim())
    return
  let args: Record<string, unknown>
  try {
    args = JSON.parse(plan.arguments)
  }
  catch { return }
  if (!args || Array.isArray(args) || typeof args !== 'object')
    return
  const expectedAction = { browser_cart_add: 'add', browser_cart_quantity: 'quantity', browser_cart_remove: 'remove', browser_cart_replace: 'replace' }[plan.toolName]
  if (plan.effect.action !== expectedAction)
    return
  for (const entry of [...entries].reverse()) {
    const authority = entry.metadata.browserAuthority
    if (!authority || typeof authority !== 'object' || !('source' in authority) || authority.source !== plan.source)
      continue
    if (plan.source === 'main') {
      if (!('userEntryId' in authority) || authority.userEntryId !== user.id || !('readOnly' in authority) || authority.readOnly !== false || !Array.isArray(entry.metadata.toolCalls))
        continue
      for (const call of entry.metadata.toolCalls) {
        if (!call || typeof call !== 'object' || typeof call.id !== 'string' || call.function?.name !== plan.toolName || typeof call.function.arguments !== 'string')
          continue
        try {
          if (canonical(JSON.parse(call.function.arguments)) === canonical(args))
            return { key: `main:${entry.id}:${call.id}`, provider: 'main' as const, userEntryId: user.id }
        }
        catch { /* A malformed issued call cannot authorize an executable plan. */ }
      }
    }
    else {
      if (!('transcript' in authority) || authority.transcript !== normalizeTranscript(user.content).normalized || !('utteranceId' in authority) || authority.utteranceId !== user.metadata.utteranceId || authority.utteranceId === undefined || !('actionId' in authority) || authority.actionId !== 'intent:add-item' || Date.now() - entry.createdAt.getTime() > 120_000)
        continue
      const products = plan.effect.deltas.filter(delta => delta.kind === 'product')
      if (plan.toolName !== 'browser_cart_add' || products.length !== 1 || plan.effect.deltas.length !== 1 || plan.effect.note || args.note !== '')
        return
      const product = products[0]
      const transcript = user.content.replaceAll(/\s/g, '')
      if (!transcript.includes(product.name))
        return
      const remainder = transcript.replace(product.name, '').replace(/[，。！!、]/g, '')
      if (!/^(?:[請要加來]|幫我|請幫我|我要|我想要|再加)?(?:要|加)?(?:[1-9]|1\d|20|[一二兩三四五六七八九十]{1,3})份(?:謝謝)?$/.test(remainder) || quantityFromTranscript(remainder) !== args.quantity || product.quantity !== args.quantity)
        return
      const selection = args.selection
      if (!selection || typeof selection !== 'object' || !('variantRef' in selection) || selection.variantRef !== '' || !('choices' in selection) || !Array.isArray(selection.choices) || selection.choices.length)
        return
      return { key: `system-one:${entry.id}`, provider: 'system-one' as const, userEntryId: user.id }
    }
  }
}
