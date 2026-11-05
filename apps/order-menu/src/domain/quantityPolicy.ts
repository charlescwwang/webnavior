import type { QuantityLimitRejection } from '@proj-airi/stage-shared/kiosk-conversation'

import { orderQuantityMaximum } from '@proj-airi/stage-shared/kiosk-conversation'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { parseNumericSlot } from './numericSlots'
/** Reject only explicit oversized meal counts; malformed inputs retain their normal validation. */
export function rejectQuantity(toolName: string, quantity: unknown): QuantityLimitRejection | undefined {
  if (!['order_add_item', 'cart_add_item', 'menu_set_quantity', 'cart_set_line_quantity', 'cart_set_line_option'].includes(toolName) || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= orderQuantityMaximum)
    return
  return { ok: false, executed: false, rejection: 'quantity-limit', error: 'QUANTITY_LIMIT', toolName, maximum: orderQuantityMaximum, requestedQuantity: quantity, customerMessage: orderingMessages['zh-Hant'].quantityLimit }
}

/** Domain refusal before a cart commit; carries the count that exceeded the policy. */
export class QuantityLimitError extends Error {
  constructor(readonly quantity: number) {
    super(orderingMessages['zh-Hant'].quantityLimit)
    this.name = 'QuantityLimitError'
  }
}

/** Extract count evidence, not intent; Main still resolves negations and which item each count belongs to. */
export function mentionedServingCounts(transcript: string): number[] {
  const counts: number[] = []
  for (const match of transcript.normalize('NFKC').matchAll(/(?:^|[^\d.-])([零〇一二兩两三四五六七八九十百千萬万\d]+)\s*[份個碗杯]/g)) {
    const count = parseNumericSlot(match[1]!)
    if (count !== undefined && Number.isSafeInteger(count))
      counts.push(count)
  }
  return counts.slice(0, 100)
}
