import type { AnswerDecision, BrowserAnswer } from '../../../server/src/services/domain/browser-ordering/contracts'
import type { AdditionProposal, QuestionSnapshot } from './browserQuestionWindow'

import { errorMessageFrom } from '@moeru/std'
import { productFragment } from '@proj-airi/stage-shared/product-discovery'
import { productConfigurationSchema, resolveSelection } from '@proj-airi/stage-ui/services/pbProduct'
import { array, looseObject, number, parse, string } from 'valibot'

import { cartSnapshotSchema } from '../../../server/src/services/domain/browser-ordering/contracts'
import { createBrowserQuestionWindow } from './browserQuestionWindow'

const factsSchema = looseObject({
  cart: cartSnapshotSchema,
  products: array(looseObject({ ref: string(), name: string(), price: number(), configurations: array(productConfigurationSchema) })),
})

/**
 * Owns pending PB questions across utterances. An answer is only a semantic ID;
 * current session/document/cart/config evidence must still authorize consumption.
 */
export function createBrowserDialogue(io: {
  owner: () => string | undefined
  documentId: () => string | undefined
  answer: (input: BrowserAnswer) => Promise<AnswerDecision>
}) {
  const questions = createBrowserQuestionWindow()

  function snapshot(raw: unknown): QuestionSnapshot | undefined {
    const facts = parse(factsSchema, raw)
    const owner = io.owner()
    const documentId = io.documentId()
    if (!owner || !documentId)
      return
    return { owner, documentId, cartVersion: facts.cart.version, products: facts.products.filter(product => product.configurations.length === 1).map(product => ({ productRef: product.ref, name: product.name, configurationVersion: product.configurations[0].version, unitPrice: product.price })) }
  }

  function receipt(question: ReturnType<typeof questions.presentProducts>) {
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', pendingCustomerChoice: question, customerMessage: question.question }
  }

  return {
    reset: () => questions.reset(),
    hasPending: () => questions.hasPending(),
    validate(raw: unknown, questionId: string) {
      const binding = snapshot(raw)
      const pending = binding && questions.pending(binding)
      return pending?.question.questionId === questionId ? pending.question : undefined
    },
    accepts(binding: QuestionSnapshot, raw: unknown) {
      const fresh = snapshot(raw)
      return !!fresh && binding.owner === fresh.owner && binding.documentId === fresh.documentId && binding.cartVersion === fresh.cartVersion && binding.products.every(product => fresh.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product)))
    },
    presentProducts(raw: unknown, query: string, request: string) {
      const binding = snapshot(raw)
      const term = query.trim()
      const matches = term ? binding?.products.filter(product => product.name.includes(term)) : undefined
      let products = matches
      if (!products?.length && binding) {
        // A failed literal query can still contain a spoken fragment of today's
        // names. Discovery only narrows a confirmation; it never identifies a SKU
        // for a write or replaces the one-use customer-answer protocol.
        products = binding.products.filter(product => productFragment(product, binding.products, request) !== undefined)
      }
      if (!products?.length) {
        // With no related observed fragment, retain the existing catalog choice
        // rather than claiming absence or inventing a replacement product.
        products = binding?.products
      }
      if (!binding || !products?.length)
        return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前沒有可確認的符合選項，請在畫面選餐或說明完整品名。' }
      const question = questions.presentProducts(binding, products, request)
      // The first question page is at most eight products. Keep the actual
      // issued refs with its receipt so Host visuals never parse question prose.
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
        const optionSummary = selected.choices.map(choice => `${configuration.groups.flatMap(group => group.choices).find(option => option.ref === choice.ref)!.name} 每份 ${choice.quantity} 個`).join('、')
        const proposal: AdditionProposal = { productRef: product.ref, productName: product.name, quantity: Number(input.quantity), unitPrice: selected.unitPrice, note: typeof input.note === 'string' ? input.note : '', optionSummary, selection }
        return receipt(questions.presentAddition(binding, proposal))
      }
      catch (error) {
        // No vendor call occurs while building a confirmation. Invalid model
        // settings are repairable proposals, never an unknown cart effect.
        return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, error: errorMessageFrom(error) ?? 'Invalid product proposal.', explanation: '尚未建立確認或加車。請使用最新商品的 productRef、configurations.version、variantRef、選項與配置後售價，修正同一品項的完整提案；不可改選其他商品。' }
      }
    },
    async answer(raw: unknown, transcript: string, observe: () => Promise<unknown>, isCurrent: () => boolean) {
      const binding = snapshot(raw)
      const pending = binding && questions.pending(binding)
      if (!pending || !isCurrent())
        return
      const decision = await io.answer({ questionId: pending.question.questionId, transcript, cartContext: parse(factsSchema, raw).cart }).catch((): AnswerDecision => ({ kind: 'UNCERTAIN', provider: 'unavailable' }))
      // Re-observe after model IO: a touch, new price, reload or customer switch
      // during that wait invalidates the original question instead of rebinding it.
      const fresh = snapshot(await observe())
      if (!fresh || !isCurrent() || !questions.pending(fresh))
        return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '餐點或購物車狀態已變更，請重新確認。' } }
      if (decision.kind === 'NEW_REQUEST') {
        questions.reset()
        return pending.kind === 'addition' ? { kind: 'new-request' as const, previousProposal: pending.proposal } : undefined
      }
      if (decision.kind !== 'ANSWER' || !decision.choiceId)
        return { kind: 'receipt' as const, result: receipt(pending.question) }
      const selected = questions.consume(pending.question.questionId, decision.choiceId, fresh)
      if (selected.kind === 'product')
        return { kind: 'product' as const, product: selected.product, request: pending.kind === 'product' ? pending.request : '' }
      if (selected.kind === 'addition')
        return { kind: 'addition' as const, proposal: selected.proposal, binding: fresh }
      if (selected.kind === 'page')
        return { kind: 'receipt' as const, result: receipt(questions.presentProducts(fresh, selected.products, selected.request, selected.page)) }
      return { kind: 'receipt' as const, result: { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: selected.kind === 'cancelled' ? '已取消這次選餐，購物車保持不變。' : '這個問題已失效，請重新確認。' } }
    },
  }
}
