import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'
import type { ConversationContext, ServiceClarification } from '@proj-airi/stage-shared/kiosk-conversation'

import type { KioskDecisionState, KioskInteractionDecision, PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { ConversationTurnResult } from '../composables/useKioskInteractionRecording'

import { replyFromContext, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { nativeOrderingToolName } from '@proj-airi/stage-shared/ordering-tools'
import { describePbMeal, pbBasicServing, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

/** Customer recovery uses verified progress only; it never completes or replays an order. */
export function browserRecoveryReply(input: { operationAttempted: boolean, page?: BrowserConversation['page'], verifiedMessage?: string }) {
  const messages = orderingMessages['zh-Hant'].recovery
  const guidance = input.operationAttempted ? messages.review : input.page ? messages[input.page] : messages.unavailable
  return { role: 'assistant' as const, recovery: true as const, content: [...new Set([input.verifiedMessage, guidance].filter(Boolean))].join(' ') }
}

/** Formats current website facts without adopting generated claims or claiming an order effect. */
function browserReadSummary(name: string, payload: Record<string, unknown>) {
  if (payload.ok !== true || payload.source !== 'browser')
    return
  const openedDetails = nativeOrderingToolName(name) === 'browser_open_product'
  if (!openedDetails && payload.dataOnly !== true)
    return
  if (name === 'list_cart_items' && payload.cart && typeof payload.cart === 'object') {
    const cart = payload.cart as Record<string, unknown>
    if (!Array.isArray(cart.lines))
      return
    const lines = cart.lines.flatMap((line) => {
      if (!line || typeof line !== 'object' || typeof line.name !== 'string' || typeof line.quantity !== 'number')
        return []
      if (typeof line.unitPrice === 'number') {
        const options = Array.isArray(line.options) && line.options.every((option: { name?: unknown, quantity?: unknown }) => option && typeof option.name === 'string' && typeof option.quantity === 'number') ? line.options : undefined
        return [describePbMeal({ name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, options, description: typeof line.description === 'string' ? line.description : undefined, note: typeof line.note === 'string' ? line.note : undefined })]
      }
      return [`${line.name}${line.description ? `（${line.description}）` : ''}${line.note ? `，備註${line.note}` : ''} ${line.quantity}份`]
    })
    return lines.length ? `購物車裡有：${lines.join('、')}。${typeof cart.subtotal === 'number' ? `網站小計${cart.subtotal}元。` : ''}要看購物車核對，還是修改餐點？` : '購物車目前沒有餐點。想點哪一道？'
  }
  if ((!openedDetails && !['list_menu_items', 'get_menu_item_details'].includes(name)) || !Array.isArray(payload.products))
    return
  // Opening a dialog returns the whole rendered catalog as well. Only the
  // exact dish confirmed in this receipt's dialog can answer this detail query.
  const dialogNames = new Set(Array.isArray(payload.productDialog) ? payload.productDialog.flatMap(dialog => dialog && typeof dialog === 'object' && typeof dialog.name === 'string' ? [dialog.name] : []) : [])
  const queriedProducts = openedDetails
    ? payload.products.filter(product => product && typeof product === 'object' && dialogNames.has(product.name))
    : payload.products
  if (openedDetails && !queriedProducts.length)
    return
  const includeDetails = openedDetails || name === 'get_menu_item_details'
  const products = queriedProducts.slice(0, 10).flatMap((product) => {
    if (!product || typeof product !== 'object' || typeof product.name !== 'string')
      return []
    const specs: string[] = []
    if (Array.isArray(product.configurations)) {
      for (const spec of product.configurations) {
        if (!spec || typeof spec !== 'object' || typeof spec.unitPrice !== 'number')
          continue
        const label = typeof spec.name === 'string' && spec.name && spec.name !== product.name ? spec.name : '單份'
        specs.push(`${label}${spec.unitPrice}元`)
      }
    }
    // Verified configuration prices take precedence over a catalog/base price.
    // Missing prices are reported as unknown, never derived from another dish.
    let price = '價格尚未確認'
    if (specs.length)
      price = specs.join('、')
    else if (typeof product.price === 'number')
      price = `單份${product.price}元`
    let details = ''
    if (includeDetails) {
      // Prefer the merchant API's description; rendered card text is the
      // alternate evidence when the API omits it, and may repeat name/price.
      if (typeof product.description === 'string' && product.description.trim())
        details = product.description.trim()
      else if (typeof product.details === 'string')
        details = product.details.trim()
    }
    // Card text often repeats its dish name and base price. Keep the website's
    // contents, but report the verified price once through the price field above.
    if (details.startsWith(product.name))
      details = details.slice(product.name.length).trim()
    if (typeof product.price === 'number' && details.endsWith(`$${product.price}`))
      details = details.slice(0, -`$${product.price}`.length).trim()
    const servingPrice = typeof product.price === 'number' ? product.price : undefined
    const serving = pbBasicServing(product.name, servingPrice)
    const contents = includeDetails ? [serving, details].filter(Boolean).join('；') : ''
    return [`${pbProductName(product.name)}：${contents ? `${contents}；` : ''}${price}`]
  })
  const nextStep = includeDetails ? '' : '想看哪道餐點，或要點幾份？'
  return products.length ? `${products.join('；')}。${queriedProducts.length > 10 ? '目前先列出前十道。' : ''}${nextStep}` : '目前條件下沒有符合的餐點，可以告訴我想調整的條件。'
}

/**
 * Menu facts are rendered from this turn's read receipts, never generated prose.
 * Keep all distinct lookup results: a second lookup may be a comparison, not a
 * replacement recommendation. The Agent still selects queries and operations.
 */
export function createMenuReplyWindow() {
  const messages = new Set<string>()
  const items = new Map<string, { name: string, price: number }>()
  const operations = new Set<string>()
  let reads = 0
  let cartReply: string | undefined
  let browserOutcome: string | undefined
  let publicReadReply: string | undefined
  let presentationFailure: string | undefined
  let cartChange: unknown
  const browserEffects = new Set<string>()
  return {
    record(name: string, result: unknown) {
      const publicName = name
      name = nativeOrderingToolName(name)
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result)
        }
        catch { return }
      }
      if (!result || typeof result !== 'object')
        return
      const payload = result as Record<string, unknown>
      if (['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace', 'browser_confirm_add', 'browser_question_answer'].includes(name))
        cartChange = payload.ok === true && payload.status === 'verified' ? payload : undefined
      if (name === 'browser_present') {
        if (payload.ok === false && payload.source === 'browser' && payload.status === 'rejected' && payload.effect === 'none')
          presentationFailure = operationReplyFrom(payload)
        else if (payload.ok === true)
          presentationFailure = undefined
      }
      publicReadReply = browserReadSummary(publicName, payload) ?? publicReadReply
      if ((name.startsWith('browser_cart_') || name === 'browser_confirm_add' || name === 'browser_question_answer') && payload.source === 'browser' && typeof payload.customerMessage === 'string') {
        if (payload.status === 'verified' || payload.status === 'preserved') {
          if (payload.status === 'verified' && typeof payload.effectMessage === 'string')
            browserEffects.add(payload.effectMessage)
          browserOutcome = operationReplyFrom(payload)
        }
        else if (['unknown', 'rejected', 'clarification'].includes(String(payload.status))) {
          // A later refusal cannot erase an earlier verified effect. State
          // only completed effects here, never reuse an older cart as current.
          browserOutcome = [...browserEffects, payload.customerMessage].join(' ')
        }
      }
      if (payload.ok === false)
        return
      // External services own their browser observations and deterministic
      // customer receipts. Do not replace them with unverified model prose or
      // pretend they are Menu/POS records. Retain comparisons across reads.
      if (['browser_observe', 'browser_search', 'browser_present', 'browser_quote', 'browser_quote_selection', 'browser_clarify_product', 'browser_cart_get', 'browser_product_get'].includes(name) && payload.ok === true && payload.source === 'browser') {
        if (payload.dataOnly === true)
          return
        const message = operationReplyFrom(payload)
        if (message) {
          reads++
          messages.add(message)
        }
        return
      }
      if (typeof payload.customerMessage === 'string')
        operations.add(name)
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
    hasReceipts: () => reads > 0 || cartReply !== undefined || publicReadReply !== undefined,
    browserOutcome: () => browserOutcome,
    cartChange: () => cartChange,
    presentationFailure: () => presentationFailure,
    reply() {
      // Without evidence, generated dish claims cannot become customer dialogue.
      if (!reads)
        return cartReply ?? publicReadReply ?? '目前沒有可驗證的餐點查詢結果，請告訴我想找的餐點或條件，或使用畫面選餐。'
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
 * External-page failures use manual continuation guidance; missing receipts never establish success.
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
  /** External-page recovery keeps failures in diagnostics and guides manual continuation. */
  browserRecovery?: { operationAttempted: boolean, page?: BrowserConversation['page'] }
}): { role: 'assistant' | 'error', content: string, clarification?: true, recovery?: true } {
  // Entry must still be complete when the reply arrives: a session reset
  // cannot expose an earlier menu receipt or let a stale task bypass phone choice.
  const entryRequired = result.requestedTools.some(name => name !== 'kiosk_session_history')
  if (options.customerEntry?.phase === 'customer_entry' && (entryRequired || options.requireMenuRead))
    return { role: 'assistant' as const, content: options.customerEntry.prompt }
  // The caller revalidated this question from a receipt issued in this turn.
  // Waiting for its answer pauses the demand; it need not have changed the cart.
  // Preserve that boundary even if a later model step exhausted its budget.
  if (options.question && options.question.expiresAt > Date.now() && result.reason !== 'manual-control')
    return { role: 'assistant', content: replyWithQuestion(options.outcome ?? '', options.question) }
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
    : options.browserRecovery ? browserRecoveryReply({ ...options.browserRecovery, verifiedMessage: options.menu.hasReceipts() ? options.menu.reply() : undefined }) : { role: 'error' as const, content: options.failureMessage }
  // A true menu receipt cannot complete a known mutation task. Preserve the
  // requested effect even when Main chooses a factual but unrelated lookup.
  const intent = options.handoff?.intent ?? ''
  const operationRequired = ['ADD_ITEM', 'REMOVE_ITEM', 'SET_QUANTITY', 'SET_OPTION', 'CLEAR_CART', 'SET_FULFILLMENT', 'START_CHECKOUT', 'SELECT_PAYMENT', 'CANCEL_CHECKOUT'].includes(intent)
  const configuringMeal = ['ADD_ITEM', 'SET_OPTION', 'SET_QUANTITY'].includes(intent) && ['item-configuration', 'confirm-meal'].includes(options.question?.purpose ?? '')
  // Clarification pauses an unexecuted demand; it never completes the mutation
  // or consumes an old confirmation. Any attempted tool keeps receipt rules.
  if (result.status === 'completed' && result.reply?.kind === 'clarification' && !commerceAttempted && options.context) {
    const clarification = replyFromContext(JSON.stringify(result.reply), options.context)
    if (clarification)
      return { role: 'assistant' as const, content: clarification.content }
  }
  if (operationRequired && !options.menu.hasOperation(intent) && !configuringMeal)
    return unresolved
  const receiptReply = replyFromOperation(options.menu.hasReceipts() ? options.menu.reply() : '', options.outcome, options.question)
  if (result.status !== 'completed') {
    const passiveOnly = result.requestedTools.every(name => name === 'list_cart_items' || ['browser_observe', 'browser_product_get', 'browser_present'].includes(nativeOrderingToolName(name)))
    const displayFailure = options.menu.presentationFailure()
    if (result.reason === 'tool-rejected' && passiveOnly && displayFailure && !operationRequired)
      return { role: 'assistant' as const, content: [receiptReply, displayFailure].filter(Boolean).join(' ') }
    if (options.browserRecovery)
      return browserRecoveryReply({ ...options.browserRecovery, verifiedMessage: receiptReply || undefined })
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
  return content ? { role: 'assistant' as const, content } : unresolved
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
  return typeof message === 'string' && message.trim() ? guidedBrowserReply(result as Record<string, unknown>, message) : undefined
}

/** Adds a single navigation offer at the final presentation boundary, never per tool layer. */
function guidedBrowserReply(payload: Record<string, unknown>, message: string) {
  if (payload.source !== 'browser' || payload.pendingCustomerChoice || /[？?]|可以繼續|您可以說/.test(message) || !Array.isArray(payload.nextActions))
    return message
  if (payload.nextActions.includes('review-checkout'))
    return `${message} 請先核對餐點；確認後可在畫面繼續結帳，也可以告訴我要修改什麼。`
  if (payload.nextActions.includes('view-cart'))
    return message
  if (payload.nextActions.includes('choose-item'))
    return `${message} 想點哪一道？也可以一起告訴我份數。`
  return message
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
