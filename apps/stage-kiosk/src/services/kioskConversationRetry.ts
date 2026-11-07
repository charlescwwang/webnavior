import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import { browserRecoveryContextSchema } from '@proj-airi/stage-shared/interactive-service'
import { conversationContextSchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { literal, looseObject, parse, string } from 'valibot'

import { conversationDecisionStateFrom } from './kiosk-fast-path'

const retrySafeToolNames = new Set([
  'browser_observe',
  'browser_search',
  'browser_quote',
  'browser_clarify_product',
  'browser_cart_get',
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
  return retrySafeToolNames.has(toolName) || (toolName === 'menu_get' && input?.display === false)
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
    if (!state.canRetry)
      throw new Error('Browser operations are not settled; keep retry paused.')
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

/** Ends browser draft authority while retaining the vendor document and shared login. */
export async function resetConversationService(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute' | 'refresh' | 'waitUntilReady' | 'getDocumentId'>) {
  if (!client.tools.value.some(tool => tool.name === 'browser_recovery_context'))
    return 'reload' as const
  const tool = client.tools.value.find(tool => tool.name === 'browser_customer_reset')
  if (!tool)
    throw new Error('Browser service does not support a verified customer reset.')
  // End the advertised visual owner before admitting the reset's control
  // revision. Accepted commerce still settles through the document FIFO.
  const visual = client.tools.value.find(tool => tool.name === 'browser_present')
  if (visual)
    await client.execute(visual, { productRefs: [] })
  const documentId = client.getDocumentId()
  const result = parse(looseObject({ ok: literal(true), status: literal('customer-reset'), cartPreserved: literal(true), documentId: string() }), await client.execute(tool, {}))
  if (!documentId || result.documentId !== documentId || client.getDocumentId() !== documentId)
    throw new Error('Browser document changed during customer reset.')
  client.refresh()
  await client.waitUntilReady()
  if (client.getDocumentId() !== documentId)
    throw new Error('Browser document changed while renewing the customer binding.')
  return 'preserved' as const
}
