import type { ConversationRequest, ConversationQuestion as PresentedQuestion } from '@proj-airi/stage-shared/kiosk-conversation'

import type { DecisionContext } from './kiosk-intents'

import { orderingMessages } from '../../../packages/i18n/src/orderingMessages'
import { filterIngredients, mentionedIngredients, mentionedUnavailableConditions } from './domain/composition'
import { filterPrices } from './domain/pricing'
import { describeRequest, resolveIntent } from './kiosk-intents'

export const mealMessages = orderingMessages['zh-Hant']

interface Proposal {
  id: string
  itemId: string
  label: string
  context: DecisionContext
  expiresAt: number
  repeatCurrent: boolean
  replaceLineId?: string
  replacementName?: string
  explicitAddition?: boolean
  originalRecipe?: boolean
  ownerTaskId?: string
  presented?: boolean
}

// Reading progress and accepting a confirmation must derive the same slots.
// This compiles a proposal only; it never consumes a ticket or writes a cart.
function resolveMealPlan(proposal: Proposal, context: DecisionContext, answer?: string) {
  const reference = { refId: `item:${proposal.itemId}`, label: proposal.label }
  const candidate = { id: 'intent:add-item', intent: 'ADD_ITEM' as const, description: '新增顧客剛確認的餐點。' }
  const source = proposal.context
  const resolution = resolveIntent(candidate, {
    ...source,
    ...(answer ? { transcript: answer, previousTranscript: source.transcript } : {}),
    candidates: [candidate],
    references: [reference],
    targetConstraints: { itemIds: [proposal.itemId], categories: [] },
    referenceOrigins: { [reference.refId]: 'confirmation' },
    revisions: context.revisions,
  }, reference.refId)
  if (resolution.kind !== 'CONFIGURATION' && resolution.kind !== 'PLAN')
    throw new Error('The confirmed meal does not satisfy the current ordering constraints.')
  // The answer supplies slots; it must not replace the request that created
  // this draft when the next model receives the unfinished meal.
  const plan = { ...resolution.plan, requestId: proposal.id, sourceUtterance: source.transcript }
  if (proposal.replaceLineId) {
    const original = context.cart.lines.find(line => line.id === proposal.replaceLineId)
    if (!original)
      throw new Error('STALE_PLAN: The replacement line no longer exists.')
    return { ...plan, slots: { ...plan.slots, replaceLineId: original.id, quantity: plan.slots.quantity ?? original.quantity } }
  }
  return plan
}

/** Browser-owned yes/no lifecycle. A proposal never authorizes a cart write. */
export function createMealClarification() {
  let offer: Proposal | undefined
  let pending: (Proposal & { attempts: number }) | undefined
  // Only a new Host decision issues an answer utterance. Passive snapshots
  // must not replace it while browser execution validates the same question.
  let issuedAnswer: { requestId: string, questionId: string, transcript: string, expiresAt: number } | undefined
  // A draft survives silence. Only the answer lease expires; domain changes
  // still invalidate the proposed target and prevent stale execution.
  const current = (proposal: Proposal, context: DecisionContext) => context.phase === 'ordering'
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
    const questionId = issuedAnswer?.requestId === pending.id ? issuedAnswer.questionId : pending.id
    let prompt: string
    if (pending.originalRecipe) {
      const quantity = resolveMealPlan(pending, context).slots.quantity
      prompt = mealMessages.confirmOriginalRecipe.replace('{item}', pending.label).replace('{quantity}', typeof quantity === 'number' ? `${quantity}份` : '')
    }
    else if (pending.replacementName) {
      prompt = mealMessages.confirmReplacement.replace('{original}', pending.replacementName).replace('{item}', pending.label)
    }
    else {
      prompt = (pending.explicitAddition ? mealMessages.confirmAddition : mealMessages.confirmMeal).replace('{item}', pending.label)
    }
    return {
      questionId,
      requestId: pending.id,
      purpose: 'confirm-meal',
      question: prompt,
      expiresAt: issuedAnswer?.requestId === pending.id ? issuedAnswer.expiresAt : pending.expiresAt,
      choices: [
        { id: `confirm-meal:${questionId}:yes`, description: `${pending.originalRecipe ? '接受原版餐點、不進行客製，繼續原訂購' : mealMessages.yes}，確認${pending.replacementName ? `將${pending.replacementName}更換為` : '要點'}${pending.label}；繼續補必要資料，尚不授權付款。` },
        { id: `confirm-meal:${questionId}:no`, description: `${mealMessages.no}，結束這次餐點確認，保留原本點餐進度。` },
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
      || context.priceEvidence || context.dietaryReferences.length || mentionedUnavailableConditions(remainingSpeech).length || mentionedIngredients(remainingSpeech).length) {
      return undefined
    }
    return context.menu.find(item => item.id === pending!.itemId)
  }

  return {
    question,
    /** Main may propose a real target; only a later customer answer establishes it. */
    propose(context: DecisionContext, itemId: string, replaceLineId?: string, originalRecipe = false, ownerTaskId?: string) {
      const item = context.menu.find(item => item.id === itemId && item.available !== false)
      const original = replaceLineId ? context.cart.lines.find(line => line.id === replaceLineId) : undefined
      if (context.phase !== 'ordering' || !item || (replaceLineId && (!original || context.cart.lines.filter(line => line.itemId === original.itemId).length > 1)))
        throw new Error('The proposed meal or replacement target is not current and unique.')
      if (originalRecipe) {
        // This is a proposal to waive an unsupported preparation request, never
        // a claim about allergy safety, nutrition or dietary certification.
        if (item.optionGroups.length || context.dietaryReferences.length || context.constraints.dietary || context.unavailableConditionReferences.some(reference => !['spice', 'preparation'].includes(reference.id)))
          throw new Error('Only unsupported preparation requests can propose the original recipe.')
        context = { ...context, ingredientReferences: [], unavailableConditionReferences: [], constraints: { ...context.constraints, exclude: [], include: [] } }
      }
      const eligible = filterIngredients(filterPrices([item], context.constraints.price ?? {}), { excludeIngredients: context.constraints.exclude, includeIngredients: context.constraints.include, dietary: context.constraints.dietary }).matches
      if (!eligible.length || context.constraints.unresolvedPrice || context.unavailableConditionReferences.length)
        throw new Error('The proposed meal does not satisfy the current verified request conditions.')
      issuedAnswer = undefined
      pending = { id: crypto.randomUUID(), itemId, label: item.name, context, expiresAt: Date.now() + 30_000, repeatCurrent: false, attempts: 1, explicitAddition: true, originalRecipe, ownerTaskId, ...(original ? { replaceLineId: original.id, replacementName: original.name } : {}) }
      offer = undefined
      return question(context)!
    },
    /** Only the Host can mark a rendered question; Main cannot confirm its own proposal. */
    markPresented(questionId: string, context: DecisionContext) {
      if (pending && question(context)?.questionId === questionId)
        pending.presented = true
    },
    canAnswer(context: DecisionContext, taskId?: string) {
      return Boolean(pending?.originalRecipe && pending.presented && taskId && pending.ownerTaskId !== taskId && question(context))
    },
    /** Read target only when the current utterance can inherit this proposal. */
    inquiry,
    /** Resolves the live proposal for a read, without converting it to an order. */
    inquire(questionId: string, context: DecisionContext) {
      const item = inquiry(context)
      if (!item || question(context)?.questionId !== questionId || (question(context)?.expiresAt ?? 0) <= Date.now())
        throw new Error('STALE_PLAN: The meal inquiry expired or changed.')
      pending = undefined
      offer = undefined
      return item
    },
    offer(context: DecisionContext, configuringItemId?: string, eligible = true) {
      offer = undefined
      // Price-qualified speech keeps its bounded price interpretation. Never
      // turn a partial budget/filter into permission to purchase one dish.
      // A fragment is a possible identity, not a confirmed operation. Main must
      // propose an explicit addition or replacement before asking for consent.
      if (!eligible || question(context) || context.phase !== 'ordering' || context.priceEvidence || context.productResolution.status !== 'exact' || context.productResolution.references.length !== 1)
        return undefined
      const reference = context.productResolution.references[0]!
      const item = context.menu.find(item => `item:${item.id}` === reference.refId && item.available !== false)
      if (!item || !context.catalogEvidence.products.some(evidence => evidence.label === item.name))
        return undefined
      const evidence = context.catalogEvidence.products.find(evidence => evidence.label === item.name)!
      const remainingSpeech = (context.transcript ?? '').replace(evidence.matchedText, '')
      // A name-only question cannot confirm an omitted dietary/ingredient or
      // unsupported requirement. Keep that whole request on its normal route.
      if (context.dietaryReferences.length || mentionedUnavailableConditions(remainingSpeech).length || mentionedIngredients(remainingSpeech).length)
        return undefined
      offer = { id: crypto.randomUUID(), itemId: item.id, label: item.name, context, expiresAt: Date.now() + 30_000, repeatCurrent: item.id === configuringItemId }
      return { id: offer.id, label: offer.label }
    },
    request(questionId: string, context: DecisionContext) {
      if (pending && question(context)?.questionId === questionId && (question(context)?.expiresAt ?? 0) > Date.now() && current(pending, context)) {
        pending.attempts++
      }
      else {
        if (!offer || offer.id !== questionId || offer.expiresAt <= Date.now() || !current(offer, context))
          throw new Error('STALE_PLAN: The meal clarification offer expired or changed.')
        if (offer.repeatCurrent) {
          offer = undefined
          return { repeatCurrent: true as const }
        }
        issuedAnswer = undefined
        pending = { ...offer, attempts: 1 }
        offer = undefined
      }
      return { repeatCurrent: false as const, question: question(context)!, speak: pending!.attempts <= 2 }
    },
    /** Detached proposed meal facts; confirmation is still required before any effect. */
    progress(context: DecisionContext): ConversationRequest | undefined {
      if (!question(context) || !pending)
        return undefined
      return describeRequest(pending.id, 'confirming', resolveMealPlan(pending, context), context.menu)
    },
    /** Binds the next finite confirmation choice to this browser-observed utterance. */
    issueAnswer(context: DecisionContext) {
      const active = question(context)
      issuedAnswer = active && pending ? { requestId: pending.id, questionId: crypto.randomUUID(), transcript: context.transcript ?? '', expiresAt: Date.now() + 30_000 } : undefined
      return question(context)
    },
    consume(candidateId: string, context: DecisionContext) {
      if (!pending || !current(pending, context) || !issuedAnswer || issuedAnswer.requestId !== pending.id || issuedAnswer.expiresAt <= Date.now() || ![`confirm-meal:${issuedAnswer.questionId}:yes`, `confirm-meal:${issuedAnswer.questionId}:no`].includes(candidateId))
        throw new Error('STALE_PLAN: The meal confirmation expired, changed or was already answered.')
      const accepted = pending
      const answer = issuedAnswer.transcript
      issuedAnswer = undefined
      pending = undefined
      offer = undefined
      if (candidateId.endsWith(':no'))
        return undefined
      // The affirmative answer establishes the proposed target. Its browser-
      // captured quantity/options override the proposal; the proposal remains
      // the previous fragment so a bare yes retains already stated slots.
      return resolveMealPlan(accepted, context, answer)
    },
    clear() {
      issuedAnswer = undefined
      offer = undefined
      pending = undefined
    },
  }
}
