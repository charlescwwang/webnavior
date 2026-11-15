import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import type { createBrowserDialogue } from './browserDialogue'

import { array, literal, looseObject, safeParse, string, unknown } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const receiptSchema = looseObject({ ok: literal(true), source: literal('browser'), status: literal('verified'), cart: looseObject({ version: string(), lines: array(unknown()) }) })

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
    const raw = await client.execute(read, { includeCatalog: true })
    const fresh = safeParse(looseObject({ ok: literal(true), source: literal('browser'), cart: looseObject({ version: string(), lines: array(unknown()) }) }), raw)
    if (!isCurrent() || !fresh.success || fresh.output.cart.version !== receipt.output.cart.version || !fresh.output.cart.lines.length || dialogue.hasPending())
      return
    const copy = orderingMessages['zh-Hant'].checkoutInvitation
    const question = dialogue.presentService(raw, { purpose: 'review-checkout', request: '', question: copy.question, choices: [{ id: 'yes', description: copy.accept }, { id: 'no', description: copy.decline }] })
    return question.pendingCustomerChoice
  }
  catch {
    // The cart effect is already verified. A failed optional invitation read
    // must not erase success, retry the write, or fabricate a question binding.
    return undefined
  }
}
