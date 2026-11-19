import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import { browserRecoveryContextSchema } from '@proj-airi/stage-shared/interactive-service'
import { conversationContextSchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { nativeOrderingToolName } from '@proj-airi/stage-shared/ordering-tools'
import { pbOrderReceptionSchema } from '@proj-airi/stage-shared/pb-checkout'
import { menuEntryReceiptSchema } from '@proj-airi/stage-shared/pb-journey'
import { array, literal, looseObject, optional, parse, picklist, safeParse, string, unknown } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { conversationDecisionStateFrom } from './kiosk-fast-path'

const retrySafeToolNames = new Set([
  'browser_observe',
  'browser_search',
  'browser_quote',
  'browser_clarify_product',
  'browser_cart_get',
  'browser_state_get',
  'browser_product_get',
  'cart_get',
  'kiosk_session_history',
])

/**
 * A timed-out turn is replayable only before it attempts a browser effect.
 * Display/recommendation calls change browsing state; repeating an add, edit, checkout, or
 * payment action can create a duplicate customer operation.
 */
export function isKioskConversationRetrySafeTool(toolName: string, input?: Record<string, unknown>) {
  return retrySafeToolNames.has(nativeOrderingToolName(toolName)) || (toolName === 'menu_get' && input?.display === false)
}

/** Original intent context is retained for correlation, never as reusable operation authority. */
export interface ConversationRetry {
  state: 'available' | 'preparing' | 'submitted' | 'expired'
  text: string
  sessionId: string
  iframeRevision: number
  originalUtteranceId?: number
  requestId: number
  contextKey: string
}

/** A changed cart, checkout, question or document invalidates the old retry. */
export function retryMatches(request: ConversationRetry, current: Pick<ConversationRetry, 'sessionId' | 'iframeRevision' | 'contextKey'>) {
  return request.sessionId === current.sessionId && request.iframeRevision === current.iframeRevision && request.contextKey === current.contextKey
}

/**
 * Resumes one original demand through the normal utterance queue after fresh
 * ownership checks. It never submits directly to Main or reuses old authority.
 */
export async function resumeConversationRetry(request: ConversationRetry, io: {
  current: () => Promise<Pick<ConversationRetry, 'sessionId' | 'iframeRevision' | 'contextKey'>>
  enqueue: (text: string) => { kind: 'ACCEPTED', id: number } | { kind: 'EMPTY' | 'OVERLOADED' }
  record: (event: { kind: 'conversation_retry', originalRequestId: number, originalUtteranceId?: number, utteranceId?: number, status: string }) => Promise<unknown>
}) {
  if (request.state !== 'available')
    return { kind: 'BUSY' as const }
  request.state = 'preparing'
  try {
    const current = await io.current()
    if (!retryMatches(request, current)) {
      request.state = 'expired'
      return { kind: 'STALE' as const }
    }
    const submitted = io.enqueue(request.text)
    request.state = 'submitted'
    await io.record({ kind: 'conversation_retry', originalRequestId: request.requestId, originalUtteranceId: request.originalUtteranceId, ...(submitted.kind === 'ACCEPTED' ? { utteranceId: submitted.id } : {}), status: submitted.kind })
    return submitted
  }
  catch (error) {
    request.state = 'expired'
    throw error
  }
}

/** Reads fresh service state for retry admission, never historical operation authority. */
export async function readConversationRetryContext(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>) {
  const browser = client.tools.value.find(tool => tool.name === 'browser_recovery_context')
  if (browser) {
    const state = parse(browserRecoveryContextSchema, await client.execute(browser, {}))
    if (!state.canRetry) {
      // A healthy transport can report an unsettled commerce operation. Keep
      // the barrier, but do not label it as a connection failure or retry it.
      const message = state.blockedBy === 'order'
        ? orderingMessages['zh-Hant'].recovery.order
        : orderingMessages['zh-Hant'].previousOperation[state.blockedBy ?? 'operation']
      throw new BrowserRecoveryBlocked(message)
    }
    return JSON.stringify(['browser', state.documentId, state.contextKey])
  }
  const stateTool = client.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
  if (!stateTool)
    throw new Error('Current retry context is unavailable.')
  const current = conversationDecisionStateFrom(await client.execute(stateTool, {}))
  if (!current)
    throw new Error('Current retry context is unavailable.')
  return serviceContextKey(current)
}

/** A live site replied with an unresolved operation; reconnection cannot authorize replay. */
export class BrowserRecoveryBlocked extends Error {}

/**
 * Anchors retry to the beginning of one Main demand, never to a later round's
 * changed cart/menu. Manual retry still rereads and compares live state.
 * An effect attempt revokes the anchor, including a pending capture.
 * A failed capture disables replay; it is not execution authority for the new
 * demand, whose tools still enforce fresh document/cart and ownership checks.
 */
export function createRetryContext(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>) {
  let eligible = true
  let pending: Promise<string | undefined> | undefined
  return {
    invalidate() { eligible = false },
    async capture() {
      if (!eligible)
        return undefined
      // Single-flight and task-local only: this is retry evidence, not cached
      // execution data or permission to skip the browser's final fresh checks.
      pending ??= readConversationRetryContext(client).then(key => eligible ? key : undefined).catch(() => {
        // Recovery evidence is optional for a new demand. A failed read must
        // never manufacture an anchor or rebase it in a later model round.
        // Explicit recovery/retry admission uses the strict reader above.
        eligible = false
        return undefined
      })
      const key = await pending
      return eligible ? key : undefined
    },
  }
}

/** Reconnects and releases only a settled task belonging to this host. Never replays effects. */
export async function recoverConversationService(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute' | 'recover'>, owners: readonly (string | undefined)[]) {
  await client.recover()
  if (client.tools.value.some(tool => tool.name === 'browser_recovery_context')) {
    await readConversationRetryContext(client)
    return
  }
  const contextTool = client.tools.value.find(tool => tool.name === 'kiosk_conversation_context')
  const taskTool = client.tools.value.find(tool => tool.name === 'kiosk_agent_task')
  if (!contextTool || !taskTool)
    throw new Error('Menu recovery tools are unavailable.')
  const context = parse(conversationContextSchema, await client.execute(contextTool, { includeCatalog: false }))
  if (context.taskId && !owners.includes(context.taskId))
    throw new Error('The prior task belongs to another owner; keep ordering paused.')
  if (context.taskId) {
    const released = await client.execute(taskTool, { action: 'END', taskId: context.taskId })
    if (!released || typeof released !== 'object' || !('ok' in released) || released.ok !== true)
      throw new Error('The settled task could not release order control.')
  }
}

/** A verified lifecycle refusal whose message can be shown without exposing transport errors. */
export class BrowserRestartBlocked extends Error {}

/** Retires terminal orders by entry reload; unfinished carts still require verified native clearing. */
export async function resetConversationService(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute' | 'refresh' | 'waitUntilReady' | 'getDocumentId'>) {
  const stateReader = client.tools.value.find(tool => tool.name === 'browser_state_get')
  if (stateReader) {
    const documentId = client.getDocumentId()
    let raw: unknown
    try {
      raw = await client.execute(stateReader, { includeCatalog: false })
    }
    catch { throw new BrowserRestartBlocked(orderingMessages['zh-Hant'].restart.unavailable) }
    if (!raw || typeof raw !== 'object' || !('ok' in raw) || raw.ok !== true || !documentId || client.getDocumentId() !== documentId)
      throw new BrowserRestartBlocked(orderingMessages['zh-Hant'].restart.unavailable)
    if ('page' in raw && ['payment', 'order-result'].includes(String(raw.page))) {
      const result = safeParse(pbOrderReceptionSchema, raw)
      if (!result.success || result.output.documentId !== documentId)
        throw new BrowserRestartBlocked(orderingMessages['zh-Hant'].restart.unavailable)
      const state = result.output
      if (state.restart === 'operation-pending' || state.restart === 'payment-unknown' || state.order.paymentStatus === 'unknown')
        throw new BrowserRestartBlocked(orderingMessages['zh-Hant'].restart.unknown)
      if (state.restart === 'payment-pending' || state.order.paymentStatus === 'pending')
        throw new BrowserRestartBlocked(orderingMessages['zh-Hant'].restart.pending)
      // The existing customer lifecycle reloads the configured entry, revokes
      // this binding and retires the visitor. Never refresh editor descriptors
      // or clear/cancel a submitted order on its result document.
      return 'reload' as const
    }
    if (!client.tools.value.some(tool => tool.name === 'browser_customer_reset'))
      throw new BrowserRestartBlocked(orderingMessages['zh-Hant'].restart.unavailable)
  }
  if (!client.tools.value.some(tool => tool.name === 'browser_recovery_context'))
    return 'reload' as const
  if (!client.tools.value.some(tool => tool.name === 'browser_customer_reset'))
    throw new Error('Browser service does not support a verified customer reset.')
  const reader = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (reader) {
    // forAdmission on a menu may click PB's announcement. Reset preflight is
    // read-only; only the table route needs its private previous-cart read.
    let raw = await client.execute(reader, { includeCatalog: false })
    if (raw && typeof raw === 'object' && 'page' in raw && raw.page === 'table')
      raw = await client.execute(reader, { includeCatalog: false, forAdmission: true })
    const failure = safeParse(looseObject({ ok: literal(false), customerMessage: optional(string()) }), raw)
    if (failure.success)
      throw new BrowserRestartBlocked(failure.output.customerMessage ?? orderingMessages['zh-Hant'].restart.unavailable)
    const current = parse(looseObject({ ok: literal(true), page: string(), selectedTable: optional(string()), cartAdmission: optional(string()), cart: optional(looseObject({ lines: array(unknown()) })) }), raw)
    if (!current.cart && (current.page !== 'table' || current.cartAdmission !== 'after-table-entry'))
      throw new Error('目前無法核對購物車，請稍後再重新開始。')
    // Inspect the barrier on both table and checkout pages before offering
    // Restart. An unknown final submission is not an ordinary leftover cart.
    const recovery = client.tools.value.find(tool => tool.name === 'browser_recovery_context')!
    const state = parse(browserRecoveryContextSchema, await client.execute(recovery, {}))
    if (!state.canReset && state.blockedBy === 'order')
      throw new Error(orderingMessages['zh-Hant'].recovery.order)
    if (!state.canReset)
      throw new Error('上一筆餐點操作的結果仍在確認，請稍候再試；若持續無法重新開始，請洽工作人員。')
    if (current.page === 'table') {
      // A verified empty table cart needs no hidden Start or fake reset receipt.
      // The lifecycle still retires this visitor and reloads the table entry.
      if (current.cart?.lines.length === 0 && state.canRetry)
        return 'reload' as const
      if (!current.cart || current.cart.lines.length) {
        const start = client.tools.value.find(tool => tool.name === 'browser_start_ordering')
        if (!start || !current.selectedTable)
          throw new Error('請先選擇桌號或櫃台取餐，才能清除未完成的購物車。')
        // Explicit Restart authorizes clearing the unfinished cart. Enter through
        // the real selected-table button to reach PB's clear control, without
        // choosing a different table or issuing a merchant order.
        const entry = await client.execute(start, { name: current.selectedTable, forReset: true })
        const rejected = safeParse(looseObject({ ok: literal(false), customerMessage: optional(string()), error: optional(string()) }), entry)
        if (rejected.success)
          throw new Error(rejected.output.customerMessage ?? rejected.output.error ?? '網站尚未進入菜單，購物車尚未清空。')
        const started = parse(menuEntryReceiptSchema, entry)
        if (started.selectedTable !== current.selectedTable)
          throw new Error('清理購物車前的選桌狀態已變更。')
        const deadline = Date.now() + 15_000
        while (true) {
          await client.waitUntilReady()
          const freshReader = client.tools.value.find(tool => tool.name === 'browser_cart_get')
          if (!freshReader)
            throw new Error('清理購物車前的讀取功能尚未就緒。')
          // A ready transport may still be the table document while PB awaits
          // its Start request. Read-only polling waits for the actual SPA route;
          // it never repeats Start or a cart effect.
          const menu = parse(looseObject({ ok: literal(true), page: picklist(['table', 'menu']), cart: optional(looseObject({ tableName: optional(string()) })) }), await client.execute(freshReader, { includeCatalog: false }))
          if (menu.page === 'menu') {
            if (menu.cart?.tableName !== current.selectedTable)
              throw new Error('清理購物車前的桌號尚未確認。')
            break
          }
          if (Date.now() >= deadline)
            throw new Error('網站尚未完成切換，請稍後再按重新開始。')
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
    }
  }
  // End the advertised visual owner before admitting the reset's control
  // revision. Accepted commerce still settles through the document FIFO.
  const visual = client.tools.value.find(tool => tool.name === 'browser_present')
  if (visual)
    await client.execute(visual, { productRefs: [] })
  const documentId = client.getDocumentId()
  const tool = client.tools.value.find(tool => tool.name === 'browser_customer_reset')
  if (!tool)
    throw new Error('Browser reset control changed during preparation.')
  const raw = await client.execute(tool, {})
  const failure = safeParse(looseObject({ ok: literal(false), customerMessage: string() }), raw)
  if (failure.success)
    throw new Error(failure.output.customerMessage)
  const result = parse(looseObject({ ok: literal(true), status: literal('customer-reset'), cartCleared: literal(true), documentId: string() }), raw)
  if (!documentId || result.documentId !== documentId || client.getDocumentId() !== documentId)
    throw new Error('Browser document changed during customer reset.')
  client.refresh()
  await client.waitUntilReady()
  if (client.getDocumentId() !== documentId)
    throw new Error('Browser document changed while renewing the customer binding.')
  return 'preserved' as const
}
