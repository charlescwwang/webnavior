import type { PresentedQuestion } from '../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { DecisionContext } from './kiosk-intents'

import { orderingMessages } from '../../../packages/i18n/src/orderingMessages'
import { mentionedIngredients } from './domain/composition'
import { resolveIntent } from './kiosk-intents'

export const mealMessages = orderingMessages['zh-Hant']

interface Proposal {
  id: string
  itemId: string
  label: string
  context: DecisionContext
  expiresAt: number
  repeatCurrent: boolean
}

/** Browser-owned yes/no lifecycle. A proposal never authorizes a cart write. */
export function createMealClarification() {
  let offer: Proposal | undefined
  let pending: (Proposal & { attempts: number }) | undefined
  const current = (proposal: Proposal, context: DecisionContext) => proposal.expiresAt > Date.now()
    && context.phase === 'ordering'
    && proposal.context.revisions.menu === context.revisions.menu
    && proposal.context.revisions.cart === context.revisions.cart
    && proposal.context.revisions.checkout === context.revisions.checkout
    && proposal.context.revisions.selectedItem === context.revisions.selectedItem
    && context.menu.some(item => item.id === proposal.itemId && item.available !== false)

  function question(context: DecisionContext): PresentedQuestion | undefined {
    if (pending && !current(pending, context))
      pending = undefined
    if (!pending)
      return undefined
    return {
      questionId: pending.id,
      purpose: 'confirm-meal',
      question: `${mealMessages.confirmMeal.replace('{item}', pending.label)}${pending.attempts > 1 ? mealMessages.useButtons : ''}`,
      expiresAt: pending.expiresAt,
      choices: [
        { id: `confirm-meal:${pending.id}:yes`, description: `${mealMessages.yes}，確認要點${pending.label}；繼續補必要資料，尚不授權付款。` },
        { id: `confirm-meal:${pending.id}:no`, description: `${mealMessages.no}，結束這次品名確認，保留原本點餐進度。` },
      ],
    }
  }

  function inquiry(context: DecisionContext) {
    if (!pending || !current(pending, context))
      return undefined
    const products = context.catalogEvidence.products
    const remainingSpeech = products.reduce((speech, product) => speech.replace(product.matchedText, ''), context.transcript ?? '')
    // This shortcut only supplies the omitted subject of an availability read.
    // A different dish, category or condition needs its normal bounded routing.
    if (products.some(product => product.label !== pending!.label)
      || (context.catalogEvidence.categories.length && !products.length)
      || context.priceEvidence || context.dietaryReferences.length || context.unavailableConditionReferences.length || mentionedIngredients(remainingSpeech).length) {
      return undefined
    }
    return context.menu.find(item => item.id === pending!.itemId)
  }

  return {
    question,
    /** Read target only when the current utterance can inherit this proposal. */
    inquiry,
    /** Resolves the live proposal for a read, without converting it to an order. */
    inquire(questionId: string, context: DecisionContext) {
      const item = inquiry(context)
      if (!item || pending?.id !== questionId)
        throw new Error('STALE_PLAN: The meal inquiry expired or changed.')
      pending = undefined
      offer = undefined
      return item
    },
    offer(context: DecisionContext, configuringItemId?: string, eligible = true) {
      offer = undefined
      // Price-qualified speech keeps its bounded price interpretation. Never
      // turn a partial budget/filter into permission to purchase one dish.
      if (!eligible || question(context) || context.phase !== 'ordering' || context.priceEvidence || context.productResolution.references.length !== 1)
        return undefined
      const reference = context.productResolution.references[0]!
      const item = context.menu.find(item => `item:${item.id}` === reference.refId && item.available !== false)
      if (!item || !context.catalogEvidence.products.some(evidence => evidence.label === item.name))
        return undefined
      const evidence = context.catalogEvidence.products.find(evidence => evidence.label === item.name)!
      const remainingSpeech = (context.transcript ?? '').replace(evidence.matchedText, '')
      // A name-only question cannot confirm an omitted dietary/ingredient or
      // unsupported requirement. Keep that whole request on its normal route.
      if (context.dietaryReferences.length || context.unavailableConditionReferences.length || mentionedIngredients(remainingSpeech).length)
        return undefined
      offer = { id: crypto.randomUUID(), itemId: item.id, label: item.name, context, expiresAt: Date.now() + 30_000, repeatCurrent: item.id === configuringItemId }
      return { id: offer.id, label: offer.label }
    },
    request(questionId: string, context: DecisionContext) {
      if (pending?.id === questionId && current(pending, context)) {
        pending.attempts++
      }
      else {
        if (!offer || offer.id !== questionId || !current(offer, context))
          throw new Error('STALE_PLAN: The meal clarification offer expired or changed.')
        if (offer.repeatCurrent) {
          offer = undefined
          return { repeatCurrent: true as const }
        }
        pending = { ...offer, attempts: 1 }
        offer = undefined
      }
      return { repeatCurrent: false as const, question: question(context)!, speak: pending!.attempts <= 2 }
    },
    consume(candidateId: string, context: DecisionContext) {
      if (!pending || !current(pending, context) || ![`confirm-meal:${pending.id}:yes`, `confirm-meal:${pending.id}:no`].includes(candidateId))
        throw new Error('STALE_PLAN: The meal confirmation expired, changed or was already answered.')
      const accepted = pending
      pending = undefined
      offer = undefined
      if (candidateId.endsWith(':no'))
        return undefined
      // The affirmative answer establishes the proposed catalog target. Keep
      // the source utterance intact so its quantities/options are still parsed.
      const reference = { refId: `item:${accepted.itemId}`, label: accepted.label }
      const candidate = { id: 'intent:add-item', intent: 'ADD_ITEM' as const, description: '新增顧客剛確認的餐點。' }
      const source = accepted.context
      const resolution = resolveIntent(candidate, {
        ...source,
        candidates: [candidate],
        references: [reference],
        targetConstraints: { itemIds: [accepted.itemId], categories: [] },
        referenceOrigins: { [reference.refId]: 'confirmation' },
        revisions: context.revisions,
      }, reference.refId)
      if (resolution.kind !== 'CONFIGURATION' && resolution.kind !== 'PLAN')
        throw new Error('The confirmed meal does not satisfy the current ordering constraints.')
      return resolution.plan
    },
    clear() {
      offer = undefined
      pending = undefined
    },
  }
}
