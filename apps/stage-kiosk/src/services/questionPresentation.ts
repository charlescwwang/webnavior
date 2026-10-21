import type { ServiceClarification } from '@proj-airi/stage-shared/kiosk-conversation'

import type { KioskDecisionState, KioskInteractionDecision, PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { ConversationTurnResult } from '../composables/useKioskInteractionRecording'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'

/**
 * Menu facts are rendered from this turn's read receipts, never generated prose.
 * Keep all distinct lookup results: a second lookup may be a comparison, not a
 * replacement recommendation. The Agent still selects queries and operations.
 */
export function createMenuReplyWindow() {
  const messages = new Set<string>()
  const items = new Map<string, { name: string, price: number }>()
  let reads = 0
  let cartReply: string | undefined
  return {
    record(name: string, result: unknown) {
      if (!['menu_get', 'menu_recommend', 'menu_show_recommendations', 'cart_get'].includes(name))
        return
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result)
        }
        catch { return }
      }
      if (!result || typeof result !== 'object')
        return
      const payload = result as Record<string, unknown>
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
 * Resolves one Agent task for display: no-tool dialogue stays natural, while
 * commerce attempts use current-turn receipts even if the model claims success.
 * Transport failures without receipts are errors, never a fabricated menu reply.
 */
export function replyFromConversation(result: ConversationTurnResult, options: {
  menu: ReturnType<typeof createMenuReplyWindow>
  outcome?: string
  question?: PresentedQuestion
  failureMessage: string
  requireMenuRead?: boolean
  handoff?: { intent: string }
  /** Fresh host phase; invalid ordering must not be narrated as an empty menu. */
  customerEntry?: { phase: KioskDecisionState['phase'] | undefined, prompt: string }
}) {
  // Entry must still be complete when the reply arrives: a session reset
  // cannot expose an earlier menu receipt or let a stale task bypass phone choice.
  const entryRequired = result.requestedTools.some(name => name !== 'kiosk_session_history')
  if (options.customerEntry?.phase === 'customer_entry' && (entryRequired || options.requireMenuRead))
    return { role: 'assistant' as const, content: options.customerEntry.prompt }
  // A history lookup supplies conversation context, not a new commerce result.
  const commerceAttempted = result.requestedTools.some(name => name !== 'kiosk_session_history')
  // A true menu receipt cannot complete a known mutation task. Preserve the
  // requested effect even when Main chooses a factual but unrelated lookup.
  const operationRequired = ['ADD_ITEM', 'REMOVE_ITEM', 'SET_QUANTITY', 'SET_OPTION', 'CLEAR_CART'].includes(options.handoff?.intent ?? '')
  if (operationRequired && !options.outcome && !options.question)
    return { role: 'error' as const, content: options.failureMessage }
  const receiptReply = replyFromOperation(options.menu.hasReceipts() ? options.menu.reply() : '', options.outcome, options.question)
  if (result.status !== 'completed') {
    return receiptReply
      ? { role: 'assistant' as const, content: `${receiptReply} ${options.failureMessage}` }
      : { role: 'error' as const, content: options.failureMessage }
  }
  if (options.requireMenuRead && !receiptReply)
    return { role: 'error' as const, content: options.failureMessage }
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
  return { questionId: question.questionId, purpose: question.purpose, question: question.question, expiresAt: question.expiresAt, choices }
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
    reset() { active = undefined },
  }
}
