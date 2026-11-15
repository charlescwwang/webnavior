import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'

import type { AnswerDecision, BrowserAnswer } from '../../../server/src/services/domain/browser-ordering/contracts'
import type { AdditionProposal, QuestionSnapshot } from './browserQuestionWindow'

import { errorMessageFrom } from '@moeru/std'
import { browserQuestionChoice } from '@proj-airi/stage-shared/browser-conversation'
import { labelCatalog } from '@proj-airi/stage-shared/ordering-sites'
import { explicitServingQuantities, normalizeSlotNumbers } from '@proj-airi/stage-shared/ordering-slots'
import { pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { productFragment } from '@proj-airi/stage-shared/product-discovery'
import { resolveSelection } from '@proj-airi/stage-ui/services/pbProduct'
import { array, looseObject, number, parse, string } from 'valibot'

import { createBrowserOrderDrafts, orderFactsSchema, orderSlotCount } from './browserOrderDrafts'
import { createBrowserQuestionWindow } from './browserQuestionWindow'
import { createRecommendationSession } from './recommendationSession'

const factsSchema = orderFactsSchema

/** Original customer request and actual bound answers used for independent plan admission. */
export interface OrderEvidence {
  request: string
  answers: { question: string, answer: string }[]
}
function purchaseAnswerCount(transcript: string) {
  // The offer is for servings. Piece/unit replies may describe optional extras
  // (notably dumplings), so they need semantic handling instead of becoming meals.
  const text = normalizeSlotNumbers(transcript.replace(/^(?:好的|好)[，,\s]*/, '')).replaceAll(/\s/g, '')
  const match = text.match(/^(?:我要|請給我|要|來)?([1-9]\d?)份?(?:謝謝)?[。！!，,]*$/)
  return match ? Number(match[1]) : undefined
}
function quantityAnswerCount(transcript: string) {
  const match = normalizeSlotNumbers(transcript).replaceAll(/\s/g, '').match(/^(?:我要|請給我|要|來)?([1-9]\d?)[份個碗杯]?(?:謝謝)?[。！!，,]*$/)
  return match ? Number(match[1]) : undefined
}

/**
 * Owns pending PB questions across utterances. An answer is only a semantic ID;
 * current session/document/cart/config evidence must still authorize consumption.
 */
export function createBrowserDialogue(io: {
  owner: () => string | undefined
  documentId: () => string | undefined
  answer: (input: BrowserAnswer) => Promise<AnswerDecision>
  catalogLabels?: () => OrderingSite['catalogLabels']
}) {
  const questions = createBrowserQuestionWindow()
  const orders = createBrowserOrderDrafts()
  const recommendations = createRecommendationSession(io.owner)
  let answeredQuestion: BrowserConversation['answeredQuestion'] | undefined
  let answeredUtteranceId: number | undefined
  let orderEvidence: OrderEvidence | undefined
  // A quick-path read may consume a question before Main takes over the same
  // utterance. This evidence expires with that question and keeps its binding;
  // another turn, visitor, document or cart cannot inherit the selection.
  let acceptedSelection: { utteranceId: number, expiresAt: number, binding: QuestionSnapshot, selection: { productRef: string, request: string, requestTarget?: string, requestedQuantity: number, orderSelection?: true }, evidence: OrderEvidence } | undefined

  function snapshot(raw: unknown): QuestionSnapshot | undefined {
    const facts = parse(factsSchema, raw)
    const owner = io.owner()
    const documentId = io.documentId()
    if (!owner || !documentId)
      return
    return { owner, documentId, cartVersion: facts.cart.version, products: facts.products.filter(product => product.configurations.length === 1).map(product => ({ productRef: product.ref, name: product.name, configurationVersion: product.configurations[0].version, unitPrice: product.price })) }
  }

  // Complete only a literal purchase already requested before this choice.
  // Prices/options come from the new observation; an information question or
  // attached preference cannot be turned into a purchase by a short answer.
  function completePurchase(raw: unknown, request: string, productRef: string) {
    const facts = parse(factsSchema, raw)
    const product = labelCatalog(facts.products, io.catalogLabels?.()).find(product => product.ref === productRef)
    const configuration = product?.configurations.length === 1 ? product.configurations[0] : undefined
    if (!product || !configuration || configuration.groups.some(group => group.required))
      return
    const quantities = explicitServingQuantities(request, { productName: product.name })
    const labels = [product.name, pbProductName(product.name), ...product.aliases]
    const label = labels.find(name => request.includes(name))
    if (!label || quantities.length !== 1)
      return
    const remainder = normalizeSlotNumbers(request.replace(label, '')).replaceAll(/[\s，,。！!]/g, '').replace(/[1-9]\d?[份碗個杯]/, '')
    if (!/^(?:我要|我想要|請給我|給我|要|來)?(?:謝謝)?$/.test(remainder))
      return
    return quantities[0]
  }

  // A named reply resolves against the actual issued batch, never the model's
  // prose. Require the whole reply so attached new demands retain Main handling.
  function namedChoice(pending: NonNullable<ReturnType<typeof questions.pending>>, transcript: string) {
    if (pending.kind !== 'product')
      return
    const text = transcript.replaceAll(/[\s，,。！!]/g, '').replace(/^(?:我要|我想要|就要|要|選)/, '').replace(/(?:謝謝|好了)$/, '')
    const catalog = labelCatalog(pending.visible.map(product => ({ ...product, name: product.name })), io.catalogLabels?.())
    const matches = catalog.map((product, index) => ({ product, index })).filter(({ product }) => [product.name, pbProductName(product.name), ...product.aliases].some(name => name.replaceAll(/\s/g, '') === text))
    return matches.length === 1 ? `product:${matches[0].index + 1}` : undefined
  }

  function receipt(question: ReturnType<typeof questions.presentProducts>) {
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', pendingCustomerChoice: question, customerMessage: question.question }
  }

  function nextOrder(raw: unknown, binding: QuestionSnapshot) {
    const next = orders.next(raw, binding)
    if (!next)
      return
    if ('slot' in next)
      return receipt(questions.presentSlot(binding, next.slot))
    // Every field has customer evidence and current configuration validation.
    // Completing the last slot is the purchase request, not a new consent gap.
    orders.reset()
    const evidence = orderEvidence
    orderEvidence = undefined
    return { ok: true, source: 'browser', completeOrder: { proposals: next.proposals, binding, evidence } }
  }

  return {
    recommendations,
    releaseService(raw: unknown, questionId: string) {
      const binding = snapshot(raw)
      if (binding)
        questions.releaseService(binding, questionId)
    },
    reset: () => {
      questions.reset()
      orders.reset()
      orderEvidence = undefined
      acceptedSelection = undefined
      answeredQuestion = undefined
      answeredUtteranceId = undefined
    },
    hasPending: () => questions.hasPending(),
    /** Recovers only the unchanged, accepted selection of this exact utterance. */
    selectionForTurn(raw: unknown, utteranceId?: number) {
      const fresh = snapshot(raw)
      const selected = acceptedSelection
      if (!selected || utteranceId === undefined || selected.utteranceId !== utteranceId || selected.expiresAt <= Date.now() || !fresh || selected.binding.owner !== fresh.owner || selected.binding.documentId !== fresh.documentId || selected.binding.cartVersion !== fresh.cartVersion || !selected.binding.products.every(product => fresh.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product))))
        return
      return structuredClone({ selection: selected.selection, evidence: selected.evidence })
    },
    /** Only closed literal answers can skip another planner round; freshness is rechecked on consumption. */
    canAnswerLocally(raw: unknown, transcript: string) {
      const binding = snapshot(raw)
      const pending = binding && questions.pending(binding)
      if (!pending)
        return false
      const choice = namedChoice(pending, transcript)
      const namedProduct = pending.kind === 'product' && choice ? pending.visible[Number(choice.split(':')[1]) - 1] : undefined
      const namedAnswer = pending.kind === 'product' && namedProduct && (explicitServingQuantities(pending.request).length === 0 || completePurchase(raw, pending.request, namedProduct.productRef) !== undefined)
      return !!browserQuestionChoice(transcript, pending.question)
        || !!namedAnswer
        || (pending.kind === 'service' && pending.purpose === 'purchase-recommendation' && purchaseAnswerCount(transcript) !== undefined)
        || (pending.kind === 'quantity' && quantityAnswerCount(transcript) !== undefined)
        || (pending.kind === 'slot' && orderSlotCount(transcript, pending.slot) !== undefined)
    },
    collectOrder(raw: unknown, input: unknown, source: string, provided?: { productRef: string, quantity?: number, answer?: string }) {
      try {
        const binding = snapshot(raw)
        if (!binding)
          throw new Error('目前接待或頁面已變更。')
        orders.collect(raw, binding, input, source, provided)
        orderEvidence = { request: source, answers: provided && answeredQuestion ? [{ question: answeredQuestion.question, answer: answeredQuestion.answer }] : [] }
        questions.reset()
        return nextOrder(raw, binding)!
      }
      catch (error) {
        return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, error: errorMessageFrom(error), explanation: '尚未加入購物車。請依顧客原句與最新規格修正 browser_order_draft：同餐不同配置分開，未知份數或加料數填 null，不預設一份。' }
      }
    },
    /** Read-only dialogue projection; the private ticket remains the only answer authority. */
    conversation(raw: unknown, utteranceId?: number): Pick<BrowserConversation, 'phase' | 'waitingFor' | 'draft' | 'drafts' | 'answeredQuestion'> {
      const binding = snapshot(raw)
      const pending = binding && questions.pending(binding)
      const queue = binding && orders.projection(binding)
      if (!pending) {
        if (queue)
          orders.reset()
        return { phase: 'browsing', answeredQuestion: utteranceId === answeredUtteranceId ? answeredQuestion : undefined }
      }
      if (pending.kind === 'slot' || pending.kind === 'order') {
        const facts = parse(factsSchema, raw)
        const drafts = queue?.map(line => ({ ...line, name: facts.products.find(product => product.ref === line.productRef)!.name, choices: line.choices.map(choice => ({ ref: choice.ref, quantity: choice.quantity ?? undefined })), missing: (pending.kind === 'order' ? ['confirmation'] : line.quantity === undefined ? ['quantity', 'configuration', 'confirmation'] : ['configuration', 'confirmation']) as ('quantity' | 'configuration' | 'confirmation')[] }))
        return { phase: pending.kind === 'order' ? 'confirming_add' : pending.slot.kind === 'quantity' ? 'collecting_quantity' : 'configuring', waitingFor: pending.question, drafts }
      }
      if (pending.kind === 'service')
        return { phase: 'configuring', waitingFor: pending.question, answeredQuestion: utteranceId === answeredUtteranceId ? answeredQuestion : undefined }
      if (pending.kind === 'product')
        return { phase: 'choosing_product', waitingFor: pending.question }
      if (pending.kind === 'quantity')
        return { phase: 'collecting_quantity', waitingFor: pending.question, draft: { productRef: pending.product.productRef, name: pending.product.name, missing: ['quantity', 'configuration', 'confirmation'] } }
      return { phase: 'confirming_add', waitingFor: pending.question, draft: { productRef: pending.proposal.productRef, name: pending.proposal.productName, quantity: pending.proposal.quantity, note: pending.proposal.note, optionSummary: pending.proposal.optionSummary, missing: ['confirmation'] } }
    },
    validate(raw: unknown, questionId: string) {
      const binding = snapshot(raw)
      const pending = binding && questions.pending(binding)
      return pending?.question.questionId === questionId ? pending.question : undefined
    },
    accepts(binding: QuestionSnapshot, raw: unknown) {
      const fresh = snapshot(raw)
      return !!fresh && binding.owner === fresh.owner && binding.documentId === fresh.documentId && binding.cartVersion === fresh.cartVersion && binding.products.every(product => fresh.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product)))
    },
    presentProducts(raw: unknown, query: string, request: string, offeredProductRefs?: readonly string[]) {
      const binding = snapshot(raw)
      if (offeredProductRefs !== undefined) {
        // A recommendation question must preserve the actual presentation order
        // and subset. Do not rediscover matches from the original broad request.
        const products = offeredProductRefs.flatMap(ref => binding?.products.filter(product => product.productRef === ref) ?? [])
        if (!binding || !products.length || products.length !== offeredProductRefs.length || new Set(offeredProductRefs).size !== offeredProductRefs.length)
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '推薦餐點的選項已變更，請在畫面確認要點的餐點。' }
        const question = questions.presentProducts(binding, products, request, 0, '', true)
        return { ...receipt(question), presentationRefs: offeredProductRefs.slice(0, question.choices.filter(choice => choice.id.startsWith('product:')).length) }
      }
      const facts = parse(factsSchema, raw)
      const term = query.trim()
      const catalog = labelCatalog(facts.products, io.catalogLabels?.())
      const aliases = term ? catalog.filter(product => product.aliases.includes(term)) : []
      // A configured shared alias must retain every candidate, including when
      // one product's formal name also contains that alias.
      let related = term ? catalog.filter(product => product.name.includes(term) || aliases.some(candidate => candidate.ref === product.ref)) : []
      if (!related.length) {
        // A failed literal query can still contain a spoken fragment of today's
        // names. Discovery only narrows a confirmation; it never identifies a SKU
        // for a write or replaces the one-use customer-answer protocol.
        related = catalog.filter((product) => {
          const fragment = productFragment(product, catalog, term || request)
          // A common suffix such as 便當 alone cannot turn an absent ingredient
          // request into every bento. Named-query aliases need a majority of
          // literal overlap; a broad request still uses the original discovery.
          return fragment !== undefined && (!term || fragment.length > term.replaceAll(/\s/g, '').length / 2)
        })
      }
      // Absence is checked against ALL complete catalog facts. Question-ready
      // products are a narrower set: groups/variants may need manual selection.
      const relatedRefs = new Set(related.map(product => product.ref))
      let products = binding?.products.filter(product => relatedRefs.has(product.productRef))
      if (!related.length && term) {
        questions.reset()
        return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: `目前菜單沒有找到「${term}」。可以換一道餐點，或說「回到菜單」看全部餐點。` }
      }
      if (related.length && !products?.length) {
        questions.reset()
        return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: `菜單有與「${term || related[0].name}」相關的品項，但目前無法確認完整選項，請在畫面確認後再選餐。` }
      }
      // An intentionally broad request has no named lookup to fail. Only this
      // case may offer the catalog's selectable products as spoken batches.
      if (!related.length && !term)
        products = binding?.products
      if (!binding || !products?.length)
        return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前沒有可確認的符合選項，請在畫面選餐或說明完整品名。' }
      const question = questions.presentProducts(binding, products, request, 0, term)
      // Keep issued batch refs so Host visuals never parse question prose.
      return { ...receipt(question), presentationRefs: products.slice(0, question.choices.filter(choice => choice.id.startsWith('product:')).length).map(product => product.productRef) }
    },
    presentAddition(raw: unknown, input: Record<string, unknown>) {
      const facts = parse(factsSchema, raw)
      const binding = snapshot(raw)
      if (!binding)
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前接待或頁面已變更，尚未建立確認。' }
      try {
        const product = facts.products.find(product => product.ref === input.productRef)
        const configuration = product?.configurations.find(configuration => configuration.variantRef === (input.selection as Record<string, unknown> | undefined)?.variantRef)
        if (!product || !configuration)
          throw new Error('目前的餐點規格已變更，請重新選擇。')
        // The same selection policy used by the PB adapter determines the price;
        // model-proposed totals cannot define what the customer is confirming.
        const selection = parse(looseObject({ version: string(), variantRef: string(), choices: array(looseObject({ ref: string(), quantity: number() })) }), input.selection)
        const selected = resolveSelection(configuration, selection, typeof input.note === 'string' ? input.note : '')
        if (input.unitPrice !== selected.unitPrice)
          throw new Error('提案售價與最新規格不符，尚未建立確認。')
        const options = selected.choices.map(choice => ({ name: configuration.groups.flatMap(group => group.choices).find(option => option.ref === choice.ref)!.name, quantity: choice.quantity }))
        const optionSummary = options.map(option => `${option.name} 每份 ${option.quantity} 個`).join('、')
        const proposal: AdditionProposal = { productRef: product.ref, productName: product.name, quantity: Number(input.quantity), unitPrice: selected.unitPrice, note: typeof input.note === 'string' ? input.note : '', optionSummary, options, selection }
        return receipt(questions.presentAddition(binding, proposal))
      }
      catch (error) {
        // No vendor call occurs while building a confirmation. Invalid model
        // settings are repairable proposals, never an unknown cart effect.
        return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, error: errorMessageFrom(error) ?? 'Invalid product proposal.', explanation: '尚未建立確認或加入購物車。請使用最新商品的 productRef、configurations.version、variantRef、選項與配置後售價，修正同一品項的完整提案；不可改選其他商品。' }
      }
    },
    presentService(raw: unknown, input: { purpose: string, name?: string, quantity?: number, query?: string, request: string, question: string, choices: { id: string, description: string }[] }) {
      const binding = snapshot(raw)
      if (!binding)
        throw new Error('目前接待或頁面已變更。')
      return receipt(questions.presentService(binding, input))
    },
    presentQuantity(raw: unknown, productRef: string, request: string, requestTarget?: string, orderSelection?: true) {
      const binding = snapshot(raw)
      const product = binding?.products.find(product => product.productRef === productRef)
      if (!binding || !product)
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前無法確認這份餐點，請重新選餐。' }
      return receipt(questions.presentQuantity(binding, product, request, requestTarget, orderSelection))
    },
    async answer(raw: unknown, transcript: string, observe: () => Promise<unknown>, isCurrent: () => boolean, utteranceId?: number) {
      const binding = snapshot(raw)
      const pending = binding && questions.pending(binding)
      if (!pending || !isCurrent())
        return
      if (pending.kind === 'slot') {
        const count = orderSlotCount(transcript, pending.slot)
        if (count !== undefined) {
          const observed = await observe()
          const fresh = snapshot(observed)
          if (!fresh || !isCurrent())
            return
          const slot = questions.consumeSlotNumber(pending.question.questionId, count, fresh)
          if (slot && orders.fill(observed, fresh, slot, count)) {
            orderEvidence?.answers.push({ question: pending.question.question, answer: transcript })
            return { kind: 'receipt' as const, result: nextOrder(observed, fresh)! }
          }
          orders.reset()
          return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '餐點或購物車狀態已變更，請重新確認。' } }
        }
      }
      if (pending.kind === 'quantity') {
        // Only a whole, explicit count fills this slot locally. Attached options,
        // other products, refusals and conversational yes/no remain model/domain
        // questions; none can silently become a default serving.
        const count = quantityAnswerCount(transcript)
        if (count) {
          const fresh = snapshot(await observe())
          if (!fresh || !isCurrent())
            return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '餐點或購物車狀態已變更，請重新確認。' } }
          const selected = questions.consumeQuantity(pending.question.questionId, count, fresh)
          if (!selected)
            return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '餐點或購物車狀態已變更，請重新確認。' } }
          answeredUtteranceId = utteranceId
          answeredQuestion = { question: pending.question.question, answer: transcript, name: selected.product.name, purpose: pending.question.purpose, originalRequest: selected.request }
          if (utteranceId !== undefined)
            acceptedSelection = { utteranceId, expiresAt: pending.question.expiresAt, binding: fresh, selection: { productRef: selected.product.productRef, request: selected.request, requestTarget: selected.requestTarget, requestedQuantity: selected.quantity, orderSelection: selected.orderSelection }, evidence: { request: selected.request, answers: [{ question: pending.question.question, answer: transcript }] } }
          return { kind: 'product' as const, product: selected.product, request: selected.request, requestTarget: selected.requestTarget, requestedQuantity: selected.quantity, orderSelection: selected.orderSelection, binding: fresh }
        }
      }
      const literal = namedChoice(pending, transcript) ?? (pending.kind === 'service' && pending.purpose === 'purchase-recommendation' && purchaseAnswerCount(transcript) !== undefined ? 'yes' : browserQuestionChoice(transcript, pending.question))
      const decision: AnswerDecision = literal ? { kind: 'ANSWER', choiceId: literal, provider: 'main' } : await io.answer({ questionId: pending.question.questionId, transcript, cartContext: parse(factsSchema, raw).cart }).catch((): AnswerDecision => ({ kind: 'UNCERTAIN', provider: 'unavailable' }))
      // Re-observe after model IO: a touch, new price, reload or customer switch
      // during that wait invalidates the original question instead of rebinding it.
      const observed = await observe()
      const fresh = snapshot(observed)
      if (!fresh || !isCurrent() || !questions.pending(fresh))
        return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '餐點或購物車狀態已變更，請重新確認。' } }
      if (decision.kind === 'NEW_REQUEST') {
        questions.reset()
        orders.reset()
        return pending.kind === 'addition' ? { kind: 'new-request' as const, previousProposal: pending.proposal } : undefined
      }
      if (decision.kind !== 'ANSWER' || !decision.choiceId)
        return { kind: 'receipt' as const, result: receipt(pending.question) }
      const selected = questions.consume(pending.question.questionId, decision.choiceId, fresh)
      if (selected.kind === 'service') {
        answeredUtteranceId = utteranceId
        answeredQuestion = { question: selected.question, answer: transcript, selectedChoice: selected.answer, name: selected.name, purpose: selected.purpose }
        if (selected.purpose === 'cancel-and-search' && selected.choiceId === 'yes') {
          orders.reset()
          return { kind: 'switch-query' as const, query: selected.query ?? '' }
        }
        if (selected.purpose === 'review-checkout' && selected.choiceId === 'yes')
          return { kind: 'review-cart' as const }
        if (selected.purpose === 'cart-review' && selected.choiceId === 'yes')
          return { kind: 'checkout' as const, action: 'invoice-options' as const }
        if (selected.purpose === 'cart-review' && selected.choiceId === 'no')
          return { kind: 'receipt' as const, result: { ok: true, source: 'browser', effect: 'none', customerMessage: '請告訴我要修改哪道餐點或份數。' } }
        if (selected.purpose === 'invoice-method')
          return { kind: 'checkout' as const, action: 'invoice' as const, method: selected.choiceId }
        if (selected.purpose === 'submit-order' && selected.choiceId === 'yes' && selected.query)
          return { kind: 'checkout' as const, action: 'submit' as const, confirmationToken: selected.query }
        if (selected.purpose === 'submit-order' && selected.choiceId === 'no')
          return { kind: 'receipt' as const, result: { ok: true, source: 'browser', effect: 'none', customerMessage: '先不送出，餐點與填寫資料都保留。您可以告訴我要修改什麼。' } }
        if (selected.purpose === 'purchase-recommendation' && selected.choiceId === 'yes' && selected.name) {
          const product = fresh.products.filter(product => product.name === selected.name)
          const count = purchaseAnswerCount(transcript) ?? selected.quantity
          if (product.length === 1 && count !== undefined) {
            if (utteranceId !== undefined)
              acceptedSelection = { utteranceId, expiresAt: pending.question.expiresAt, binding: fresh, selection: { productRef: product[0].productRef, request: selected.request, requestedQuantity: count, orderSelection: true }, evidence: { request: selected.request, answers: [{ question: selected.question, answer: transcript }] } }
            return { kind: 'product' as const, product: product[0], request: selected.request, requestedQuantity: count, orderSelection: true as const, binding: fresh }
          }
          if (product.length === 1)
            return { kind: 'receipt' as const, result: receipt(questions.presentQuantity(fresh, product[0], selected.request, undefined, true)) }
        }
        if (selected.purpose === 'price-range' && selected.choiceId === 'yes')
          recommendations.update({ clearPrice: true })
        const restored = questions.pending(fresh)
        if (selected.choiceId === 'no')
          return { kind: 'receipt' as const, result: restored ? receipt(restored.question) : { ok: true, source: 'browser', effect: 'none', customerMessage: '好的，您可以繼續看餐點。' } }
        return { kind: 'receipt' as const, result: { ok: true, source: 'browser', dataOnly: true, needsAssistant: true, answeredQuestion } }
      }
      if (selected.kind === 'slot') {
        if (orders.fill(observed, fresh, selected.slot, selected.choiceId)) {
          orderEvidence?.answers.push({ question: pending.question.question, answer: transcript })
          return { kind: 'receipt' as const, result: nextOrder(observed, fresh)! }
        }
        orders.reset()
      }
      if (selected.kind === 'order') {
        orders.reset()
        return { kind: 'order' as const, proposals: selected.proposals, binding: fresh }
      }
      if (selected.kind === 'cancelled')
        orders.reset()
      if (selected.kind === 'product')
        return { kind: 'product' as const, product: selected.product, request: pending.kind === 'product' ? pending.request : '', requestTarget: pending.kind === 'product' ? pending.query : undefined, requestedQuantity: undefined, orderSelection: pending.kind === 'product' ? pending.orderSelection : undefined, completePurchase: !!literal && pending.kind === 'product' ? completePurchase(observed, pending.request, selected.product.productRef) : undefined, binding: fresh }
      if (selected.kind === 'addition')
        return { kind: 'addition' as const, proposal: selected.proposal, binding: fresh }
      if (selected.kind === 'page')
        return { kind: 'receipt' as const, result: receipt(questions.presentProducts(fresh, selected.products, selected.request, selected.page, selected.query, pending.kind === 'product' ? pending.orderSelection : undefined)) }
      return { kind: 'receipt' as const, result: { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: selected.kind === 'cancelled' ? '已取消這次選餐，購物車保持不變。' : '這個問題已失效，請重新確認。' } }
    },
  }
}
