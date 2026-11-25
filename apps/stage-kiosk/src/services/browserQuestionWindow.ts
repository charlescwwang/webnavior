import type { ProductSelection } from '@proj-airi/stage-shared/product-configuration'

import type { PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import { describePbMeal, pbBasicServing, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { browserRecommendationLimit } from '@proj-airi/stage-shared/product-presentation'

/** Literal product evidence used to keep spoken ordinals bound to their original list. */
export interface QuestionProduct {
  productRef: string
  name: string
  configurationVersion: string
  unitPrice: number
}

/** Session, document and observed cart are independent owners of answer authority. */
export interface QuestionSnapshot {
  owner: string
  documentId: string
  cartVersion: string
  /** Form values bind consent and spoken tax fragments; entry progress can be re-established without them. */
  checkoutVersion?: string
  products: QuestionProduct[]
}

/** A complete proposal displayed before a short confirmation can authorize an add. */
export interface AdditionProposal {
  productRef: string
  productName: string
  quantity: number
  unitPrice: number
  note: string
  optionSummary: string
  options: { name: string, quantity: number }[]
  selection: ProductSelection
}

/** A single missing field in one Host-owned dish; IDs never come from the model. */
export interface OrderSlot {
  draftId: string
  productRef: string
  name: string
  kind: 'quantity' | 'choice-quantity' | 'group' | 'dumpling-pieces'
  groupRef?: string
  choiceRef?: string
  maximum: number
  question: string
  choices: PresentedQuestion['choices']
}

// orderSelection marks an issued "which dish do you want to order?" question.
// It follows the selected product into the quantity ticket without rewriting
// the original recommendation request; it never supplies a count or options.
type Ticket = { binding: QuestionSnapshot, question: PresentedQuestion } & (
  | { kind: 'product', products: QuestionProduct[], visible: QuestionProduct[], page: number, request: string, query: string, orderSelection?: true, servingAnswer?: { quantity: number, transcript: string } }
  | { kind: 'addition', proposal: AdditionProposal }
  | { kind: 'quantity', product: QuestionProduct, request: string, requestTarget?: string, orderSelection?: true }
  | { kind: 'slot', slot: OrderSlot }
  | { kind: 'order', proposals: AdditionProposal[] }
  | { kind: 'service', purpose: string, name?: string, quantity?: number, query?: string, request: string, previous?: Ticket }
)

/**
 * Owns one presented, expiring, one-use browser question. Product selection
 * alone never authorizes an add. A service offer may retain the serving count
 * explicitly asked aloud; semantic answers choose IDs, never executable arguments.
 */
export function createBrowserQuestionWindow(now = Date.now) {
  let ticket: Ticket | undefined

  function current(snapshot: QuestionSnapshot) {
    if (!ticket)
      return
    const previous = ticket.binding
    const sameProducts = previous.products.every(product => snapshot.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product)))
    const formChanged = ticket.kind === 'service' && ['submit-order', 'invoice-donation-confirm', 'invoice-tax', 'invoice-tax-confirm'].includes(ticket.purpose) && previous.checkoutVersion !== snapshot.checkoutVersion
    if (formChanged || ticket.question.expiresAt <= now() || previous.owner !== snapshot.owner || previous.documentId !== snapshot.documentId || previous.cartVersion !== snapshot.cartVersion || !sameProducts) {
      ticket = undefined
      return
    }
    return ticket
  }

  return {
    /** A hint only; authority still requires pending(snapshot) to recheck freshness. */
    hasPending: () => ticket !== undefined,
    /** Recovery hint only; fresh snapshot/token checks still own submission authority. */
    hasSubmissionQuestion: () => ticket?.kind === 'service' && ['submit-order', 'invoice-donation-confirm', 'invoice-tax', 'invoice-tax-confirm'].includes(ticket.purpose),
    /** A different service request drops this offer, preserving any unfinished dish underneath. */
    releaseService(snapshot: QuestionSnapshot, questionId: string) {
      const pending = current(snapshot)
      if (pending?.kind === 'service' && pending.question.questionId === questionId)
        ticket = pending.previous
    },
    presentService(snapshot: QuestionSnapshot, input: { purpose: string, name?: string, quantity?: number, query?: string, request: string, question: string, choices: PresentedQuestion['choices'] }) {
      const previous = current(snapshot)
      if (previous?.kind === 'service' && previous.purpose === input.purpose
        && previous.name === input.name && previous.quantity === input.quantity && previous.query === input.query
        && previous.request === input.request && previous.question.question === input.question
        && JSON.stringify(previous.question.choices) === JSON.stringify(input.choices)) {
        return structuredClone(previous.question)
      }
      const question: PresentedQuestion = { questionId: crypto.randomUUID(), purpose: 'browser-service-question', question: input.question, choices: input.choices, expiresAt: now() + 120_000 }
      // Checkout answers authorize the observed cart, not every menu item's
      // pickup-dependent configuration. Final submission independently checks
      // the native form/token; owner, document, cart and expiry still bind here.
      const cartQuestion = ['review-checkout', 'cart-review', 'invoice-method', 'invoice-details', 'invoice-donation-confirm', 'invoice-tax', 'invoice-tax-confirm', 'notification-details', 'notification-phone', 'notification-phone-confirm', 'checkout-details', 'submit-order'].includes(input.purpose)
      const binding = structuredClone({ ...snapshot, products: cartQuestion ? [] : snapshot.products })
      // Replacing a service offer retires it permanently. Only an unfinished
      // product/quantity task underneath can resume after the new offer ends.
      const underlying = previous?.kind === 'service' ? previous.previous : previous
      ticket = { kind: 'service', binding, question, purpose: input.purpose, name: input.name, quantity: input.quantity, query: input.query, request: input.request, previous: underlying }
      return structuredClone(question)
    },
    presentSlot(snapshot: QuestionSnapshot, slot: OrderSlot) {
      const product = snapshot.products.find(product => product.productRef === slot.productRef)
      if (!product)
        throw new Error('Draft field requires a current product.')
      const question: PresentedQuestion = { questionId: crypto.randomUUID(), purpose: 'browser-order-slot', question: slot.question, expiresAt: now() + 120_000, choices: [...slot.choices, { id: 'cancel', description: '取消這批尚未加入的餐點，保留購物車。' }] }
      ticket = { kind: 'slot', binding: structuredClone(snapshot), slot: structuredClone(slot), question }
      return structuredClone(question)
    },
    presentOrder(snapshot: QuestionSnapshot, proposals: AdditionProposal[], wholeMenu = false) {
      if (!proposals.length || (!wholeMenu && proposals.length > 10) || proposals.some(proposal => !snapshot.products.some(product => product.productRef === proposal.productRef && product.name === proposal.productName && product.configurationVersion === proposal.selection.version) || !Number.isInteger(proposal.quantity) || proposal.quantity < 1 || proposal.quantity > 99 || !Number.isFinite(proposal.unitPrice) || proposal.unitPrice < 0))
        throw new Error('Order confirmation requires complete current proposals.')
      const lines = proposals.map(proposal => `${describePbMeal({ ...proposal, name: proposal.productName })}，單份 ${proposal.unitPrice} 元`)
      const total = proposals.reduce((sum, proposal) => sum + Math.round(proposal.unitPrice * 100) * proposal.quantity, 0) / 100
      const question: PresentedQuestion = { questionId: crypto.randomUUID(), purpose: 'browser-confirm-add', question: wholeMenu ? `整張菜單共 ${proposals.length} 道，各一份合計 ${total} 元，全部幫您加入嗎？` : `${lines.join('；')}。合計 ${total} 元，要幫您加入購物車嗎？`, expiresAt: now() + 120_000, choices: [{ id: 'confirm', description: `確認加入上述 ${proposals.length} 組完整餐點，合計 ${total} 元，不送單付款。` }, { id: 'cancel', description: '取消這批尚未加入的餐點，保留購物車。' }] }
      if (question.question.length > 2000)
        throw new Error('Order confirmation exceeds the presentation limit.')
      ticket = { kind: 'order', binding: structuredClone(snapshot), proposals: structuredClone(proposals), question }
      return structuredClone(question)
    },
    consumeSlotNumber(questionId: string, quantity: number, snapshot: QuestionSnapshot) {
      const pending = current(snapshot)
      if (!pending || pending.kind !== 'slot' || (pending.slot.kind === 'group' || pending.slot.kind === 'dumpling-pieces') || pending.question.questionId !== questionId || !Number.isInteger(quantity) || quantity < 1 || quantity > pending.slot.maximum)
        return
      ticket = undefined
      return structuredClone(pending.slot)
    },
    presentProducts(snapshot: QuestionSnapshot, products: QuestionProduct[], request: string, page = 0, query = '', orderSelection?: true, servingAnswer?: { quantity: number, transcript: string }) {
      if (!products.length || new Set(products.map(product => product.productRef)).size !== products.length)
        throw new Error('Question requires distinct observed product references.')
      if (products.some(product => !snapshot.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product))))
        throw new Error('Question candidates must come from the current observation.')
      // These are spoken choice batches, not vendor pages. Keep all observed
      // candidates while limiting what is read aloud, regardless of viewport.
      const pages: QuestionProduct[][] = [[]]
      for (const product of products) {
        const last = pages.at(-1)!
        if (last.length && (last.length >= browserRecommendationLimit || [...last, product].reduce((sum, item) => sum + item.name.length, 0) > 350))
          pages.push([])
        pages.at(-1)!.push(product)
      }
      const visible = pages[page]
      if (!Number.isInteger(page) || !visible)
        throw new Error('Question page is outside the observed product list.')
      const navigation = [
        ...(page > 0 ? [{ id: 'previous', description: '再聽前一組選項，只更新口頭選餐，不切換網站頁面、不加入餐點。' }] : []),
        ...(page < pages.length - 1 ? [{ id: 'next', description: '再聽其他選項，只更新口頭選餐，不切換網站頁面、不加入餐點。' }] : []),
      ]
      const wording = orderSelection ? '您想點哪一道？' : visible.length === 1 ? `您是指「${pbProductName(visible[0]!.name)}」嗎？` : `請問您要${visible.map(product => pbProductName(product.name)).join('、')}，哪一項？`
      const question: PresentedQuestion = { questionId: crypto.randomUUID(), purpose: 'browser-product-choice', question: wording, expiresAt: now() + 120_000, choices: [...visible.map((product, index) => ({ id: `product:${index + 1}`, description: `這組第 ${index + 1} 項「${product.name}」，單份基本售價 ${product.unitPrice} 元；只選品項，尚未加入。` })), ...navigation, { id: 'cancel', description: '取消這個尚未完成的選餐，不變更購物車。' }] }
      // Copy at presentation: a later catalog reorder cannot redefine "second".
      // Keep the original query separately so choosing a product can resolve
      // that target across later quantity questions without rewriting the request.
      ticket = { kind: 'product', binding: structuredClone({ ...snapshot, products }), products: structuredClone(products), visible: structuredClone(visible), page, question, request, query, orderSelection, servingAnswer }
      return structuredClone(question)
    },
    recordProductServings(snapshot: QuestionSnapshot, questionId: string, quantity: number, transcript: string) {
      const pending = current(snapshot)
      if (pending?.kind !== 'product' || !pending.orderSelection || pending.question.questionId !== questionId)
        return
      // The count belongs to this choice only. No product has been selected yet.
      pending.servingAnswer = { quantity, transcript }
      pending.question.question = `要 ${quantity} 份，您想點哪一道？`
      return structuredClone(pending.question)
    },
    presentAddition(snapshot: QuestionSnapshot, proposal: AdditionProposal) {
      const product = snapshot.products.find(product => product.productRef === proposal.productRef && product.configurationVersion === proposal.selection.version)
      if (!product || product.name !== proposal.productName || !Number.isInteger(proposal.quantity) || proposal.quantity < 1 || proposal.quantity > 99 || !Number.isFinite(proposal.unitPrice) || proposal.unitPrice < 0)
        throw new Error('Confirmation requires a complete current product proposal.')
      const amount = Math.round(proposal.unitPrice * 100) * proposal.quantity / 100
      const question: PresentedQuestion = { questionId: crypto.randomUUID(), purpose: 'browser-confirm-add', question: `${describePbMeal({ ...proposal, name: proposal.productName })}，單份 ${proposal.unitPrice} 元，合計 ${amount} 元，要幫您加入購物車嗎？`, expiresAt: now() + 120_000, choices: [{ id: 'confirm', description: `確認現在加入這個完整設定的${pbProductName(proposal.productName)} ${proposal.quantity} 份，合計 ${amount} 元；不送單付款。` }, { id: 'cancel', description: '先不加入這份餐點，保留原購物車。' }] }
      ticket = { kind: 'addition', binding: structuredClone({ ...snapshot, products: [product] }), proposal: structuredClone(proposal), question }
      return structuredClone(question)
    },
    /** A missing serving count never becomes one; selection is retained without write authority. */
    presentQuantity(snapshot: QuestionSnapshot, product: QuestionProduct, request: string, requestTarget?: string, orderSelection?: true) {
      if (!snapshot.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product)))
        throw new Error('Quantity question requires a current observed product.')
      const serving = pbBasicServing(product.name, product.unitPrice)
      const question: PresentedQuestion = { questionId: crypto.randomUUID(), purpose: 'browser-order-quantity', question: `${serving ? `${pbProductName(product.name)}${serving}。` : ''}請問「${pbProductName(product.name)}」要幾份？`, expiresAt: now() + 120_000, choices: [{ id: 'cancel', description: '取消這次尚未加入的餐點，保留購物車。' }] }
      ticket = { kind: 'quantity', binding: structuredClone({ ...snapshot, products: [product] }), product: structuredClone(product), request, requestTarget, question, orderSelection }
      return structuredClone(question)
    },
    /** Fills only the count; the task checks whether the resulting purchase is complete. */
    consumeQuantity(questionId: string, quantity: number, snapshot: QuestionSnapshot) {
      const pending = current(snapshot)
      if (!pending || pending.kind !== 'quantity' || pending.question.questionId !== questionId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99)
        return
      ticket = undefined
      return { product: structuredClone(pending.product), request: pending.request, requestTarget: pending.requestTarget, quantity, orderSelection: pending.orderSelection }
    },
    pending(snapshot: QuestionSnapshot) {
      const pending = current(snapshot)
      return pending ? structuredClone(pending) : undefined
    },
    consume(questionId: string, choiceId: string, snapshot: QuestionSnapshot) {
      const pending = current(snapshot)
      if (!pending || pending.question.questionId !== questionId || !pending.question.choices.some(choice => choice.id === choiceId))
        return { kind: 'invalid' as const }
      // Revoke before returning a plan, so a duplicate answer cannot dispatch
      // another add while the first accepted operation is still in flight.
      ticket = undefined
      if (pending.kind === 'service') {
        if (choiceId === 'no')
          ticket = pending.previous
        return { kind: 'service' as const, purpose: pending.purpose, name: pending.name, quantity: pending.quantity, query: pending.query, request: pending.request, choiceId, question: pending.question.question, answer: pending.question.choices.find(choice => choice.id === choiceId)!.description }
      }
      if (choiceId === 'cancel')
        return { kind: 'cancelled' as const }
      if (pending.kind === 'quantity')
        return { kind: 'invalid' as const }
      if (pending.kind === 'slot')
        return { kind: 'slot' as const, slot: structuredClone(pending.slot), choiceId }
      if (pending.kind === 'order')
        return { kind: 'order' as const, proposals: structuredClone(pending.proposals) }
      if (pending.kind === 'addition')
        return { kind: 'addition' as const, proposal: structuredClone(pending.proposal) }
      if (choiceId === 'next' || choiceId === 'previous')
        return { kind: 'page' as const, products: structuredClone(pending.products), request: pending.request, query: pending.query, page: pending.page + (choiceId === 'next' ? 1 : -1) }
      const index = pending.question.choices.findIndex(choice => choice.id === choiceId)
      return { kind: 'product' as const, product: structuredClone(pending.visible[index]) }
    },
    reset() { ticket = undefined },
  }
}
