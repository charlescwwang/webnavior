import type { ConversationContext, ConversationQuestion as PresentedQuestion, ServiceClarification } from '@proj-airi/stage-shared/kiosk-conversation'

import type { KioskDecisionState, KioskInteractionDecision } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { ConversationTurnResult } from '../composables/useKioskInteractionRecording'

import { quantityLimitRejectionSchema, replyFromContext, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { safeParse } from 'valibot'

/**
 * Menu facts are rendered from this turn's read receipts, never generated prose.
 * Keep all distinct lookup results: a second lookup may be a comparison, not a
 * replacement recommendation. The Agent still selects queries and operations.
 */
export function createMenuReplyWindow() {
  const messages = new Set<string>()
  const items = new Map<string, { name: string, price: number }>()
  const operations = new Set<string>()
  const outcomes: string[] = []
  let reads = 0
  let cartReply: string | undefined
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
      const question = questionReceiptFrom(payload)
      const waiting = ['item-configuration', 'confirm-meal', 'item-clarification', 'menu-query-scope'].includes(question?.purpose ?? '')
      if (typeof payload.customerMessage === 'string' && !waiting)
        operations.add(name)
      if (!['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(name)) {
        const message = operationReplyFrom(payload)
        // Only the current question may be spoken. Earlier operation receipts
        // remain, but their superseded follow-up prompts cannot be revived.
        const outcome = question && message ? message.replace(question.question, '').trim() : message
        if (outcome && !waiting)
          outcomes.push(outcome)
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
            cartReply = lines.length ? `目前訂單：${lines.join('、')}。合計 NT$${cart.total}。` : '購物車目前沒有餐點。'
          }
        }
        return
      }
      if (!Array.isArray(payload.items))
        return
      reads++
      const names: string[] = []
      for (const raw of payload.items) {
        if (!raw || typeof raw !== 'object')
          continue
        const item = raw as Record<string, unknown>
        if (typeof item.id !== 'string' || typeof item.name !== 'string' || item.available === false)
          continue
        names.push(item.name)
        if (typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0)
          items.set(item.id, { name: item.name, price: item.price })
      }
      const message = operationReplyFrom(payload)
      if (message)
        messages.add(message)
      else
        messages.add(names.length ? `我查到：${names.slice(0, 3).join('、')}。` : '目前沒有查到符合條件的餐點。')
    },
    hasOperation(intent: string) {
      const tools: Record<string, string[]> = {
        ADD_ITEM: ['order_add_item', 'cart_add_item'],
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
      return outcomes.join(' ')
    },
    hasReceipts: () => reads > 0 || cartReply !== undefined,
    reply() {
      // Without evidence, generated dish claims cannot become customer dialogue.
      if (!reads)
        return cartReply ?? '目前沒有可驗證的餐點查詢結果，請告訴我想找的餐點或條件，或使用畫面選餐。'
      const prices = reads > 1 && items.size > 1
        ? ` 單份基本售價：${[...items.values()].slice(0, 6).map(item => `${item.name} NT$${item.price}`).join('、')}。`
        : ''
      return `${[...messages].join(' ')}${prices}`
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
  /** Only a classified service FAQ may use generated prose without an operation receipt. */
  serviceReply?: boolean
  handoff?: { intent: string }
  /** Fresh snapshot read after the model/tool loop; never a historical context. */
  context?: ConversationContext
  /** Fresh host phase; invalid ordering must not be narrated as an empty menu. */
  customerEntry?: { phase: KioskDecisionState['phase'] | undefined, prompt: string }
}): { role: 'assistant' | 'error', content: string, clarification?: true } {
  // Entry must still be complete when the reply arrives: a session reset
  // cannot expose an earlier menu receipt or let a stale task bypass phone choice.
  const entryRequired = result.requestedTools.some(name => name !== 'kiosk_session_history')
  if (options.customerEntry?.phase === 'customer_entry' && (entryRequired || options.requireMenuRead))
    return { role: 'assistant' as const, content: options.customerEntry.prompt }
  const rejection = safeParse(quantityLimitRejectionSchema, result.rejection)
  if (rejection.success)
    return { role: 'assistant', content: [options.menu.operationReply(), rejection.output.customerMessage, result.question?.question].filter(Boolean).join(' ') }
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
  const operationRequired = ['ADD_ITEM', 'REMOVE_ITEM', 'SET_QUANTITY', 'SET_OPTION', 'CLEAR_CART', 'SET_FULFILLMENT', 'START_CHECKOUT', 'SELECT_PAYMENT', 'CANCEL_CHECKOUT'].includes(intent)
  // The loop result is diagnostic; only the final Menu-validated question
  // supplied by the Host may be presented after release/manual state changes.
  const question = options.question
  const configuringMeal = ['ADD_ITEM', 'SET_OPTION', 'SET_QUANTITY'].includes(intent) && ['item-configuration', 'confirm-meal'].includes(question?.purpose ?? '')
  // Clarification pauses an unexecuted demand; it never completes the mutation
  // or consumes an old confirmation. Reads may precede a clarification; attempted
  // writes still require their actual receipt or result-unknown policy.
  if (result.status === 'completed' && result.reply?.kind === 'clarification' && result.requestedTools.every(name => ['kiosk_session_history', 'menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get', 'seating_get'].includes(name)) && options.context) {
    const clarification = replyFromContext(JSON.stringify(result.reply), options.context)
    if (clarification)
      return { role: 'assistant' as const, content: clarification.content }
  }
  if (operationRequired && !options.menu.hasOperation(intent) && !configuringMeal) {
    const accepted = options.menu.operationReply()
    return accepted ? { role: 'assistant', content: `${accepted} ${options.failureMessage}` } : unresolved
  }
  const receiptReply = replyFromOperation(options.menu.hasReceipts() ? options.menu.reply() : '', options.menu.operationReply(options.outcome), question)
  if (result.status === 'waiting')
    return question && receiptReply ? { role: 'assistant', content: receiptReply } : { role: 'error', content: options.failureMessage }
  if (result.status !== 'completed') {
    return receiptReply
      ? { role: 'assistant' as const, content: `${receiptReply} ${options.failureMessage}` }
      : { role: 'error' as const, content: options.failureMessage }
  }
  if (!receiptReply && !commerceAttempted && options.context) {
    const information = replyFromContext(result.reply ? JSON.stringify(result.reply) : result.answer, options.context)
    // A display-required request still needs a presentation receipt. Only an
    // application-owned clarification may pause it without claiming completion.
    if (information && (!options.requireMenuRead || information.kind === 'clarification'))
      return { role: 'assistant' as const, content: information.content }
  }
  if (options.requireMenuRead && !receiptReply)
    return unresolved
  if (!receiptReply && !commerceAttempted && !options.requireMenuRead && !options.serviceReply)
    return unresolved
  const content = receiptReply || (commerceAttempted || options.requireMenuRead ? options.menu.reply() : result.answer)
  return content ? { role: 'assistant' as const, content } : { role: 'error' as const, content: options.failureMessage }
}

/** Retains host invitation history for this order; service questions always take foreground priority. */
export function createInvitationWindow() {
  let pending: PresentedQuestion | undefined
  const records = new Map<string, { question: PresentedQuestion, status: 'pending' | 'answered' | 'superseded' }>()
  return {
    present(question: PresentedQuestion) {
      if (question.purpose !== 'recommendation-invitation')
        return
      if (pending)
        records.set(pending.questionId, { question: pending, status: 'superseded' })
      pending = question
      records.set(question.questionId, { question, status: 'pending' })
    },
    decisionState(state: KioskDecisionState | undefined, now: number) {
      if (!state || state.phase !== 'ordering' || state.waitingFor || state.activeRequest || !pending)
        return state
      // Idle expires a per-decision answer ticket, not the unanswered invitation.
      return { ...state, waitingFor: { ...pending, expiresAt: now + 30000 } }
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
    },
    history: () => [...records.values()],
    reset() {
      pending = undefined
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
export function replyWithQuestion(answer: string, question: PresentedQuestion | undefined) {
  return question && !answer.includes(question.question) ? `${answer} ${question.question}`.trim() : answer
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
  const message = (result as Record<string, unknown>).customerMessage
  return typeof message === 'string' && message.trim() ? message : undefined
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
  return {
    present(question: ServiceClarification) { active = { ...question } },
    current(state: Parameters<typeof serviceContextKey>[0]) {
      if (active && (active.expiresAt <= Date.now() || active.contextKey !== serviceContextKey(state)))
        active = undefined
      return active
    },
    /** Silent input cannot renew or consume a still-valid service question. */
    settle(result: { kind: string }) {
      if (!['IGNORE', 'INCOMPLETE', 'UNAVAILABLE', 'DEFERRED', 'SERVICE_CLARIFICATION'].includes(result.kind))
        active = undefined
    },
    reset() { active = undefined },
  }
}
