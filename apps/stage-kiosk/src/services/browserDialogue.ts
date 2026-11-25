import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'
import type { PbCheckoutStep } from '@proj-airi/stage-shared/pb-checkout'

import type { AnswerDecision, BrowserAnswer } from '../../../server/src/services/domain/browser-ordering/contracts'
import type { AdditionProposal, QuestionSnapshot } from './browserQuestionWindow'

import { errorMessageFrom } from '@moeru/std'
import { browserQuestionChoice } from '@proj-airi/stage-shared/browser-conversation'
import { labelCatalog } from '@proj-airi/stage-shared/ordering-sites'
import { explicitServingQuantities, normalizeSlotNumbers } from '@proj-airi/stage-shared/ordering-slots'
import { pbCartStateSchema } from '@proj-airi/stage-shared/pb-browser-state'
import { pbCheckoutSchema, pbCheckoutStepSchema } from '@proj-airi/stage-shared/pb-checkout'
import { parsePbDumplingOrder, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { productFragment } from '@proj-airi/stage-shared/product-discovery'
import { resolveSelection } from '@proj-airi/stage-ui/services/pbProduct'
import { array, looseObject, number, parse, safeParse, string } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { createBrowserOrderDrafts, orderFactsSchema, orderSlotCount } from './browserOrderDrafts'
import { createBrowserQuestionWindow, servingLimits } from './browserQuestionWindow'
import { finishedOrdering } from './checkoutInvitation'
import { createRecommendationSession } from './recommendationSession'
import { createTableSelection } from './tableSelection'

const factsSchema = orderFactsSchema
const phoneMessages = orderingMessages['zh-Hant'].checkout.notificationPhone
const checkoutEntryPurposes = new Set(['invoice-details', 'notification-details', 'checkout-details'])

function menuNextStep(raw: unknown) {
  const messages = orderingMessages['zh-Hant'].nextStep
  return parse(factsSchema, raw).cart.lines.length ? messages.withCart : messages.emptyCart
}

// Only an entire numeric reply belongs to a donation slot. Preserve leading
// zeroes and reject attached requests rather than extracting arbitrary digits.
function donationCodeInput(transcript: string) {
  const code = normalizeSlotNumbers(transcript).replaceAll(/[零〇]/g, '0').replaceAll(/幺/g, '1').replace(/^(?:捐贈碼|愛心碼)是?[：:\s]*/, '').replaceAll(/[\s，,。！!、]/g, '')
  return /^\d+$/.test(code) ? code : undefined
}

// Tax fragments belong only to the issued invoice question. Eight digits replace
// the buffer; shorter replies append unless the customer explicitly restarts.
function taxIdInput(transcript: string) {
  if (/^(?:重來|重新輸入|重新說|重新報)[。！!\s]*$/.test(transcript.trim()))
    return { digits: '', replace: true }
  const text = normalizeSlotNumbers(transcript).replaceAll(/[零〇]/g, '0').replaceAll(/幺/g, '1').replace(/^(?:我的)?(?:統一編號|統編)是?[：:\s]*/, '').replace(/^(?:更正|改成)[：:\s]*/, '').replaceAll(/[\s，,。！!、]/g, '')
  return /^\d+$/.test(text) ? { digits: text, replace: text.length === 8 || /^(?:更正|改成)/.test(transcript.trim()) } : undefined
}

// Phone fragments are literal data only inside a bound notification question.
// Keep leading zeroes; never pull digits from an unrelated ordering sentence.
const spokenPhoneDigits: Record<string, string> = {
  零: '0',
  〇: '0',
  鈴: '0',
  靈: '0',
  林: '0',
  幺: '1',
  么: '1',
  壹: '1',
  衣: '1',
  貳: '2',
  參: '3',
  山: '3',
  肆: '4',
  伍: '5',
  午: '5',
  陸: '6',
  溜: '6',
  柒: '7',
  妻: '7',
  捌: '8',
  吧: '8',
  玖: '9',
  酒: '9',
}

function notificationPhoneInput(transcript: string, previous: string) {
  const compact = transcript.trim().replaceAll(/[\s，,。！!、：:.-]/g, '')
  if (/^(?:重來|重新輸入|重新說|重新報|不對|不是|錯了|不正確|更正|改成|尾數|尾碼|後面|最後|第.+碼)/.test(compact))
    return { digits: '' }
  const text = normalizeSlotNumbers(compact.replace(/^(?:我的)?(?:通知)?(?:手機|電話)(?:號碼)?是?/, ''))
  const digits = Array.from(text, char => spokenPhoneDigits[char] ?? char).join('')
  if (!/^\d+$/.test(digits))
    return
  if (digits.length === 10)
    return { digits }
  // A fragment after read-back cannot identify which digits were misheard.
  return { digits: previous.length === 10 ? '' : previous + digits }
}

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

/** A Host-owned Jev selection from the exact question offered in this turn. */
export interface SelectedBrowserAnswer {
  questionId: string
  choiceId: string
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
  const tables = createTableSelection(io)
  let answeredQuestion: BrowserConversation['answeredQuestion'] | undefined
  let answeredUtteranceId: number | undefined
  let orderEvidence: OrderEvidence | undefined
  // The signature binds repeated failures to one visitor/document/cart and the
  // actual question content, so reissuing a UUID cannot restart an endless loop.
  // One utterance may pass both Jev and Main; count it only once.
  let unresolvedQuestion: { signature: string, attempts: number, utteranceId?: number } | undefined

  // A quick-path read may consume a question before Main takes over the same
  // utterance. This evidence expires with that question and keeps its binding;
  // another turn, visitor, document or cart cannot inherit the selection.
  // Workflow position survives entry-ticket expiry/cart revisions, but never a
  // new visitor/document. It stores no submission token or buffered phone value.
  let checkoutProgress: { owner: string, documentId: string, purpose: PbCheckoutStep, request: string, suspended: boolean } | undefined
  // This is observation history, never answer or submission authority. Tokens
  // are excluded so refreshing final consent cannot masquerade as form progress.
  let checkoutObservation: { signature: string, attempts: number, turn: object | number } | undefined

  let acceptedSelection: { utteranceId: number, expiresAt: number, binding: QuestionSnapshot, selection: { productRef: string, request: string, requestTarget?: string, requestedQuantity: number, orderSelection?: true }, evidence: OrderEvidence } | undefined

  // The phone value belongs to the current reception/order; the expiring
  // question only authorizes its next answer. Never persist it across visitors.
  let phoneDraft: { owner: string, digits: string, observedField?: string, documentId?: string } | undefined

  function phoneQuestion(binding: QuestionSnapshot, request: string, digits: string) {
    const complete = /^09\d{8}$/.test(digits)
    const question = complete ? phoneMessages.confirm : phoneMessages.partial
    return questions.presentService(binding, {
      purpose: complete ? 'notification-phone-confirm' : 'notification-phone',
      query: digits,
      request,
      question: question.replace('{digits}', digits.split('').join(' ')).replace('{count}', String(digits.length)),
      choices: complete ? [{ id: 'yes', description: '號碼正確，填入剛才覆誦的通知手機，不送出訂單。' }, { id: 'no', description: '號碼有誤，請從頭重新報通知手機。' }] : [],
    })
  }

  // A single verified increase may be reversed only against the exact resulting cart.
  let lastIncrease: { owner: string, documentId: string, version: string, ref: string, before: number, added: number, label: string } | undefined

  function releaseQuestion() {
    checkoutObservation = undefined
    if (checkoutProgress)
      checkoutProgress.suspended = true
    questions.reset()
    orders.reset()
    orderEvidence = undefined
    acceptedSelection = undefined
    answeredQuestion = undefined
    answeredUtteranceId = undefined
    unresolvedQuestion = undefined
  }

  function snapshot(raw: unknown): QuestionSnapshot | undefined {
    const facts = parse(factsSchema, raw)
    const owner = io.owner()
    const documentId = io.documentId()
    const checkout = safeParse(pbCheckoutSchema, facts.checkout)
    if (phoneDraft?.owner !== owner)
      phoneDraft = undefined
    if (!owner || !documentId)
      return
    const field = checkout.success ? checkout.output.fields.find(field => field.kind === 'phone') : undefined
    if (field) {
      phoneDraft ??= { owner, digits: '' }
      // Readbacks of the same field must not overwrite newly dictated digits.
      // A newly mounted empty field can resume a draft from before an add-on.
      if (field.value !== phoneDraft.observedField && (field.value || (phoneDraft.documentId === documentId && phoneDraft.observedField)))
        phoneDraft.digits = /^0(?:9\d{0,8})?$/.test(field.value) ? field.value : ''
      phoneDraft.observedField = field.value
      phoneDraft.documentId = documentId
    }
    else if (phoneDraft) {
      phoneDraft.observedField = undefined
    }
    const checkoutVersion = checkout.success ? JSON.stringify({ ...checkout.output, confirmationToken: undefined }) : undefined
    return { owner, documentId, cartVersion: facts.cart.version, checkoutVersion, products: facts.products.filter(product => product.configurations.length === 1).map(product => ({ productRef: product.ref, name: product.name, configurationVersion: product.configurations[0].version, unitPrice: product.price })) }
  }

  function pendingQuestion(raw: unknown, binding: QuestionSnapshot | undefined) {
    if (!binding)
      return
    if (checkoutProgress && (checkoutProgress.owner !== binding.owner || checkoutProgress.documentId !== binding.documentId))
      checkoutProgress = undefined
    const pending = questions.pending(binding)
    if (pending?.kind === 'service' && phoneDraft && ['notification-phone', 'notification-phone-confirm'].includes(pending.purpose) && pending.query !== phoneDraft.digits) {
      if (phoneDraft.digits)
        phoneQuestion(binding, pending.request, phoneDraft.digits)
      else
        questions.presentService(binding, { purpose: 'notification-phone', request: pending.request, query: '', question: phoneMessages.restart, choices: [] })
      return questions.pending(binding)
    }
    if (pending || !checkoutProgress || checkoutProgress.suspended)
      return pending
    const checkout = safeParse(pbCheckoutSchema, raw && typeof raw === 'object' && 'checkout' in raw ? raw.checkout : undefined)
    if (!checkout.success)
      return
    const messages = orderingMessages['zh-Hant'].checkout
    if (checkoutProgress.purpose === 'notification-details' && phoneDraft?.digits) {
      phoneQuestion(binding, checkoutProgress.request, phoneDraft.digits)
      return questions.pending(binding)
    }
    const methodStep = checkoutProgress.purpose === 'invoice-method'
    const question = methodStep ? messages.invoiceOptions.replace('{methods}', checkout.output.methods.map(method => method.label).join('、')) : messages.resumeEntry
    const choices = methodStep ? checkout.output.methods.map(method => ({ id: method.method, description: `選擇${method.label}，只設定發票，不送出訂單。` })) : [{ id: 'yes', description: '重新檢查目前填寫資料並繼續；不送出訂單。' }, { id: 'no', description: '保留資料，稍後繼續。' }]
    questions.presentService(binding, { purpose: checkoutProgress.purpose, request: checkoutProgress.request, question, choices })
    return questions.pending(binding)
  }

  function selectionRefs(pending: NonNullable<ReturnType<typeof questions.pending>>) {
    if (pending.kind === 'product')
      return pending.visible.map(product => product.productRef)
    if (pending.kind === 'quantity')
      return [pending.product.productRef]
    if (pending.kind === 'addition')
      return [pending.proposal.productRef]
    if (pending.kind === 'slot')
      return orders.projection(pending.binding)?.map(draft => draft.productRef) ?? [pending.slot.productRef]
    if (pending.kind === 'order')
      return pending.proposals.map(proposal => proposal.productRef)
    return pending.binding.products.filter(product => product.name === pending.name).map(product => product.productRef)
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

  // Literal answers resolve against the actual issued question, never model
  // prose. Require the whole reply so attached new demands retain Main handling.
  function literalChoice(pending: NonNullable<ReturnType<typeof questions.pending>>, transcript: string) {
    if (pending.kind === 'service' && ['purchase-recommendation', 'review-checkout'].includes(pending.purpose)
      && /^(?:不要了|先不要了|先不用了|再看看)[。！!，,\s]*$/.test(transcript.trim())) {
      return 'no'
    }
    if (pending.kind === 'service' && pending.purpose === 'review-checkout'
      && /^先不結帳[。！!，,\s]*$/.test(transcript.trim())) {
      return 'no'
    }
    // Completion acknowledges data entry only. The next step re-reads fields;
    // these phrases never authorize submission or alter the form themselves.
    if (pending.kind === 'service' && pending.purpose === 'invoice-details'
      && /^(?:掃好了|掃完了|掃描好了|掃描完了)[。！!，,\s]*$/.test(transcript.trim())) {
      return 'yes'
    }
    if (pending.kind === 'service' && checkoutEntryPurposes.has(pending.purpose)
      && /^(?:ok|okay|好|好的|好了|填好了|資料填好了)[。！!，,\s]*$/i.test(transcript.trim())) {
      return 'yes'
    }
    if (pending.kind === 'service' && ['review-checkout', 'cart-review'].includes(pending.purpose)
      && (finishedOrdering(transcript) || /^(?:餐點正確|餐點沒問題)[。！!，,\s]*$/.test(transcript.trim()))) {
      return 'yes'
    }
    if (pending.kind === 'service' && ['cart-review', 'notification-phone-confirm', 'invoice-donation-confirm', 'invoice-tax-confirm'].includes(pending.purpose)
      && /^(?:正確|沒錯|對|是的|確認|確認無誤|好|好的|好了)[。！!，,\s]*$/.test(transcript.trim())) {
      return 'yes'
    }
    if (pending.kind === 'service' && ['notification-phone-confirm', 'invoice-donation-confirm', 'invoice-tax-confirm'].includes(pending.purpose)
      && /^(?:不對|不正確|錯了|錯誤|不是)[。！!，,\s]*$/.test(transcript.trim())) {
      return 'no'
    }
    if (pending.kind !== 'product')
      return
    const text = transcript.replaceAll(/[\s，,。！!]/g, '').replace(/^(?:我要|我想要|就要|要|選)/, '').replace(/(?:謝謝|好了)$/, '')
    const catalog = labelCatalog(pending.visible.map(product => ({ ...product, name: product.name })), io.catalogLabels?.())
    const matches = catalog.map((product, index) => ({ product, index })).filter(({ product }) => [product.name, pbProductName(product.name), ...product.aliases].some(name => name.replaceAll(/\s/g, '') === text))
    return matches.length === 1 ? `product:${matches[0].index + 1}` : undefined
  }

  // Short piece replies inherit a product only from its live quantity question.
  // The parser must cover the entire reply; mixed dishes/changes stay with Main.
  function dumplingAnswer(raw: unknown, pending: NonNullable<ReturnType<typeof questions.pending>>, transcript: string) {
    if (pending.kind !== 'quantity')
      return
    const products = labelCatalog(parse(factsSchema, raw).products, io.catalogLabels?.())
    const product = products.find(product => product.ref === pending.product.productRef)
    if (!product)
      return
    const labels = [product.name, pbProductName(product.name), ...product.aliases.filter(alias => products.filter(candidate => candidate.name === alias || candidate.aliases.includes(alias)).length === 1)]
    const label = labels.find(label => transcript.includes(label)) ?? ''
    return parsePbDumplingOrder(transcript, product.name, label)
  }

  function receipt(question: ReturnType<typeof questions.presentProducts>) {
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', pendingCustomerChoice: question, customerMessage: question.question }
  }

  function clarifyPhoneInterruption(raw: unknown, transcript: string, pending = pendingQuestion(raw, snapshot(raw))) {
    if (pending?.kind !== 'service' || pending.purpose !== 'notification-phone' || !pending.query)
      return
    const text = transcript.replaceAll(/[\s，,。！!]/g, '')
    const products = labelCatalog(parse(factsSchema, raw).products, io.catalogLabels?.())
    const matches = products.filter(product => [product.name, pbProductName(product.name), ...product.aliases].some(name => name.replaceAll(/\s/g, '') === text))
    if (matches.length !== 1)
      return
    // Keep the bound digit buffer. A bare name can be background speech and
    // cannot release checkout or open a product on the merchant page.
    return { ...receipt(pending.question), customerMessage: phoneMessages.mealInterruption.replace('{meal}', pbProductName(matches[0].name)) }
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
    const total = next.proposals.reduce((sum, proposal) => sum + proposal.quantity, 0)
    if (total > servingLimits.maximum)
      return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: `這次要求 ${total} 份，機台一次最多可加 ${servingLimits.maximum} 份。請問要改為幾份？` }
    if (total > servingLimits.confirmAbove)
      return receipt(questions.presentOrder(binding, next.proposals))
    return { ok: true, source: 'browser', completeOrder: { proposals: next.proposals, binding, evidence } }
  }

  return {
    recommendations,
    tables,
    rememberIncrease(previous: unknown, result: unknown) {
      lastIncrease = undefined
      const owner = io.owner()
      const documentId = io.documentId()
      const schema = looseObject({ cart: pbCartStateSchema })
      const before = safeParse(schema, previous)
      const after = safeParse(schema, result)
      if (!owner || !documentId || !before.success || !after.success)
        return
      const rows = before.output.cart.lines
      const updated = after.output.cart.lines
      const changes = updated.filter(row => row.quantity !== rows.find(old => old.ref === row.ref)?.quantity)
      if (changes.length !== 1 || rows.some(old => !updated.some(row => row.ref === old.ref && row.configuration === old.configuration && row.name === old.name && row.unitPrice === old.unitPrice && row.note === old.note)))
        return
      const row = changes[0]
      const original = rows.find(old => old.ref === row.ref)?.quantity ?? 0
      if (row.quantity > original)
        lastIncrease = { owner, documentId, version: after.output.cart.version, ref: row.ref, before: original, added: row.quantity - original, label: [pbProductName(row.name), row.description, row.note].filter(Boolean).join('，') }
    },
    offerUndo(raw: unknown, request: string) {
      const change = lastIncrease
      if (!change || !/^(?:請|幫我)?取消(?:剛才的加餐)?[。！!]*$/.test(request.trim()))
        return
      const binding = snapshot(raw)
      if (!binding || change.owner !== binding.owner || change.documentId !== binding.documentId || change.version !== binding.cartVersion)
        return
      const pending = questions.pending(binding)
      if (pending && (pending.kind !== 'service' || !['review-checkout', 'cart-review'].includes(pending.purpose)))
        return
      return this.presentService(raw, { purpose: 'undo-cart-increase', request, question: `要拿掉剛才加的 ${change.added} 份${change.label}嗎？`, choices: [{ id: 'yes', description: '只拿掉剛才新增的份數' }, { id: 'no', description: '保留目前餐點' }] })
    },
    hasSubmissionQuestion: questions.hasSubmissionQuestion,
    /** Resume the current question or offer a menu-specific next step without changing the order. */
    readingFollowUp(raw: unknown): string {
      const question = this.conversation(raw).waitingFor?.question
      if (question)
        return question
      const facts = safeParse(factsSchema, raw)
      const copy = orderingMessages['zh-Hant'].nextStep
      if (!facts.success)
        return copy.emptyCart
      if (facts.output.cart.lines.length)
        return copy.withCart
      const dismissed = recommendations.dismissedProducts()
      const product = recommendations.filter(labelCatalog(facts.output.products, io.catalogLabels?.())).find(item => !dismissed.includes(item.ref))
      return product ? copy.suggestDish.replace('{dish}', pbProductName(product.name)) : copy.emptyCart
    },
    /** Detects unchanged checkout outcomes across distinct utterances; no customer values leave this boundary. */
    observeCheckout(raw: unknown, step: string, failed: boolean, turn: object | number) {
      const binding = snapshot(raw)
      const checkout = safeParse(pbCheckoutSchema, raw && typeof raw === 'object' && 'checkout' in raw ? raw.checkout : undefined)
      if (!binding || !checkout.success) {
        checkoutObservation = undefined
        return
      }
      const signature = JSON.stringify({ owner: binding.owner, documentId: binding.documentId, cartVersion: binding.cartVersion, step, failed, checkout: { ...checkout.output, confirmationToken: undefined } })
      const previous = checkoutObservation?.signature === signature ? checkoutObservation : undefined
      const attempts = (previous?.attempts ?? 0) + (previous?.turn === turn ? 0 : 1)
      checkoutObservation = { signature, attempts, turn }
      // The initial entry prompt is an observation, then two completed answers
      // without a change trigger recovery. Failed operations have no initial prompt.
      if (attempts < (failed ? 2 : 3))
        return
      checkoutObservation = undefined
      return { reason: failed ? 'operation-failed' as const : 'no-progress' as const, step, attempts }
    },
    clarifyPhoneInterruption,
    /** Returns the current service question or its visitor/document-bound checkout position. */
    checkoutStep(raw: unknown) {
      const binding = snapshot(raw)
      const pending = pendingQuestion(raw, binding)
      if (pending) {
        const step = safeParse(pbCheckoutStepSchema, pending.kind === 'service' ? pending.purpose : undefined)
        return pending.kind === 'service' && ['invoice-donation-confirm', 'invoice-tax', 'invoice-tax-confirm'].includes(pending.purpose) ? 'invoice-details' : step.success ? step.output : undefined
      }
      return binding ? checkoutProgress?.purpose : undefined
    },
    releaseService(raw: unknown, questionId: string) {
      const binding = snapshot(raw)
      if (binding) {
        const pending = questions.pending(binding)
        if (pending?.kind === 'service' && pending.question.questionId === questionId && checkoutProgress)
          checkoutProgress.suspended = true
        questions.releaseService(binding, questionId)
      }
    },
    /** Retires a stalled checkout prompt without changing merchant or meal state. */
    pauseCheckout(raw: unknown) {
      const binding = snapshot(raw)
      if (!binding)
        return
      const pending = questions.pending(binding)
      if (pending?.kind === 'service')
        questions.releaseService(binding, pending.question.questionId)
      if (checkoutProgress)
        checkoutProgress.suspended = true
    },
    reset: (options?: { keepOrderContact: boolean }) => {
      lastIncrease = undefined
      tables.reset()
      if (!options?.keepOrderContact)
        phoneDraft = undefined
      checkoutProgress = undefined
      checkoutObservation = undefined
      releaseQuestion()
    },
    /** Current offered or unfinished items, used to avoid repeating them after cancellation. */
    selectionRefs(raw: unknown) {
      const binding = snapshot(raw)
      const pending = binding && questions.pending(binding)
      return pending ? selectionRefs(pending) : []
    },
    hasPending: () => tables.hasPending() || questions.hasPending() || Boolean(checkoutProgress && !checkoutProgress.suspended && checkoutProgress.owner === io.owner() && checkoutProgress.documentId === io.documentId()),
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
      const pending = pendingQuestion(raw, binding)
      if (!pending)
        return false
      const choice = literalChoice(pending, transcript)
      const namedProduct = pending.kind === 'product' && choice ? pending.visible[Number(choice.split(':')[1]) - 1] : undefined
      const namedAnswer = pending.kind === 'product' && namedProduct && (explicitServingQuantities(pending.request).length === 0 || completePurchase(raw, pending.request, namedProduct.productRef) !== undefined)
      const checkout = safeParse(looseObject({ checkout: pbCheckoutSchema }), raw)
      return !!clarifyPhoneInterruption(raw, transcript, pending)
        || !!browserQuestionChoice(transcript, pending.question)
        || (pending.kind === 'service' && !!choice)
        || (pending.kind === 'service' && ['notification-details', 'notification-phone', 'notification-phone-confirm'].includes(pending.purpose) && notificationPhoneInput(transcript, pending.query ?? '') !== undefined)
        || (pending.kind === 'service' && ['invoice-details', 'invoice-tax', 'invoice-tax-confirm'].includes(pending.purpose) && checkout.success && checkout.output.checkout.methods.some(method => method.method === 'tax' && method.selected) && taxIdInput(transcript) !== undefined)
        || (pending.kind === 'service' && ['invoice-details', 'invoice-donation-confirm'].includes(pending.purpose) && checkout.success && checkout.output.checkout.methods.some(method => method.method === 'donation' && method.selected) && donationCodeInput(transcript) !== undefined)
        || !!namedAnswer
        || (pending.kind === 'service' && pending.purpose === 'purchase-recommendation' && purchaseAnswerCount(transcript) !== undefined)
        || (pending.kind === 'quantity' && (quantityAnswerCount(transcript) !== undefined || dumplingAnswer(raw, pending, transcript) !== undefined))
        || (pending.kind === 'slot' && pending.slot.kind === 'dumpling-pieces' && (/^(?:正常|基本|原本)[。！!，,\s]*$/.test(transcript.trim()) || parsePbDumplingOrder(transcript, pending.slot.name, '') !== undefined))
        || (pending.kind === 'slot' && orderSlotCount(transcript, pending.slot) !== undefined)
    },
    collectOrder(raw: unknown, input: unknown, source: string, provided?: { productRef: string, quantity?: number, answer?: string }) {
      if (checkoutProgress)
        checkoutProgress.suspended = true
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
      const tableQuestion = tables.pending(raw)
      // Table admission intentionally has no cart. Its optional confirmation
      // must be projected before the menu/cart snapshot parser runs.
      if (raw && typeof raw === 'object' && 'page' in raw && raw.page === 'table')
        return { phase: 'selecting_table', waitingFor: tableQuestion }
      const binding = snapshot(raw)
      const pending = pendingQuestion(raw, binding)
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
      const tableQuestion = tables.pending(raw)
      if (raw && typeof raw === 'object' && 'page' in raw && raw.page === 'table')
        return tableQuestion?.questionId === questionId ? tableQuestion : undefined
      const binding = snapshot(raw)
      const pending = pendingQuestion(raw, binding)
      return pending?.question.questionId === questionId ? pending.question : undefined
    },
    accepts(binding: QuestionSnapshot, raw: unknown) {
      const fresh = snapshot(raw)
      return !!fresh && binding.owner === fresh.owner && binding.documentId === fresh.documentId && binding.cartVersion === fresh.cartVersion && binding.products.every(product => fresh.products.some(candidate => JSON.stringify(candidate) === JSON.stringify(product)))
    },
    presentProducts(raw: unknown, query: string, request: string, offeredProductRefs?: readonly string[]) {
      if (checkoutProgress)
        checkoutProgress.suspended = true
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
    presentWholeMenu(raw: unknown) {
      const binding = snapshot(raw)
      const { products } = parse(factsSchema, raw)
      if (!binding || !products.length)
        return { ok: false, status: 'rejected', effect: 'none', customerMessage: '目前沒有可核對的完整菜單。' }
      if (products.length > servingLimits.maximum)
        return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: `整張菜單各一份共 ${products.length} 份，機台一次最多可加 ${servingLimits.maximum} 份。請問要選哪些餐點？` }
      const proposals: AdditionProposal[] = []
      for (const product of products) {
        const configuration = product.configurations[0]
        if (product.configurations.length !== 1 || configuration.groups.some(group => group.required))
          return { ok: false, status: 'rejected', effect: 'none', customerMessage: `「${pbProductName(product.name)}」需要先選規格或加料，才能確認整張菜單的總額。` }
        const selection = { version: configuration.version, variantRef: configuration.variantRef, choices: [] }
        const { unitPrice } = resolveSelection(configuration, selection, '')
        proposals.push({ productName: product.name, productRef: product.ref, quantity: 1, unitPrice, selection, note: '', options: [], optionSummary: '' })
      }
      return receipt(questions.presentOrder(binding, proposals, true))
    },
    presentAddition(raw: unknown, inputOrBatch: Record<string, unknown> | Record<string, unknown>[]) {
      const facts = parse(factsSchema, raw)
      const binding = snapshot(raw)
      if (!binding)
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前接待或頁面已變更，尚未建立確認。' }
      try {
        const inputs = Array.isArray(inputOrBatch) ? inputOrBatch : [inputOrBatch]
        const proposals = inputs.map((input): AdditionProposal => {
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
          return { productRef: product.ref, productName: product.name, quantity: Number(input.quantity), unitPrice: selected.unitPrice, note: typeof input.note === 'string' ? input.note : '', optionSummary, options, selection }
        })
        return receipt(Array.isArray(inputOrBatch) ? questions.presentOrder(binding, proposals) : questions.presentAddition(binding, proposals[0]!))
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
      let purpose = input.purpose
      if (purpose === 'submit-order')
        purpose = 'checkout-details'
      else if (['invoice-donation-confirm', 'invoice-tax', 'invoice-tax-confirm'].includes(purpose))
        purpose = 'invoice-details'
      else if (['notification-phone', 'notification-phone-confirm'].includes(purpose))
        purpose = 'notification-details'
      const step = safeParse(pbCheckoutStepSchema, purpose)
      if (step.success && ['invoice-method', 'invoice-details', 'notification-details', 'checkout-details'].includes(step.output))
        checkoutProgress = { owner: binding.owner, documentId: binding.documentId, purpose: step.output, request: input.request, suspended: false }
      else if (checkoutProgress)
        checkoutProgress.suspended = true
      if (phoneDraft?.digits && input.purpose === 'notification-details')
        return receipt(phoneQuestion(binding, input.request, phoneDraft.digits))
      return receipt(questions.presentService(binding, input))
    },
    presentQuantity(raw: unknown, productRef: string, request: string, requestTarget?: string, orderSelection?: true, prefix = '') {
      if (checkoutProgress)
        checkoutProgress.suspended = true
      const binding = snapshot(raw)
      const product = binding?.products.find(product => product.productRef === productRef)
      if (!binding || !product)
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前無法確認這份餐點，請重新選餐。' }
      // Main may ask for a revised count directly, without proposing an oversized add.
      // Retain the reason when the customer's request contains one explicit large serving count.
      const counts = request.replaceAll(product.name, '').normalize('NFKC').match(/[0-9一二兩三四五六七八九十百千萬零〇]+[份碗杯]/g)
      if (!prefix && counts?.length === 1 && (/[百千萬]/.test(counts[0]) || Number.parseInt(counts[0].normalize('NFKC'), 10) > servingLimits.maximum))
        prefix = `機台一次最多可加 ${servingLimits.maximum} 份。`
      return receipt(questions.presentQuantity(binding, product, request, requestTarget, orderSelection, prefix))
    },
    async answer(raw: unknown, transcript: string, observe: () => Promise<unknown>, isCurrent: () => boolean, utteranceId?: number, options: { selectedAnswer?: SelectedBrowserAnswer } = {}) {
      const binding = snapshot(raw)
      const pending = pendingQuestion(raw, binding)
      if (!binding || !pending || !isCurrent())
        return
      const interruption = clarifyPhoneInterruption(raw, transcript, pending)
      if (interruption)
        return { kind: 'receipt' as const, result: interruption }
      if (pending.kind === 'service' && ['notification-phone-confirm', 'submit-order'].includes(pending.purpose)
        && finishedOrdering(transcript)) {
        return { kind: 'receipt' as const, result: receipt(pending.question) }
      }
      const signature = JSON.stringify({ owner: binding.owner, documentId: binding.documentId, cartVersion: binding.cartVersion, purpose: pending.question.purpose, question: pending.question.question, choices: pending.question.choices })
      if (unresolvedQuestion?.signature !== signature)
        unresolvedQuestion = undefined
      const checkout = safeParse(looseObject({ checkout: pbCheckoutSchema }), raw)
      if (pending.kind === 'service' && ['invoice-details', 'invoice-tax', 'invoice-tax-confirm'].includes(pending.purpose) && checkout.success && checkout.output.checkout.methods.some(method => method.method === 'tax' && method.selected)) {
        const input = taxIdInput(transcript)
        if (input) {
          unresolvedQuestion = undefined
          // The bound, expiring ticket is the only fragment buffer. Form edits
          // revoke partial data as well as consent before another reply is read.
          const previous = pending.purpose === 'invoice-tax' ? pending.query ?? '' : ''
          const digits = input.replace ? input.digits : previous + input.digits
          const complete = digits.length === 8
          const invalid = digits.length > 8
          const copy = orderingMessages['zh-Hant'].checkout.taxId
          let message: string
          if (invalid)
            message = copy.invalid
          else if (complete)
            message = copy.confirm.replace('{digits}', digits.split('').join(' '))
          else if (digits)
            message = copy.partial.replace('{digits}', digits.split('').join(' ')).replace('{count}', String(digits.length))
          else
            message = copy.restart
          const question = questions.presentService(binding, {
            purpose: complete ? 'invoice-tax-confirm' : 'invoice-tax',
            query: invalid ? '' : digits,
            request: pending.request,
            question: message,
            choices: complete ? [{ id: 'yes', description: '統編正確，只填入剛才覆誦的八碼統一編號，不送出訂單。' }, { id: 'no', description: '號碼不正確，清除暫存統編，重新報。' }] : [],
          })
          return { kind: 'receipt' as const, result: receipt(question) }
        }
      }
      if (pending.kind === 'service' && ['invoice-details', 'invoice-donation-confirm'].includes(pending.purpose) && checkout.success && checkout.output.checkout.methods.some(method => method.method === 'donation' && method.selected)) {
        const code = donationCodeInput(transcript)
        if (code !== undefined) {
          unresolvedQuestion = undefined
          const valid = /^\d{3,7}$/.test(code)
          const copy = orderingMessages['zh-Hant'].checkout.donationCode
          const question = questions.presentService(binding, { purpose: valid ? 'invoice-donation-confirm' : 'invoice-details', query: valid ? code : undefined, request: pending.request, question: valid ? copy.confirm.replace('{digits}', code.split('').join(' ')) : copy.invalid, choices: valid ? [{ id: 'yes', description: '捐贈碼正確，只填入剛才覆誦的捐贈碼，不送出訂單。' }, { id: 'no', description: '號碼不正確，重新報捐贈碼。' }] : [{ id: 'yes', description: '重新檢查已輸入的捐贈資料，不送單。' }] })
          return { kind: 'receipt' as const, result: receipt(question) }
        }
      }
      if (pending.kind === 'service' && ['notification-details', 'notification-phone', 'notification-phone-confirm'].includes(pending.purpose)) {
        const input = notificationPhoneInput(transcript, phoneDraft?.digits ?? pending.query ?? '')
        if (input) {
          unresolvedQuestion = undefined
          const digits = input.digits
          const invalid = Boolean(digits && !/^0(?:9\d{0,8})?$/.test(digits))
          phoneDraft ??= { owner: binding.owner, digits: '' }
          phoneDraft.digits = invalid ? '' : digits
          const question = phoneDraft.digits
            ? phoneQuestion(binding, pending.request, digits)
            : questions.presentService(binding, { purpose: 'notification-phone', query: '', request: pending.request, question: invalid ? phoneMessages.invalid : phoneMessages.restart, choices: [] })
          return { kind: 'receipt' as const, result: receipt(question) }
        }
      }
      const selectedAnswer = options.selectedAnswer
      if (selectedAnswer && (selectedAnswer.questionId !== pending.question.questionId || !pending.question.choices.some(choice => choice.id === selectedAnswer.choiceId)))
        return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前問題已變更，請依畫面上的問題繼續。' } }
      if (!selectedAnswer && pending.kind === 'product' && pending.orderSelection && /[份碗杯](?:謝謝)?[。！!，,\s]*$/.test(transcript)) {
        const count = quantityAnswerCount(transcript)
        if (count !== undefined) {
          const question = questions.recordProductServings(binding, pending.question.questionId, count, transcript)
          if (question) {
            unresolvedQuestion = undefined
            return { kind: 'receipt' as const, result: receipt(question) }
          }
        }
      }
      if (!selectedAnswer && pending.kind === 'slot') {
        if (pending.slot.kind === 'dumpling-pieces') {
          const observed = await observe()
          const fresh = snapshot(observed)
          if (!fresh || !isCurrent() || questions.pending(fresh)?.question.questionId !== pending.question.questionId)
            return
          if (orders.fill(observed, fresh, pending.slot, transcript)) {
            unresolvedQuestion = undefined
            orderEvidence?.answers.push({ question: pending.question.question, answer: transcript })
            questions.reset()
            return { kind: 'receipt' as const, result: nextOrder(observed, fresh)! }
          }
        }
        const count = orderSlotCount(transcript, pending.slot)
        if (count !== undefined) {
          const observed = await observe()
          const fresh = snapshot(observed)
          if (!fresh || !isCurrent())
            return
          const slot = questions.consumeSlotNumber(pending.question.questionId, count, fresh)
          if (slot && orders.fill(observed, fresh, slot, count)) {
            unresolvedQuestion = undefined
            orderEvidence?.answers.push({ question: pending.question.question, answer: transcript })
            return { kind: 'receipt' as const, result: nextOrder(observed, fresh)! }
          }
          orders.reset()
          return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '餐點或購物車狀態已變更，請重新確認。' } }
        }
      }
      if (!selectedAnswer && pending.kind === 'quantity') {
        const dumplings = dumplingAnswer(raw, pending, transcript)
        if (dumplings) {
          const observed = await observe()
          const fresh = snapshot(observed)
          if (!fresh || !isCurrent() || questions.pending(fresh)?.question.questionId !== pending.question.questionId)
            return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '餐點或購物車狀態已變更，請重新確認。' } }
          try {
            unresolvedQuestion = undefined
            orders.collect(observed, fresh, { lines: dumplings.map(serving => ({ productRef: pending.product.productRef, evidence: serving.evidence, quantity: serving.quantity, choices: [], askGroups: [], note: '' })) }, pending.request, { productRef: pending.product.productRef, answer: transcript })
            orderEvidence = { request: pending.request, answers: [{ question: pending.question.question, answer: transcript }] }
            questions.reset()
            return { kind: 'receipt' as const, result: nextOrder(observed, fresh)! }
          }
          catch (error) {
            return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前無法確認這份水餃的顆數與配置，請重新確認。', explanation: errorMessageFrom(error) } }
          }
        }
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
          unresolvedQuestion = undefined
          answeredUtteranceId = utteranceId
          answeredQuestion = { question: pending.question.question, answer: transcript, name: selected.product.name, purpose: pending.question.purpose, originalRequest: selected.request }
          if (utteranceId !== undefined)
            acceptedSelection = { utteranceId, expiresAt: pending.question.expiresAt, binding: fresh, selection: { productRef: selected.product.productRef, request: selected.request, requestTarget: selected.requestTarget, requestedQuantity: selected.quantity, orderSelection: selected.orderSelection }, evidence: { request: selected.request, answers: [{ question: pending.question.question, answer: transcript }] } }
          return { kind: 'product' as const, product: selected.product, request: selected.request, requestTarget: selected.requestTarget, requestedQuantity: selected.quantity, orderSelection: selected.orderSelection, binding: fresh }
        }
      }
      const literal = literalChoice(pending, transcript) ?? (pending.kind === 'service' && pending.purpose === 'purchase-recommendation' && purchaseAnswerCount(transcript) !== undefined ? 'yes' : browserQuestionChoice(transcript, pending.question))
      const decision: AnswerDecision = selectedAnswer ? { kind: 'ANSWER', choiceId: selectedAnswer.choiceId, provider: 'system-one' } : literal ? { kind: 'ANSWER', choiceId: literal, provider: 'main' } : await io.answer({ decisionSource: 'main', questionId: pending.question.questionId, transcript, cartContext: parse(factsSchema, raw).cart }).catch((): AnswerDecision => ({ kind: 'UNCERTAIN', provider: 'unavailable' }))
      // Re-observe after model IO: a touch, new price, reload or customer switch
      // during that wait invalidates the original question instead of rebinding it.
      const observed = await observe()
      const fresh = snapshot(observed)
      if (!fresh || !isCurrent() || questions.pending(fresh)?.question.questionId !== pending.question.questionId)
        return { kind: 'receipt' as const, result: { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '餐點或購物車狀態已變更，請重新確認。' } }
      if (decision.kind === 'NEW_REQUEST') {
        releaseQuestion()
        return pending.kind === 'addition' ? { kind: 'new-request' as const, previousProposal: pending.proposal } : undefined
      }
      if (decision.kind !== 'ANSWER' || !decision.choiceId || !pending.question.choices.some(choice => choice.id === decision.choiceId)) {
        const sameUtterance = utteranceId !== undefined && unresolvedQuestion?.utteranceId === utteranceId
        const attempts = (unresolvedQuestion?.attempts ?? 0) + (sameUtterance ? 0 : 1)
        unresolvedQuestion = { signature, attempts, utteranceId }
        if (attempts >= 2) {
          const checkoutQuestion = pending.kind === 'service' && (
            safeParse(pbCheckoutStepSchema, pending.purpose).success || pending.purpose.startsWith('invoice-')
          )
          const customerMessage = checkoutQuestion ? orderingMessages['zh-Hant'].nextStep.resumeCheckout : menuNextStep(observed)
          releaseQuestion()
          return { kind: 'receipt' as const, result: { ok: true, source: 'browser', status: 'clarification', code: 'QUESTION_RETRY_LIMIT', effect: 'none', customerMessage } }
        }
        return { kind: 'receipt' as const, result: { ...receipt(pending.question), customerMessage: pending.question.question } }
      }
      unresolvedQuestion = undefined
      const selected = questions.consume(pending.question.questionId, decision.choiceId, fresh)
      if (selected.kind === 'service') {
        answeredUtteranceId = utteranceId
        answeredQuestion = { question: selected.question, answer: transcript, selectedChoice: selected.answer, name: selected.name, purpose: selected.purpose }
        if (selected.purpose === 'undo-cart-increase') {
          const change = lastIncrease
          lastIncrease = undefined
          if (selected.choiceId === 'yes' && change && change.owner === fresh.owner && change.documentId === fresh.documentId && change.version === fresh.cartVersion)
            return { kind: 'undo-increase' as const, change }
          return { kind: 'receipt' as const, result: { ok: true, effect: 'none', customerMessage: '保留目前購物車的餐點。' } }
        }
        if (selected.purpose === 'invoice-tax-confirm') {
          if (selected.choiceId === 'yes' && selected.query && /^\d{8}$/.test(selected.query))
            return { kind: 'checkout' as const, action: 'tax-confirmed' as const, code: selected.query }
          const question = questions.presentService(fresh, { purpose: 'invoice-tax', query: '', request: selected.request, question: orderingMessages['zh-Hant'].checkout.taxId.restart, choices: [] })
          return { kind: 'receipt' as const, result: receipt(question) }
        }
        if (selected.purpose === 'invoice-donation-confirm') {
          if (selected.choiceId === 'yes' && selected.query && /^\d{3,7}$/.test(selected.query))
            return { kind: 'checkout' as const, action: 'donation-confirmed' as const, code: selected.query }
          const question = questions.presentService(fresh, { purpose: 'invoice-details', request: selected.request, question: orderingMessages['zh-Hant'].checkout.donationCode.introduction, choices: [{ id: 'yes', description: '重新檢查已輸入的捐贈資料，不送單。' }] })
          return { kind: 'receipt' as const, result: receipt(question) }
        }
        if (selected.purpose === 'notification-phone-confirm') {
          if (selected.choiceId === 'yes' && selected.query && /^09\d{8}$/.test(selected.query))
            return { kind: 'checkout' as const, action: 'phone-confirmed' as const, phone: selected.query }
          if (phoneDraft)
            phoneDraft.digits = ''
          const question = questions.presentService(fresh, { purpose: 'notification-phone', query: '', request: selected.request, question: phoneMessages.restart, choices: [] })
          return { kind: 'receipt' as const, result: receipt(question) }
        }
        if (selected.purpose === 'cancel-and-search' && selected.choiceId === 'yes') {
          orders.reset()
          return { kind: 'switch-query' as const, query: selected.query ?? '' }
        }
        if (selected.purpose === 'review-checkout' && selected.choiceId === 'yes')
          return { kind: 'review-cart' as const }
        if (selected.purpose === 'cart-review' && selected.choiceId === 'yes')
          return { kind: 'checkout' as const, action: 'invoice-options' as const }
        if (selected.purpose === 'cart-review' && selected.choiceId === 'no')
          return { kind: 'receipt' as const, result: { ok: true, source: 'browser', effect: 'none', customerMessage: orderingMessages['zh-Hant'].nextStep.cartReviewDeclined } }
        if (selected.purpose === 'invoice-method')
          return { kind: 'checkout' as const, action: 'invoice' as const, method: selected.choiceId }
        if (checkoutEntryPurposes.has(selected.purpose)) {
          if (selected.choiceId === 'yes')
            return { kind: 'checkout' as const, action: 'continue' as const }
          // "Not yet" keeps the current entry step answerable by a later OK.
          const question = questions.presentService(fresh, { purpose: selected.purpose, request: selected.request, question: pending.question.question, choices: pending.question.choices })
          return { kind: 'receipt' as const, result: { ...receipt(question), customerMessage: '好的，請慢慢填寫，完成後告訴我。' } }
        }
        if (selected.purpose === 'submit-order' && selected.choiceId === 'yes' && selected.query) {
          if (checkoutProgress)
            checkoutProgress.suspended = true
          return { kind: 'checkout' as const, action: 'submit' as const, confirmationToken: selected.query }
        }
        if (selected.purpose === 'submit-order' && selected.choiceId === 'no') {
          checkoutProgress = undefined
          return { kind: 'receipt' as const, result: { ok: true, source: 'browser', effect: 'none', customerMessage: orderingMessages['zh-Hant'].nextStep.submissionDeclined } }
        }
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
        if (selected.choiceId === 'no' && !restored) {
          if (selected.purpose === 'purchase-recommendation')
            return { kind: 'cancel-selection' as const, excludedRefs: selectionRefs(pending) }
          if (selected.purpose === 'review-checkout')
            return { kind: 'continue-browsing' as const }
        }
        if (selected.choiceId === 'no')
          return { kind: 'receipt' as const, result: restored ? receipt(restored.question) : { ok: true, source: 'browser', effect: 'none', customerMessage: menuNextStep(observed) } }
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
      if (selected.kind === 'cancelled') {
        const excludedRefs = selectionRefs(pending)
        orders.reset()
        return { kind: 'cancel-selection' as const, excludedRefs }
      }
      if (selected.kind === 'product' && pending.kind === 'product') {
        const request = pending.servingAnswer ? `${pending.request}\n${pending.servingAnswer.transcript}` : pending.request
        return { kind: 'product' as const, product: selected.product, request, requestTarget: pending.query, requestedQuantity: pending.servingAnswer?.quantity, orderSelection: pending.orderSelection, completePurchase: literal ? completePurchase(observed, pending.request, selected.product.productRef) : undefined, binding: fresh }
      }
      if (selected.kind === 'addition')
        return { kind: 'addition' as const, proposal: selected.proposal, binding: fresh }
      if (selected.kind === 'page')
        return { kind: 'receipt' as const, result: receipt(questions.presentProducts(fresh, selected.products, selected.request, selected.page, selected.query, pending.kind === 'product' ? pending.orderSelection : undefined, pending.kind === 'product' ? pending.servingAnswer : undefined)) }
      return { kind: 'receipt' as const, result: { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '這個問題已失效，請重新確認。' } }
    },
  }
}
