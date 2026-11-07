import type { ProductSelection } from '@proj-airi/stage-ui/services/pbProduct'

import type { PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

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
  selection: ProductSelection
}

type Ticket = { binding: QuestionSnapshot, question: PresentedQuestion } & (
  | { kind: 'product', products: QuestionProduct[], visible: QuestionProduct[], page: number, request: string }
  | { kind: 'addition', proposal: AdditionProposal }
)

/**
 * Owns one presented, expiring, one-use browser question. Selection only resolves
 * a product; adding requires a separately presented complete confirmation. The
 * semantic answer resolver chooses IDs, never constructs executable arguments.
 */
export function createBrowserQuestionWindow(now = Date.now) {
  let ticket: Ticket | undefined

  function current(snapshot: QuestionSnapshot) {
    if (!ticket)
      return
    const previous = ticket.binding
    const sameProducts = previous.products.every(product => snapshot.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product)))
    if (ticket.question.expiresAt <= now() || previous.owner !== snapshot.owner || previous.documentId !== snapshot.documentId || previous.cartVersion !== snapshot.cartVersion || !sameProducts) {
      ticket = undefined
      return
    }
    return ticket
  }

  return {
    /** A hint only; authority still requires pending(snapshot) to recheck freshness. */
    hasPending: () => ticket !== undefined,
    presentProducts(snapshot: QuestionSnapshot, products: QuestionProduct[], request: string, page = 0) {
      if (!products.length || new Set(products.map(product => product.productRef)).size !== products.length)
        throw new Error('Question requires distinct observed product references.')
      if (products.some(product => !snapshot.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product))))
        throw new Error('Question candidates must come from the current observation.')
      // Keep the full discovered list. Bound each spoken page rather than
      // treating a fixed first batch as the complete daily menu.
      const pages: QuestionProduct[][] = [[]]
      for (const product of products) {
        const last = pages.at(-1)!
        if (last.length && (last.length >= 8 || [...last, product].reduce((sum, item) => sum + item.name.length, 0) > 350))
          pages.push([])
        pages.at(-1)!.push(product)
      }
      const visible = pages[page]
      if (!Number.isInteger(page) || !visible)
        throw new Error('Question page is outside the observed product list.')
      const navigation = [
        ...(page > 0 ? [{ id: 'previous', description: '看上一頁選項，尚未加入餐點。' }] : []),
        ...(page < pages.length - 1 ? [{ id: 'next', description: '看下一頁選項，尚未加入餐點。' }] : []),
      ]
      const pageMessage = pages.length > 1 ? `（第 ${page + 1} 頁，共 ${pages.length} 頁；可說下一頁或上一頁）` : ''
      const wording = visible.length === 1 ? `您是指「${visible[0]!.name}」嗎？` : `請問您要${visible.map(product => product.name).join('、')}，哪一項？`
      const question: PresentedQuestion = { questionId: crypto.randomUUID(), purpose: 'browser-product-choice', question: `${wording}${pageMessage}`, expiresAt: now() + 120_000, choices: [...visible.map((product, index) => ({ id: `product:${index + 1}`, description: `本頁第 ${index + 1} 項「${product.name}」，單份基本售價 ${product.unitPrice} 元；只選品項，尚未加入。` })), ...navigation, { id: 'cancel', description: '取消這個尚未完成的選餐，不變更購物車。' }] }
      // Copy at presentation: a later catalog reorder cannot redefine "second".
      ticket = { kind: 'product', binding: structuredClone({ ...snapshot, products }), products: structuredClone(products), visible: structuredClone(visible), page, question, request }
      return structuredClone(question)
    },
    presentAddition(snapshot: QuestionSnapshot, proposal: AdditionProposal) {
      const product = snapshot.products.find(product => product.productRef === proposal.productRef && product.configurationVersion === proposal.selection.version)
      if (!product || product.name !== proposal.productName || !Number.isInteger(proposal.quantity) || proposal.quantity < 1 || proposal.quantity > 99 || !Number.isFinite(proposal.unitPrice) || proposal.unitPrice < 0)
        throw new Error('Confirmation requires a complete current product proposal.')
      const amount = Math.round(proposal.unitPrice * 100) * proposal.quantity / 100
      const question: PresentedQuestion = { questionId: crypto.randomUUID(), purpose: 'browser-confirm-add', question: `確認加入${proposal.productName} ${proposal.quantity} 份${proposal.optionSummary ? `（${proposal.optionSummary}）` : ''}，單份 ${proposal.unitPrice} 元，合計 ${amount} 元${proposal.note ? `，備註「${proposal.note}」` : ''}嗎？`, expiresAt: now() + 120_000, choices: [{ id: 'confirm', description: `確認現在加入這個完整設定的${proposal.productName} ${proposal.quantity} 份，合計 ${amount} 元；不送單付款。` }, { id: 'cancel', description: '先不加入這份餐點，保留原購物車。' }] }
      ticket = { kind: 'addition', binding: structuredClone({ ...snapshot, products: [product] }), proposal: structuredClone(proposal), question }
      return structuredClone(question)
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
      if (choiceId === 'cancel')
        return { kind: 'cancelled' as const }
      if (pending.kind === 'addition')
        return { kind: 'addition' as const, proposal: structuredClone(pending.proposal) }
      if (choiceId === 'next' || choiceId === 'previous')
        return { kind: 'page' as const, products: structuredClone(pending.products), request: pending.request, page: pending.page + (choiceId === 'next' ? 1 : -1) }
      const index = pending.question.choices.findIndex(choice => choice.id === choiceId)
      return { kind: 'product' as const, product: structuredClone(pending.visible[index]) }
    },
    reset() { ticket = undefined },
  }
}
