import type { ContextReply, ConversationContext, ConversationHandoff, ConversationQuestion as PresentedQuestion, ServiceClarification } from '@proj-airi/stage-shared/kiosk-conversation'

import type { KioskDecisionState, KioskInteractionDecision } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { ConversationTurnResult } from '../composables/useKioskInteractionRecording'

import { customerReplySchema, formatOrderingPrice, isServiceLimitationReply, quantityLimitRejectionSchema, renderCustomerReply, replyFromContext, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { safeParse } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

/**
 * Menu facts are rendered from this turn's read receipts, never generated prose.
 * Keep all distinct lookup results: a second lookup may be a comparison, not a
 * replacement recommendation. The Agent still selects queries and operations.
 */
export function createMenuReplyWindow() {
  const messages = new Map<string, { facts: string, guidance: boolean, nextQuestion?: string, itemIds: string[], pricedItemIds: string[], missingQueries: string[], namedAbsence: boolean }>()
  const items = new Map<string, { name: string, price: number }>()
  const operations = new Set<string>()
  const outcomes: string[] = []
  const additionOutcomes = new Set<string>()
  const addedLines = new Map<string, { itemId: string, name: string, quantity: number }>()
  const unmatchedQueries = new Set<string>()
  let reads = 0
  let cartReply: string | undefined
  let clarificationRequested = false
  return {
    record(name: string, result: unknown) {
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result)
        }
        catch { return }
      }
      if (!result || typeof result !== 'object')
        return
      const payload = result as Record<string, unknown>
      if (payload.ok === false || payload.dataOnly === true)
        return
      if (payload.guidance && (payload.queryAction === 'clarify' || payload.matchKind === 'possible'))
        clarificationRequested = true
      const question = questionReceiptFrom(payload)
      const waiting = ['item-configuration', 'confirm-meal', 'item-clarification', 'menu-query-scope'].includes(question?.purpose ?? '')
      if (typeof payload.customerMessage === 'string' && !waiting)
        operations.add(name)
      if (!['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(name)) {
        // A successful cart mutation supersedes any earlier displayed snapshot
        // in this turn. Its old quantities/prices cannot accompany the new receipt.
        if (payload.cart && typeof payload.cart === 'object')
          cartReply = undefined
        const message = operationReplyFrom(payload)
        // Only the current question may be spoken. Earlier operation receipts
        // remain, but their superseded follow-up prompts cannot be revived.
        const outcome = question && message ? message.replace(question.question, '').trim() : message
        if (outcome && !waiting) {
          outcomes.push(outcome)
          if (['order_add_item', 'cart_add_item'].includes(name) && !payload.replacedLine && payload.line && typeof payload.line === 'object') {
            const line = payload.line as Record<string, unknown>
            if (typeof line.id === 'string' && typeof line.itemId === 'string' && typeof line.name === 'string' && typeof line.quantity === 'number') {
              additionOutcomes.add(outcome)
              addedLines.set(line.id, { itemId: line.itemId, name: line.name, quantity: line.quantity })
              if (typeof line.unitPrice === 'number' && Number.isFinite(line.unitPrice) && line.unitPrice >= 0)
                items.set(line.itemId, { name: line.name, price: line.unitPrice })
            }
          }
        }
      }
      if (!['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get'].includes(name))
        return
      // An internal catalog lookup supplies evidence to the Agent, not dishes
      // to announce alongside the later filtered recommendation.
      if (name === 'menu_get' && payload.dataOnly === true)
        return
      if (name === 'cart_get') {
        // Cart inspection is a separate read. It may answer an order-summary
        // request, but must not replace menu evidence gathered for comparison.
        if (payload.cart && typeof payload.cart === 'object') {
          const cart = payload.cart as Record<string, unknown>
          if (Array.isArray(cart.lines) && typeof cart.total === 'number' && Number.isFinite(cart.total)) {
            const lines: string[] = []
            for (const value of cart.lines) {
              if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' && 'quantity' in value && typeof value.quantity === 'number')
                lines.push(`${value.name} ${value.quantity} 份`)
            }
            cartReply = lines.length ? `目前訂單：${lines.join('、')}。合計 ${cart.total}元。` : '購物車目前沒有餐點。'
          }
        }
        return
      }
      if (!Array.isArray(payload.items))
        return
      reads++
      // Empty filtered results and possible aliases are not evidence of absence.
      if (name === 'menu_get' && payload.matchKind === 'none' && payload.items.length === 0 && Array.isArray(payload.requestedQueries)) {
        for (const query of payload.requestedQueries) {
          if (typeof query === 'string' && query.trim())
            unmatchedQueries.add(query)
        }
      }
      const names: string[] = []
      const itemIds: string[] = []
      for (const raw of payload.items) {
        if (!raw || typeof raw !== 'object')
          continue
        const item = raw as Record<string, unknown>
        if (typeof item.id !== 'string' || typeof item.name !== 'string' || item.available === false)
          continue
        names.push(item.name)
        itemIds.push(item.id)
        if (typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0)
          items.set(item.id, { name: item.name, price: item.price })
      }
      // Only a successful, displayed, named Menu lookup can prove absence.
      // Empty filters, rejected calls and free-form model prose cannot.
      const missingQueries = Array.isArray(payload.missingQueries) ? payload.missingQueries.filter((query): query is string => typeof query === 'string') : []
      const requestedQueries = Array.isArray(payload.requestedQueries) ? payload.requestedQueries.filter((query): query is string => typeof query === 'string' && Boolean(query.trim())) : []
      const namedAbsence = name === 'menu_get' && requestedQueries.length > 0
        && ((payload.items.length === 0 && ['none', 'possible'].includes(String(payload.matchKind)))
          || missingQueries.some(query => requestedQueries.includes(query)))
      const structured = safeParse(customerReplySchema, payload.customerReply)
      if (structured.success) {
        const reply = structured.output
        messages.set(name === 'menu_get' ? reply.queryKey ?? reply.facts : 'recommendation', { facts: reply.facts, guidance: Boolean(payload.guidance), nextQuestion: reply.nextQuestion, itemIds, pricedItemIds: reply.pricedItemIds ?? [], missingQueries, namedAbsence: Boolean(namedAbsence && reply.facts.trim()) })
      }
      else {
        const message = operationReplyFrom(payload) ?? (names.length ? `我查到：${names.slice(0, 3).join('、')}。` : '目前沒有查到符合條件的餐點。')
        messages.set(message, { facts: message, guidance: Boolean(payload.guidance), itemIds, pricedItemIds: [], missingQueries, namedAbsence: false })
      }
    },
    hasUnmatchedQuery(sourceUtterance: string) {
      // This exception is for a single original meal, not an unrelated lookup
      // or a partially handled multi-meal request. No generated prose is used.
      return reads === 1 && unmatchedQueries.size === 1 && [...unmatchedQueries].every(query => sourceUtterance.includes(query))
    },
    hasNamedAbsence: () => [...messages.values()].some(reply => reply.namedAbsence),
    hasOperation(intent: string) {
      const tools: Record<string, string[]> = {
        ADD_ONLY: ['order_add_item', 'cart_add_item'],
        ADD_ITEM: ['order_add_item', 'cart_add_item'],
        RETURN_MENU: ['menu_open'],
        REMOVE_ITEM: ['cart_remove_item'],
        SET_QUANTITY: ['cart_set_line_quantity', 'menu_set_quantity'],
        SET_OPTION: ['cart_set_line_option', 'menu_set_item_option'],
        CLEAR_CART: ['cart_clear'],
        SET_FULFILLMENT: ['order_set_fulfillment'],
        START_CHECKOUT: ['checkout_start'],
        SELECT_PAYMENT: ['checkout_select_payment'],
        CANCEL_CHECKOUT: ['checkout_cancel'],
      }
      return tools[intent]?.some(name => operations.has(name)) === true
    },
    operationReply(fallback?: string) {
      if (!outcomes.length)
        return fallback
      if (outcomes.length > 1 && outcomes.every(outcome => additionOutcomes.has(outcome)))
        return orderingMessages['zh-Hant'].addedItemsSummary.replace('{items}', [...addedLines.values()].map(line => `${line.name}共${line.quantity}份`).join('、'))
      return outcomes.join(' ')
    },
    hasReceipts: () => reads > 0 || cartReply !== undefined,
    hasCartReview: () => cartReply !== undefined,
    needsClarification: () => clarificationRequested,
    reply(options: { omitGuidance?: boolean, omitPurchasedItems?: boolean, priceInquiry?: boolean } = {}) {
      const purchased = new Set([...addedLines.values()].map(line => line.itemId))
      // Same-item availability is evidence for the write, not a second customer
      // result. Preserve structured missing subjects and explicit price inquiries.
      const redundantReads = options.omitPurchasedItems ? [...messages.values()].filter(reply => reply.itemIds.length > 0 && reply.itemIds.every(id => purchased.has(id))) : []
      const omitted = new Set(redundantReads)
      const missing = [...new Set(redundantReads.flatMap(reply => reply.missingQueries))]
      const missingFacts = missing.length ? orderingMessages['zh-Hant'].missingMenuSubjects.replace('{items}', missing.map(query => `「${query}」`).join('、')) : ''
      const requestedPrices = options.priceInquiry ? [...items].filter(([id]) => purchased.has(id)).map(([_id, item]) => `${item.name}單份${formatOrderingPrice(item.price)}。`).join('') : ''
      // A direct add can answer an explicit unit-price question from its real
      // line receipt, without forcing another lookup/model round.
      if (!reads)
        return cartReply ?? (options.omitPurchasedItems ? requestedPrices : '目前沒有可驗證的餐點查詢結果，請告訴我想找的餐點或條件，或使用畫面選餐。')
      const scopedReplies = [...messages.values()].filter(reply => !omitted.has(reply) && (!options.omitGuidance || !reply.guidance))
      const replies = [...new Map(scopedReplies.map(reply => [reply.facts || reply.nextQuestion, reply])).values()]
      const currentItems = new Set(replies.flatMap(reply => reply.itemIds))
      const pricedItems = new Set(replies.flatMap(reply => reply.pricedItemIds))
      const missingPrices = [...items].filter(([id]) => currentItems.has(id) && !pricedItems.has(id))
      const prices = replies.length > 1 && currentItems.size > 1 && missingPrices.length
        ? ` 單份基本售價：${missingPrices.slice(0, 6).map(([_id, item]) => `${item.name} ${item.price}元`).join('、')}。`
        : ''
      const nextQuestion = !options.omitGuidance && replies.some(reply => reply.nextQuestion)
        ? replies.length > 1 ? orderingMessages['zh-Hant'].browseQuestion : replies[0]?.nextQuestion
        : undefined
      return renderCustomerReply({ facts: [replies.map(reply => reply.facts).filter(Boolean).join(' '), prices.trim(), missingFacts, requestedPrices].filter(Boolean).join(' '), nextQuestion })
    },
  }
}

/**
 * Resolves one Agent task for display: classified service prose stays natural, while
 * commerce attempts use current-turn receipts even if the model claims success.
 * Transport failures without receipts are errors, never a fabricated menu reply.
 */
export function replyFromConversation(result: ConversationTurnResult, options: {
  menu: ReturnType<typeof createMenuReplyWindow>
  outcome?: string
  question?: PresentedQuestion
  failureMessage: string
  requireMenuRead?: boolean
  /** An independently qualified price question must survive an accompanying write. */
  priceInquiry?: boolean
  /** Only a classified service FAQ may use generated prose without an operation receipt. */
  serviceReply?: boolean
  handoff?: Pick<ConversationHandoff, 'intent'> & Partial<Pick<ConversationHandoff, 'status'>>
  /** Original customer turn used to correlate a named absence receipt. */
  sourceUtterance?: string
  /** Fresh snapshot read after the model/tool loop; never a historical context. */
  context?: ConversationContext
  /** Fresh host phase; invalid ordering must not be narrated as an empty menu. */
  customerEntry?: { phase: KioskDecisionState['phase'] | undefined, prompt: string }
}): { role: 'assistant' | 'error', content: string, clarification?: true, kind?: ContextReply['kind'] } {
  // Entry must still be complete when the reply arrives: a session reset
  // cannot expose an earlier menu receipt or let a stale task bypass phone choice.
  const entryRequired = result.requestedTools.some(name => name !== 'kiosk_session_history')
  if (options.customerEntry?.phase === 'customer_entry' && (entryRequired || options.requireMenuRead))
    return { role: 'assistant' as const, content: options.customerEntry.prompt }
  const rejection = safeParse(quantityLimitRejectionSchema, result.rejection)
  if (rejection.success) {
    const assistance = orderAssistanceFromRejection(rejection.output, options.sourceUtterance ?? '', options.context)
    return { role: 'assistant', content: [options.menu.operationReply(), assistance?.question ?? rejection.output.customerMessage].filter(Boolean).join(' ') }
  }
  const quantityAssistance = quantityAssistanceFromConversation(result, options.sourceUtterance ?? '', options.context)
  if (quantityAssistance)
    return { role: 'assistant', content: [options.menu.operationReply(), quantityAssistance.question].filter(Boolean).join(' ') }
  if (result.status === 'completed' && result.reply?.kind === 'staff-assistance' && options.context
    && result.requestedTools.every(name => ['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get', 'kiosk_session_history'].includes(name))) {
    // A validated service limitation can finish after evidence reads without
    // claiming an ADD_ITEM effect. It must survive the commerce-completion guard.
    const assistance = replyFromContext(JSON.stringify(result.reply), options.context)
    if (assistance)
      return { role: 'assistant', kind: assistance.kind, content: assistance.content }
  }
  if (result.status === 'completed' && result.reply?.kind === 'quantity-limit' && options.context) {
    const policy = replyFromContext(JSON.stringify(result.reply), options.context)
    if (policy)
      return { role: 'assistant', content: [options.menu.operationReply(), policy.content].filter(Boolean).join(' ') }
  }
  // A history lookup supplies conversation context, not a new commerce result.
  const commerceAttempted = result.requestedTools.some(name => name !== 'kiosk_session_history')
  // A completed no-tool draft cannot establish facts or operation success.
  // With fresh context we can still ask for meaning in the character's voice.
  // Never take this path after an attempted operation or a transport failure:
  // those need their actual receipt/result-unknown policy, not a new question.
  const clarification = result.status === 'completed' && !commerceAttempted && options.context
    ? replyFromContext('{"kind":"clarification"}', options.context)
    : undefined
  const unresolved = clarification
    ? { role: 'assistant' as const, content: clarification.content, clarification: true as const }
    : { role: 'error' as const, content: options.failureMessage }
  // A true menu receipt cannot complete a known mutation task. Preserve the
  // requested effect even when Main chooses a factual but unrelated lookup.
  const intent = options.handoff?.intent ?? ''
  const operationRequired = ['ADD_ITEM', 'REMOVE_ITEM', 'SET_QUANTITY', 'SET_OPTION', 'CLEAR_CART', 'SET_FULFILLMENT', 'START_CHECKOUT', 'SELECT_PAYMENT', 'CANCEL_CHECKOUT', 'RETURN_MENU', 'ADD_ONLY'].includes(intent)
  // The loop result is diagnostic; only the final Menu-validated question
  // supplied by the Host may be presented after release/manual state changes.
  const question = options.question
  const configuringMeal = ['ADD_ITEM', 'ADD_ONLY', 'SET_OPTION', 'SET_QUANTITY'].includes(intent) && ['item-configuration', 'confirm-meal'].includes(question?.purpose ?? '')
  // Main's generic clarification cannot erase an explicit named absence from
  // this completed read-only turn. Keep its receipt provenance too: otherwise
  // Host would display the facts but create a new unrelated clarification cue.
  if (result.status === 'completed' && result.reply?.kind === 'clarification' && !operationRequired && options.menu.hasNamedAbsence()
    && result.requestedTools.every(name => ['kiosk_session_history', 'menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(name))) {
    return { role: 'assistant', kind: 'menu-information', content: options.menu.reply({ omitGuidance: Boolean(question) }) }
  }
  // Clarification pauses an unexecuted demand; it never completes the mutation
  // or consumes an old confirmation. Reads may precede a clarification; attempted
  // writes still require their actual receipt or result-unknown policy.
  if (result.status === 'completed' && result.reply?.kind === 'clarification' && (!options.menu.hasCartReview() || (operationRequired && !options.menu.hasOperation(intent))) && result.requestedTools.every(name => ['kiosk_session_history', 'menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(name)) && options.context) {
    const clarification = replyFromContext(JSON.stringify(result.reply), options.context)
    if (clarification)
      return { role: 'assistant' as const, content: clarification.content }
  }
  // A verified absence answers an unmatched add without claiming a cart write.
  // An owned return-menu question also pauses an unmatched add after a real
  // absence receipt. It is not a failed mutation or proof of a cart write.
  const unmatchedAdd = (result.status === 'completed' || (result.status === 'waiting' && question?.purpose === 'menu-return-invitation'))
    && ((intent === 'ADD_ITEM' && options.handoff?.status === 'unmatched') || intent === 'ADD_ONLY')
    && result.requestedTools.every(name => ['menu_get', 'kiosk_session_history'].includes(name))
    && options.menu.hasUnmatchedQuery(options.sourceUtterance ?? '')
  if (operationRequired && !options.menu.hasOperation(intent) && !configuringMeal && !unmatchedAdd) {
    const accepted = options.menu.operationReply()
    return accepted ? { role: 'assistant', content: `${accepted} ${options.failureMessage}` } : unresolved
  }
  // A later owned question supersedes earlier browse/fuzzy prompts, while
  // independent factual read receipts remain available for compound requests.
  const readReply = (options.menu.hasReceipts() || (options.priceInquiry && options.menu.hasOperation('ADD_ITEM'))) ? options.menu.reply({ omitGuidance: Boolean(question) || options.menu.hasOperation(intent), omitPurchasedItems: options.menu.hasOperation('ADD_ITEM'), priceInquiry: options.priceInquiry }) : ''
  const acceptedOperations = options.menu.operationReply()
  // The callback fallback can still contain a previous lookup's browse prompt.
  // Prefer the structured read with superseded questions removed; only actual
  // accepted operation receipts may precede it. Raw fallback is last resort.
  const outcome = acceptedOperations
    ? [acceptedOperations, readReply].filter(Boolean).join(' ')
    : readReply || options.outcome
  const receiptReply = replyFromOperation(readReply, outcome, question)
  if (result.status === 'waiting')
    return question && receiptReply ? { role: 'assistant', content: receiptReply } : { role: 'error', content: options.failureMessage }
  if (result.status !== 'completed') {
    return receiptReply
      ? { role: 'assistant' as const, content: `${receiptReply} ${options.failureMessage}` }
      : { role: 'error' as const, content: options.failureMessage }
  }
  const onlyEvidenceReads = result.requestedTools.every(name => ['kiosk_session_history', 'cart_get', 'menu_get', 'menu_recommend', 'menu_show_recommendations', 'seating_get'].includes(name))
  if (!receiptReply && onlyEvidenceReads && options.context) {
    const information = replyFromContext(result.reply ? JSON.stringify(result.reply) : result.answer, options.context)
    // A display-required request still needs a presentation receipt. Only an
    // application-owned clarification or limitation may stop without claiming a menu result.
    if (information && (!options.requireMenuRead || information.kind === 'clarification' || isServiceLimitationReply(information)))
      return { role: 'assistant' as const, content: information.content, ...(information.kind === 'staff-assistance' ? { kind: information.kind } : {}) }
  }
  if (options.requireMenuRead && !receiptReply)
    return unresolved
  // A completed typed service selection with no attempted operation may
  // need clarification, but has no uncertain order effect to lock the screen.
  if (!receiptReply && !commerceAttempted && ((!options.requireMenuRead && !options.serviceReply) || Boolean(options.context && result.reply)))
    return unresolved
  if (!receiptReply && (commerceAttempted || options.requireMenuRead) && !options.menu.hasReceipts())
    return unresolved
  const content = receiptReply || (commerceAttempted || options.requireMenuRead ? options.menu.reply() : result.answer)
  return content ? { role: 'assistant' as const, content, ...(!question && options.menu.needsClarification() ? { clarification: true as const } : {}) } : { role: 'error' as const, content: options.failureMessage }
}

/** Retains host invitations and the exact passive question displaced by their presentation. */
export function createInvitationWindow() {
  let pending: PresentedQuestion | undefined
  let displacedQuestionId: string | undefined
  const records = new Map<string, { question: PresentedQuestion, status: 'pending' | 'answered' | 'superseded' }>()
  return {
    present(question: PresentedQuestion, previousQuestionId?: string) {
      if (!['recommendation-invitation', 'menu-return-invitation'].includes(question.purpose))
        return
      if (pending)
        records.set(pending.questionId, { question: pending, status: 'superseded' })
      pending = question
      displacedQuestionId = previousQuestionId
      records.set(question.questionId, { question, status: 'pending' })
    },
    decisionState(state: KioskDecisionState | undefined, now: number) {
      const previous = state?.waitingFor
      // Only the exact older passive navigation question may be displaced.
      // A newly presented question, unfinished meal or operation confirmation wins.
      const displaced = previous && previous.questionId === displacedQuestionId && ['cart-review', 'checkout-entry'].includes(previous.purpose)
      if (!state || state.phase !== 'ordering' || (previous && !displaced) || state.serviceClarification || state.activeRequest || !pending)
        return state
      // Idle expires a per-decision answer ticket, not the unanswered invitation.
      return {
        ...state,
        waitingFor: { ...pending, expiresAt: now + 30000 },
        // The Host owns this read-only invitation. Carry its answer scope into
        // the existing Main fallback too, so a weak Jev result cannot lose the
        // latest question and revert to an older product lookup.
        intentRecovery: { kind: 'answer' as const, questionId: pending.questionId, candidateIds: pending.choices.map(choice => choice.id) },
      }
    },
    resolve(decision: Pick<KioskInteractionDecision, 'answeredQuestionId' | 'supersededQuestionId'>) {
      if (!pending)
        return
      let status: 'answered' | 'superseded'
      if (decision.answeredQuestionId === pending.questionId)
        status = 'answered'
      else if (decision.supersededQuestionId === pending.questionId)
        status = 'superseded'
      else
        return // A stale decision cannot consume a newer invitation.
      records.set(pending.questionId, { question: pending, status })
      pending = undefined
      displacedQuestionId = undefined
    },
    /** A newer service question retires this navigation invitation without erasing history. */
    supersede() {
      if (pending)
        records.set(pending.questionId, { question: pending, status: 'superseded' })
      pending = undefined
      displacedQuestionId = undefined
    },
    history: () => [...records.values()],
    reset() {
      pending = undefined
      displacedQuestionId = undefined
      records.clear()
    },
  }
}

/** Sanitizes a service-owned question receipt without inferring an intent from prose. */
export function presentedQuestionFrom(value: unknown): PresentedQuestion | undefined {
  if (!value || typeof value !== 'object')
    return undefined
  const question = value as Record<string, unknown>
  if (typeof question.questionId !== 'string' || typeof question.purpose !== 'string' || typeof question.question !== 'string' || typeof question.expiresAt !== 'number' || !Array.isArray(question.choices))
    return undefined
  const choices: PresentedQuestion['choices'] = []
  for (const value of question.choices) {
    if (!value || typeof value !== 'object')
      return undefined
    const choice = value as Record<string, unknown>
    if (typeof choice.id !== 'string' || typeof choice.description !== 'string')
      return undefined
    choices.push({ id: choice.id, description: choice.description })
  }
  return { questionId: question.questionId, ...(typeof question.requestId === 'string' ? { requestId: question.requestId } : {}), purpose: question.purpose, question: question.question, expiresAt: question.expiresAt, choices }
}

/** Ensures the correlated question is visible; text matching only avoids duplicate rendering. */
export function replyWithQuestion(answer: string, question: PresentedQuestion | undefined, phase?: string) {
  if (question)
    return answer.includes(question.question) ? answer : `${answer} ${question.question}`.trim()
  // Open guidance never grants consent. Locked/payment/completed states must
  // not acquire a new ordering question merely because prose lacks a question.
  if (phase === 'ordering' && !/[?？]/.test(answer))
    return `${answer} ${orderingMessages['zh-Hant'].nextOrderQuestion}`.trim()
  return answer
}

/** Uses tool-owned outcomes/questions instead of a second Agent-written operation dialogue. */
export function replyFromOperation(answer: string, outcome: string | undefined, question: PresentedQuestion | undefined) {
  return outcome || question ? replyWithQuestion(outcome ?? '', question) : answer
}

/** Reads only the explicit customer outcome, never status guesses or free Agent prose. */
export function operationReplyFrom(result: unknown): string | undefined {
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result)
    }
    catch {
      return undefined
    }
  }
  if (!result || typeof result !== 'object')
    return undefined
  // Internal reads may carry customerMessage as model evidence. They do not
  // acknowledge a displayed result and must not replace a visible receipt.
  if ('dataOnly' in result && result.dataOnly === true)
    return undefined
  const message = (result as Record<string, unknown>).customerMessage
  return typeof message === 'string' && message.trim() ? message : undefined
}

/** A proven quantity refusal invites optional staff help, never an order retry or a fault lock. */
export function orderAssistanceFromRejection(result: unknown, sourceUtterance: string, state: Parameters<typeof serviceContextKey>[0] | undefined, uncertain = false): ServiceClarification | undefined {
  const rejection = safeParse(quantityLimitRejectionSchema, result)
  if (uncertain || !state || !rejection.success)
    return undefined
  return { purpose: 'staff-assistance', questionId: crypto.randomUUID(), question: orderingMessages['zh-Hant'].quantityAssistance.replace('{maximum}', String(rejection.output.maximum)), sourceUtterance, contextKey: serviceContextKey(state), expiresAt: Date.now() + 30_000 }
}

/** A typed quantity-policy reply after evidence reads may offer help without inventing a tool refusal. */
export function quantityAssistanceFromConversation(result: ConversationTurnResult, sourceUtterance: string, context: ConversationContext | undefined): ServiceClarification | undefined {
  const rejected = orderAssistanceFromRejection(result.rejection, sourceUtterance, context)
  if (rejected)
    return rejected
  if (!context?.quantityPolicy || result.status !== 'completed' || result.reply?.kind !== 'quantity-limit'
    || !result.requestedTools.every(name => ['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get', 'kiosk_session_history'].includes(name))) {
    return undefined
  }
  return { purpose: 'staff-assistance', questionId: crypto.randomUUID(), question: orderingMessages['zh-Hant'].quantityAssistance.replace('{maximum}', String(context.quantityPolicy.maximum)), sourceUtterance, contextKey: serviceContextKey(context), expiresAt: Date.now() + 30_000 }
}

/** Presents only service-owned business refusals whose effects are known not to have executed. */
export function operationRejectionMessage(result: unknown, uncertain = false): string | undefined {
  if (uncertain)
    return
  const limit = safeParse(quantityLimitRejectionSchema, result)
  if (limit.success)
    return limit.output.customerMessage
  if (result && typeof result === 'object' && 'rejection' in result && result.rejection === 'item-selection' && 'customerMessage' in result && typeof result.customerMessage === 'string')
    return result.customerMessage.trim().slice(0, 2000) || undefined
}

/** Only explicit tool receipts can create question context; free assistant text cannot. */
export function questionReceiptFrom(result: unknown) {
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result)
    }
    catch {
      return undefined
    }
  }
  return result && typeof result === 'object' ? presentedQuestionFrom((result as Record<string, unknown>).pendingCustomerChoice) : undefined
}

/** Composes a tool-owned outcome with a validated question; raw pending fields grant no question authority. */
export function replyFromReceipt(result: unknown, question?: PresentedQuestion) {
  if (!result || typeof result !== 'object')
    return undefined
  const payload = result as Record<string, unknown>
  const structured = safeParse(customerReplySchema, payload.customerReply)
  if (structured.success)
    return renderCustomerReply(structured.output, question)
  const message = operationReplyFrom(payload)
  // Quantity/option receipts often use the question itself as customerMessage.
  // Compose through the same question policy as Main, instead of appending the
  // raw pending field and then appending the validated question a second time.
  if (message || question)
    return replyWithQuestion(message ?? '', question)
  const cart = payload.cart
  if (cart && typeof cart === 'object') {
    const itemCount = (cart as Record<string, unknown>).itemCount
    if (typeof itemCount === 'number')
      return itemCount === 0 ? '目前購物車是空的。' : `目前購物車共有 ${itemCount} 份餐點。`
  }
  return undefined
}

/** Service questions are read-only cues, never choices for an older Menu operation. */
export function createServiceClarificationWindow() {
  let active: ServiceClarification | undefined
  let unansweredAttempts = 0
  return {
    /** Bounded meaning repair; a failed decision cannot create purchase consent. */
    clarify(state: Parameters<typeof serviceContextKey>[0], sourceUtterance: string) {
      unansweredAttempts++
      if (unansweredAttempts > 2)
        return undefined
      active = {
        questionId: crypto.randomUUID(),
        question: unansweredAttempts === 1 ? orderingMessages['zh-Hant'].meaningQuestion : orderingMessages['zh-Hant'].meaningAssistance,
        ...(unansweredAttempts === 2 ? { purpose: 'staff-assistance' as const } : {}),
        sourceUtterance,
        contextKey: serviceContextKey(state),
        expiresAt: Date.now() + 30_000,
      }
      return active
    },
    present(question: ServiceClarification, state?: Parameters<typeof serviceContextKey>[0]) {
      // Server scope may include a Host-only navigation invitation. Bind the
      // new foreground service question to the Menu snapshot used on the next
      // request, so the retired invitation cannot invalidate or steal its answer.
      active = { ...question, ...(state ? { contextKey: serviceContextKey(state) } : {}) }
    },
    current(state: Parameters<typeof serviceContextKey>[0]) {
      if (active && (active.contextKey !== serviceContextKey(state)))
        active = undefined
      return active
    },
    /** Silent input cannot renew or consume a still-valid service question. */
    settle(result: { kind: string }) {
      if (!['IGNORE', 'INCOMPLETE', 'UNAVAILABLE', 'DEFERRED', 'SERVICE_CLARIFICATION'].includes(result.kind)) {
        active = undefined
        unansweredAttempts = 0
      }
    },
    reset() {
      active = undefined
      unansweredAttempts = 0
    },
  }
}
