const retrySafeToolNames = new Set([
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
