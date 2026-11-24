import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import type { createBrowserDialogue } from './browserDialogue'

import { array, literal, looseObject, safeParse, string, unknown } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const receiptSchema = looseObject({ ok: literal(true), source: literal('browser'), status: literal('verified'), cart: looseObject({ version: string(), lines: array(unknown()) }) })

/** A complete end-of-order utterance can start cart review, never authorize submission. */
export function finishedOrdering(text: string) {
  return /^(?:點好了|點完了|先這樣(?:好了?)?|先?這樣就好了?|就這樣(?:好了?)?)[。！!，,\s]*$/.test(text.trim())
}

/** Binds a checkout invitation to a verified cart snapshot. */
export function presentCheckoutInvitation(dialogue: ReturnType<typeof createBrowserDialogue>, facts: { cart: { version: string, lines: unknown[] } }) {
  const copy = orderingMessages['zh-Hant'].checkoutInvitation
  return dialogue.presentService({ ...facts, products: [] }, { purpose: 'review-checkout', request: '', question: copy.question, choices: [{ id: 'yes', description: copy.accept }, { id: 'no', description: copy.decline }] })
}

/**
 * Offers checkout only after a completed turn's cart change is read back fresh.
 * A short yes opens cart review; it never submits an order or authorizes payment.
 * Call at final reply presentation, after all requested operations have settled.
 */
export async function offerCheckout(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, dialogue: ReturnType<typeof createBrowserDialogue>, result: unknown, isCurrent: () => boolean) {
  const receipt = safeParse(receiptSchema, result)
  const review = client.tools.value.find(tool => tool.name === 'browser_cart_review')
  const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!receipt.success || !review || !read || !isCurrent() || dialogue.hasPending()
    || typeof receipt.output.effectMessage !== 'string' || !receipt.output.effectMessage.trim()
    || !receipt.output.cart.lines.length || receipt.output.effect === 'partial' || receipt.output.effect === 'unknown' || receipt.output.pendingCustomerChoice || receipt.output.needsAssistant) {
    return
  }
  try {
    const raw = await client.execute(read, { includeCatalog: false })
    const fresh = safeParse(looseObject({ ok: literal(true), source: literal('browser'), cart: looseObject({ version: string(), lines: array(unknown()) }) }), raw)
    if (!isCurrent() || !fresh.success || fresh.output.cart.version !== receipt.output.cart.version || !fresh.output.cart.lines.length || dialogue.hasPending())
      return
    const question = presentCheckoutInvitation(dialogue, fresh.output)
    return question.pendingCustomerChoice
  }
  catch {
    // The cart effect is already verified. A failed optional invitation read
    // must not erase success, retry the write, or fabricate a question binding.
    return undefined
  }
}
