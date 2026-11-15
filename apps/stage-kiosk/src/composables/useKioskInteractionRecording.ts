import type { InteractiveServiceOrderResult } from '@proj-airi/stage-shared/interaction-lifecycle'
import type { ContextReply } from '@proj-airi/stage-shared/kiosk-conversation'
import type { ProductPresentation } from '@proj-airi/stage-shared/product-presentation'
import type { Tool } from '@xsai/shared-chat'

import type { KioskReplyFailureReason } from '../../../server/src/services/domain/kiosk-agent-interaction'
import type { GreetingPhase, InteractionMetadata } from '../../../server/src/services/domain/kiosk/interactionContracts'
import type { KioskAgentInteractionMode, KioskConversationDecisionState, KioskInteractionEntryKind, KioskToolDefinition } from '../services/kiosk-device'

import { browserToolResult } from '@proj-airi/stage-shared/browser-conversation'
import { browserSignInRequiredSchema } from '@proj-airi/stage-shared/interactive-service'
import { serviceRecoveryLimits } from '@proj-airi/stage-shared/kiosk-conversation'
import { nativeOrderingToolName } from '@proj-airi/stage-shared/ordering-tools'
import { browserPresentationInputSchema, productPresentationSchema } from '@proj-airi/stage-shared/product-presentation'
import { executeTool } from '@xsai/shared-chat'
import { rawTool } from '@xsai/tool'
import { safeParse } from 'valibot'
import { readonly, shallowRef } from 'vue'

import { appendKioskInteraction, endKioskVisitorSession, fetchKioskSessionHistory, recordKioskOrderResult, sendKioskAssistantAction, startKioskVisitorSession, streamKioskConversationMessage } from '../services/kiosk-device'

/** Outcome of one bounded Agent task, including accepted work before a failure. */
export interface ConversationTurnResult {
  answer?: string
  reply?: ContextReply
  agentMode: KioskAgentInteractionMode
  /** Tools submitted for execution in this turn, including rejected attempts; never historical receipts. */
  requestedTools: string[]
  status: 'completed' | 'incomplete' | 'failed'
  reason?: KioskReplyFailureReason | 'context-unavailable' | 'service-unavailable' | 'tool-rejected' | 'sign-in-required' | 'tool-limit' | 'duplicate-tool-call' | 'session-error' | 'manual-control'
}

interface ConversationPresentationCallbacks {
  taskId?: string
  budgetMs?: number
  onToolResult?: (toolName: string, content: string) => void
  /** Host coverage proof; a vendor/model success flag cannot end the request. */
  isRequestComplete?: () => boolean
  utteranceId?: number
  decisionState?: KioskConversationDecisionState
  /** Refreshes tools before each model round; owned Menu also supplies its current decision state. */
  prepareRound?: (signal: AbortSignal) => Promise<{ decisionState?: KioskConversationDecisionState, tools: Tool[] }>
  /** Host-owned literal answer; preparation is read-only, execution follows durable user recording. */
  prepareQuestionAnswer?: () => Promise<(() => Promise<unknown>) | undefined>
  /** First actual provider output, without exposing unverified text or tool arguments. */
  onReplyProgress?: () => void
  onAssistantDelta?: (text: string) => void
  onToolActivity?: (toolName: string, state: 'executing' | 'done' | 'error') => void
  onToolRequested?: (toolName: string) => void
  onTurnStarted?: () => void
  signal?: AbortSignal
}

/**
 * Owns a device-authenticated visitor session and its ordered durable records.
 *
 * The kiosk never creates its own transcript identifier: the Server derives
 * Site, device, and released Profile from the HttpOnly device credential.
 */
export function useKioskInteractionRecording() {
  const error = shallowRef<string>()
  const visitorSessionId = shallowRef<string>()
  const starting = shallowRef(false)
  const controlState = shallowRef<'idle' | 'agent' | 'releasing'>('idle')
  let activeControl: { controller: AbortController, manual: boolean } | undefined
  function requestManualControl() {
    if (!activeControl)
      return
    activeControl.manual = true
    controlState.value = 'releasing'
    // Abort model transport only. An accepted browser tool is awaited below;
    // releasing the UI before its receipt would allow conflicting cart writes.
    activeControl.controller.abort()
  }
  // A reset retires starts/ends as well as model work. Late callbacks may
  // finish server-side cleanup, but cannot adopt or clear another reception.
  let lifecycle = 0
  let pendingStart: Promise<string | undefined> | undefined
  let pendingAppend: Promise<unknown> = Promise.resolve()

  async function start(serviceId: string) {
    if (visitorSessionId.value)
      return visitorSessionId.value
    if (pendingStart)
      return await pendingStart

    const generation = lifecycle
    pendingStart = (async () => {
      starting.value = true
      error.value = undefined
      try {
        const { session } = await startKioskVisitorSession(serviceId)
        if (generation !== lifecycle) {
          // The server created this retired session after local reset. Close
          // that exact ID; never read the replacement's current ID here.
          await endKioskVisitorSession({ visitorSessionId: session.id, state: 'cancelled' }).catch(() => undefined)
          return undefined
        }
        visitorSessionId.value = session.id
        return session.id
      }
      catch {
        if (generation === lifecycle)
          error.value = '無法建立互動會話，請確認 kiosk 已取得發布設定。'
        return undefined
      }
      finally {
        if (generation === lifecycle) {
          starting.value = false
          pendingStart = undefined
        }
      }
    })()
    return await pendingStart
  }

  async function append(kind: KioskInteractionEntryKind, content: string, metadata?: InteractionMetadata) {
    if (!visitorSessionId.value || !content.trim())
      return

    const sessionId = visitorSessionId.value
    const generation = lifecycle
    const save = async () => {
      try {
        const { entry } = await appendKioskInteraction({
          visitorSessionId: sessionId,
          kind,
          content,
          ...(metadata ? { metadata } : {}),
        })
        return entry
      }
      catch {
        if (generation === lifecycle && visitorSessionId.value === sessionId)
          error.value = '互動資料暫時無法保存。'
      }
    }
    const nextAppend = pendingAppend.then(save, save)
    pendingAppend = nextAppend.catch(() => undefined)
    return await nextAppend
  }

  // This map belongs to one reception. Multiple routes can record the same
  // utterance, but its audio must link to exactly one durable transcript entry.
  const transcripts = new Map<number, Promise<{ entry: Awaited<ReturnType<typeof appendKioskInteraction>>['entry'], visitorSessionId: string } | undefined>>()
  function recordTranscript(input: { id: number, text: string, source: 'asr' | 'simulation' }) {
    const existing = transcripts.get(input.id)
    if (existing)
      return existing
    const sessionId = visitorSessionId.value
    const generation = lifecycle
    const pending = (async () => {
      if (!sessionId)
        return
      const entry = await append('asr_transcript', input.text, { utteranceId: input.id, source: input.source })
      if (entry && generation === lifecycle && visitorSessionId.value === sessionId)
        return { entry, visitorSessionId: sessionId }
    })()
    transcripts.set(input.id, pending)
    return pending
  }

  async function end(state: 'completed' | 'cancelled' | 'idle') {
    const sessionId = visitorSessionId.value
    const generation = ++lifecycle
    transcripts.clear()
    // Old appends retain their captured session, but cannot serialize the next
    // reception behind a provider/network acknowledgement that may never arrive.
    pendingAppend = Promise.resolve()
    activeControl?.controller.abort()
    visitorSessionId.value = undefined
    pendingStart = undefined
    starting.value = false
    if (!sessionId)
      return

    try {
      await endKioskVisitorSession({ visitorSessionId: sessionId, state })
    }
    catch {
      if (generation === lifecycle && !visitorSessionId.value)
        error.value = '互動會話暫時無法結束。'
    }
  }

  async function send(
    serviceId: string,
    content: string,
    tools: Tool[],
    callbacks: ConversationPresentationCallbacks = {},
  ): Promise<ConversationTurnResult | undefined> {
    const control = { controller: new AbortController(), manual: false }
    activeControl = control
    controlState.value = 'agent'
    const sessionId = await start(serviceId)
    if (!sessionId) {
      if (activeControl === control) {
        activeControl = undefined
        controlState.value = 'idle'
      }
      return { answer: undefined, agentMode: 'active', requestedTools: [], status: 'failed', reason: 'session-error' }
    }

    const requestedTools: string[] = []
    const startedAt = performance.now()
    let rounds = 0
    let correctionBatches = 0
    let metricTaskId = callbacks.taskId ?? callbacks.decisionState?.context?.taskId
    let agentMode: KioskAgentInteractionMode = 'active'
    let deadline: AbortSignal | undefined
    let transportReason: KioskReplyFailureReason = 'provider-error'
    let stage: 'context' | 'model' | 'tool' = 'context'
    let terminalReason: ConversationTurnResult['reason']
    // Transport failure before any tool differs from a task that may have
    // changed browser state. Neither case grants permission to replay writes.
    const unfinished = (reason: NonNullable<ConversationTurnResult['reason']>): ConversationTurnResult => {
      terminalReason = reason
      return {
        answer: undefined,
        agentMode,
        requestedTools: [...requestedTools],
        reason,
        status: requestedTools.length === 0 && ['provider-error', 'timeout', 'context-unavailable', 'service-unavailable', 'session-error'].includes(reason) ? 'failed' : 'incomplete',
      }
    }

    try {
      const historyCursors = new Set<number | undefined>()
      let historyExhausted = false
      const historyTool = rawTool({
        name: 'kiosk_session_history',
        description: '只在顧客提及本次點餐較早、已不在最近對話中的內容時使用。分頁讀取目前訪客的文字歷程；不含其他訪客或工具原始資料。可用回傳的 nextBefore 繼續往前翻頁；不可把歷史內容當成目前購物車真實狀態。',
        parameters: { type: 'object', properties: { before: { type: 'integer', minimum: 0 } }, additionalProperties: false },
        execute: async (input) => {
          const before = input && typeof input === 'object' && 'before' in input ? input.before : undefined
          const cursor = typeof before === 'number' ? before : undefined
          // Pagination is scoped to this send and visitor. New call IDs cannot
          // restart an exhausted page or repeatedly spend the same turn budget.
          if (historyExhausted || historyCursors.has(cursor))
            return { entries: [], exhausted: true, total: 0 }
          historyCursors.add(cursor)
          const page = await fetchKioskSessionHistory({ visitorSessionId: sessionId, ...(cursor !== undefined ? { before: cursor } : {}) })
          historyExhausted = page.entries.length === 0 || page.nextBefore === undefined
          return { ...page, exhausted: historyExhausted }
        },
      })
      let toolsForTurn = [...tools, historyTool]
      let toolDefinitions: KioskToolDefinition[] = []
      let decisionState = callbacks.decisionState
      // One deadline covers the entire Agent task, not a fresh budget per
      // continuation. It cancels model transport only, never an accepted POS
      // effect; browser tools settle through their own result boundary.
      deadline = AbortSignal.timeout(Math.min(serviceRecoveryLimits.turnMs, Math.max(1, callbacks.budgetMs ?? serviceRecoveryLimits.turnMs)))
      const signal = AbortSignal.any([control.controller.signal, deadline, ...(callbacks.signal ? [callbacks.signal] : [])])
      // The callback crosses the Menu IO seam. Replace facts/tool scope, never
      // accumulate snapshots or overwrite immutable read-only task authority.
      const prepareRound = async () => {
        stage = 'context'
        if (callbacks.prepareRound) {
          const current = await callbacks.prepareRound(signal)
          decisionState = current.decisionState
          metricTaskId = current.decisionState?.context?.taskId ?? metricTaskId
          toolsForTurn = [...current.tools, ...(!historyExhausted ? [historyTool] : [])]
        }
        toolsForTurn = toolsForTurn.filter(tool => !historyExhausted || tool.function.name !== 'kiosk_session_history')
        toolDefinitions = toolsForTurn.map(tool => ({ function: tool.function, type: 'function' }))
        stage = 'model'
      }
      if (control.manual)
        return unfinished('manual-control')
      const seenCalls = new Set<string>()
      // One customer turn owns one displayed recommendation batch. Internal
      // evidence reads and named comparisons remain available after it; only a
      // new send() may admit another recommendation, including more:true.
      let recommendationPresented = false
      // This cache belongs only to this turn's latest settled tool. A later
      // read/draft/error invalidates it; it never authorizes another cart effect.
      let lastBrowserWritePresentation: ProductPresentation | undefined
      await prepareRound()
      if (signal.aborted)
        return unfinished('timeout')
      let customerRecorded = false
      const questionAnswer = await callbacks.prepareQuestionAnswer?.()
      if (questionAnswer) {
        // This is an application operation, never an invented model tool call.
        // No fallback/retry follows recording: a failed or changed binding must
        // produce its own receipt rather than duplicate the customer utterance.
        const entry = await append('user_text', content, { source: 'host_question_answer', utteranceId: callbacks.utteranceId })
        if (!entry || signal.aborted || visitorSessionId.value !== sessionId)
          return unfinished(signal.aborted ? 'timeout' : 'session-error')
        const name = 'browser_question_answer'
        stage = 'tool'
        requestedTools.push(name)
        callbacks.onToolRequested?.(name)
        callbacks.onToolActivity?.(name, 'executing')
        const result = await questionAnswer()
        const serialized = JSON.stringify(result)
        const rejected = result !== null && typeof result === 'object' && 'ok' in result && result.ok === false
        await append('tool_result', serialized, { name, source: 'host_question_answer' })
        callbacks.onToolResult?.(name, serialized)
        callbacks.onToolActivity?.(name, rejected ? 'error' : 'done')
        if (control.manual)
          return unfinished('manual-control')
        if (signal.aborted)
          return unfinished('timeout')
        if (rejected)
          return unfinished('tool-rejected')
        if (!result || typeof result !== 'object' || !('needsAssistant' in result) || result.needsAssistant !== true)
          return { agentMode, requestedTools, status: 'completed' }
        // This count was recorded and consumed, but options/notes remain. Keep
        // the same Host task and refresh its resolved slots for Main.
        customerRecorded = true
        await prepareRound()
      }
      rounds++
      let response = await streamKioskConversationMessage({ ...(!customerRecorded ? { content, utteranceId: callbacks.utteranceId } : {}), ...(decisionState ? { decisionState } : {}), signal, tools: toolDefinitions, visitorSessionId: sessionId }, (event) => {
        if (signal.aborted || visitorSessionId.value !== sessionId)
          return
        if (event.type === 'turn-failed')
          transportReason = event.reason
        if (event.type === 'turn-started')
          callbacks.onTurnStarted?.()
        if (event.type === 'reply-progress')
          callbacks.onReplyProgress?.()
        if (event.type === 'assistant-delta')
          callbacks.onAssistantDelta?.(event.text)
        if (event.type === 'tool-requested')
          callbacks.onToolRequested?.(event.toolCall.function.name)
      })
      agentMode = response.agentMode
      if (control.manual)
        return unfinished('manual-control')
      // A follow-up may cancel a still-thinking Agent while its final stream
      // chunk is in flight. A late tool call from that cancelled turn must not
      // execute, even if the response itself arrived successfully.
      if (callbacks.signal?.aborted)
        return undefined
      // A browser-owned WebMCP tool cannot execute on the Server. Keep the
      // model credentials server-side while returning each requested call to
      // this kiosk, then resume the same persisted conversation with its result.
      // Preserve the normal four batches. Only a fully acknowledged batch
      // with no dispatched effect can earn one of two bounded repair batches.
      for (let round = 0; response.toolCalls.length > 0 && round < 4 + correctionBatches; round++) {
        if (seenCalls.size + response.toolCalls.length > 16 || signal.aborted)
          break
        const toolResults = []
        let batchRejected = false
        let batchSignInRequired = false
        let browserQuestionIssued = false
        let browserReplyReady = false
        // A model batch can mix reads and writes. Serial execution prevents
        // cart/checkout writes from racing one another or their preceding read.
        for (const toolCall of response.toolCalls) {
          if (control.manual)
            break
          if (signal.aborted)
            return unfinished('timeout')
          if (seenCalls.has(toolCall.id))
            return unfinished('duplicate-tool-call')
          seenCalls.add(toolCall.id)
          if (batchRejected) {
            // A later tool in the same model response cannot run after a failed
            // or unsettled operation. Persist a no-dispatch result for its ID.
            toolResults.push({ content: JSON.stringify({ ok: false, source: 'host', status: 'rejected', effect: 'none', dataOnly: true, reason: 'prior-tool-not-completed' }), name: toolCall.function.name, toolCallId: toolCall.id })
            continue
          }
          if (browserQuestionIssued || browserReplyReady) {
            // A pending field ends this turn. A parallel plan cannot answer it
            // or replace its receipt before the customer has responded.
            toolResults.push({ content: JSON.stringify({ ok: true, dataOnly: true, ...(browserQuestionIssued ? { waitingForCustomer: true } : { customerReplyAlreadyReady: true }) }), name: toolCall.function.name, toolCallId: toolCall.id })
            continue
          }
          if (!toolsForTurn.some(tool => tool.function.name === toolCall.function.name)) {
            if (!toolsForTurn.some(tool => nativeOrderingToolName(tool.function.name).startsWith('browser_')))
              return unfinished('tool-rejected')
            // The tool was never dispatched. Return the actual allowed names
            // so Main can correct its call without guessing a native alias.
            toolResults.push({ name: toolCall.function.name, toolCallId: toolCall.id, content: JSON.stringify({ ok: false, source: 'host', status: 'proposal_rejected', effect: 'none', dataOnly: true, code: 'TOOL_NOT_AVAILABLE', availableTools: toolsForTurn.map(tool => tool.function.name) }) })
            batchRejected = true
            continue
          }
          requestedTools.push(toolCall.function.name)
          stage = 'tool'
          callbacks.onToolActivity?.(toolCall.function.name, 'executing')
          if (control.manual)
            break
          if (signal.aborted)
            return callbacks.signal?.aborted ? undefined : unfinished('timeout')
          let recommendationRead = ['menu_recommend', 'menu_show_recommendations'].includes(nativeOrderingToolName(toolCall.function.name))
          if (nativeOrderingToolName(toolCall.function.name) === 'browser_present') {
            try {
              const args = JSON.parse(toolCall.function.arguments)
              const publicCall = toolCall.function.name === 'point_to_menu_items'
              const subjects = publicCall ? args?.names : args?.productRefs
              const purpose = publicCall ? args?.purpose : args?.mode
              recommendationRead = purpose !== 'information' && Array.isArray(subjects) && subjects.length > 0
            }
            catch { /* Malformed calls still use the ordinary tool validator. */ }
          }
          if (recommendationPresented && toolCall.function.name === 'menu_get') {
            try {
              const args = JSON.parse(toolCall.function.arguments)
              if (args && typeof args === 'object') {
                const namedQuery = (typeof args.query === 'string' && args.query.trim()) || (typeof args.category === 'string' && args.category.trim()) || (Array.isArray(args.queries) && args.queries.length > 0)
                recommendationRead = args.display !== false && !namedQuery
              }
            }
            catch {
              // Malformed calls still use normal tool validation below.
            }
          }
          if (recommendationPresented && recommendationRead) {
            // Acknowledge the model's call ID without executing a second batch
            // or reporting another customer-visible receipt. This also covers
            // parallel requests already emitted before the tool list shrinks.
            toolResults.push({ content: JSON.stringify({ ok: true, dataOnly: true, recommendationAlreadyPresented: true }), name: toolCall.function.name, toolCallId: toolCall.id })
            callbacks.onToolActivity?.(toolCall.function.name, 'done')
            continue
          }
          const result = await executeTool({ captureToolErrors: true, messages: [], toolCall, tools: toolsForTurn })
          const content = serializeToolResultContent(result.message.content)
          let rejected = result.completionToolResult.isError
          let browserFailureReceipt = false
          lastBrowserWritePresentation = undefined
          try {
            const payload = JSON.parse(content)
            rejected ||= payload?.ok === false
            const outcome = browserToolResult(toolCall.function.name, payload).outcome
            browserQuestionIssued ||= nativeOrderingToolName(toolCall.function.name).startsWith('browser_') && outcome === 'awaiting_customer_answer'
            browserReplyReady ||= outcome === 'customer_reply_ready'
            batchSignInRequired ||= nativeOrderingToolName(toolCall.function.name).startsWith('browser_') && safeParse(browserSignInRequiredSchema, payload).success
            const presentation = safeParse(productPresentationSchema, payload?.presentation)
            if (!rejected && payload?.ok === true && payload.source === 'browser' && payload.status === 'verified' && ['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace', 'browser_confirm_add'].includes(nativeOrderingToolName(toolCall.function.name)) && presentation.success && presentation.output.cue === 'shown')
              lastBrowserWritePresentation = presentation.output
            browserFailureReceipt = payload?.source === 'browser' && payload?.ok === false
              && ['unknown', 'rejected'].includes(payload.status) && typeof payload.customerMessage === 'string'
              && (nativeOrderingToolName(toolCall.function.name).startsWith('browser_cart_') || toolCall.function.name === 'browser_confirm_add')
            if (!rejected && payload?.dataOnly !== true && Array.isArray(payload?.items) && (payload?.presentation?.kind === 'recommendation' || ['menu_recommend', 'menu_show_recommendations'].includes(nativeOrderingToolName(toolCall.function.name))))
              recommendationPresented = true
            if (!rejected && recommendationRead && payload?.ok === true && payload.source === 'browser' && payload.dataOnly !== true && presentation.success && presentation.output.products.length)
              recommendationPresented = true
          }
          catch {
            // Non-JSON tool prose is allowed by xsAI; only its error bit is
            // authoritative in that case, not a guessed success message.
          }
          // A definitive rejection or known partial browser effect still needs
          // its truthful customer explanation, without continuing/replaying it.
          if (!rejected || browserFailureReceipt)
            callbacks.onToolResult?.(toolCall.function.name, content)
          batchRejected ||= Boolean(rejected)
          callbacks.onToolActivity?.(toolCall.function.name, rejected ? 'error' : 'done')
          toolResults.push({
            content,
            name: toolCall.function.name,
            toolCallId: toolCall.id,
          })
        }
        if (control.manual) {
          // The cancelled continuation cannot persist these receipts. Preserve
          // accepted effects in this visitor's history without another model call.
          for (const result of toolResults)
            await append('tool_result', result.content, { name: result.name, source: 'manual_control' })
          return unfinished('manual-control')
        }
        if (signal.aborted)
          return unfinished('timeout')
        // Scope is unresolved: publish the owned question without another model
        // continuation that could replace it with a guessed search or answer.
        const scopeQuestion = browserQuestionIssued || browserReplyReady || toolResults.some((result) => {
          try {
            const payload = JSON.parse(result.content)
            const purpose = payload?.pendingCustomerChoice?.purpose
            return (nativeOrderingToolName(result.name).startsWith('browser_') && payload?.source === 'browser' && ['browser-product-choice', 'browser-order-quantity', 'browser-order-slot', 'browser-confirm-add', 'browser-service-question'].includes(purpose) && payload.dataOnly !== true)
              || (nativeOrderingToolName(result.name) === 'browser_respond' && payload?.ok === true && payload.source === 'browser' && payload.effect === 'none'
                && ((payload.customerBoundary === 'review-required' && payload.status === 'clarification') || payload.status === 'checkout-guidance'))
              || purpose === 'menu-query-scope' || (result.name === 'menu_confirm_item' && purpose === 'confirm-meal')
              || ((nativeOrderingToolName(result.name).startsWith('browser_cart_') || ['browser_product_get', 'browser_clarify_product', 'browser_search'].includes(nativeOrderingToolName(result.name))) && payload?.source === 'browser' && payload.status === 'clarification' && payload.effect === 'none' && payload.dataOnly !== true)
          }
          catch { return false }
        })
        if (scopeQuestion) {
          for (const result of toolResults)
            await append('tool_result', result.content, { name: result.name })
          return { agentMode, requestedTools, status: 'completed' }
        }
        const undispatchedCall = toolResults.some((result) => {
          try {
            const payload = JSON.parse(result.content)
            // Only the adapter's validation receipt proves that correcting
            // arguments cannot replay a dispatched cart operation.
            return payload?.code === 'TOOL_NOT_AVAILABLE'
              || (payload?.code === 'INVALID_TOOL_ARGUMENTS' && payload.source === 'browser'
                && payload.status === 'rejected' && payload.effect === 'none' && payload.dataOnly === true)
          }
          catch { return false }
        })
        const canCorrectCall = undispatchedCall && correctionBatches < 2 && toolResults.every((result) => {
          try {
            const payload = JSON.parse(result.content)
            return payload.effect === 'none' || (payload.ok === true && payload.dataOnly === true)
          }
          catch { return false }
        })
        if (canCorrectCall)
          correctionBatches++
        if (batchRejected && !canCorrectCall) {
          // Rejection is final for this task. Persist its receipts without
          // another model call that would log an unexecuted follow-up demand.
          for (const result of toolResults)
            await append('tool_result', result.content, { name: result.name })
          return unfinished(batchSignInRequired ? 'sign-in-required' : 'tool-rejected')
        }
        if (callbacks.isRequestComplete?.()) {
          // Persist every result before ending the loop. This shortcut requires
          // Host proof of whole-utterance coverage, not merely one tool success.
          for (const result of toolResults)
            await append('tool_result', result.content, { name: result.name })
          return { agentMode, requestedTools, status: 'completed' }
        }
        if (correctionBatches < 2 && toolResults.length && toolResults.every((result) => {
          try {
            const payload = JSON.parse(result.content)
            return nativeOrderingToolName(result.name).startsWith('browser_cart_') && payload?.source === 'browser' && payload.ok === true && payload.status === 'proposal_rejected' && payload.effect === 'none' && payload.dataOnly === true
          }
          catch { return false }
        })) {
          correctionBatches++
        }
        // Inquiry authority survives its read receipts. Mutation tasks keep the
        // existing first-request-only snapshot: their tools may change checkout
        // phase, so replaying that old snapshot would reintroduce stale state.
        await prepareRound()
        if (signal.aborted)
          return unfinished('timeout')
        const continuationTools = recommendationPresented ? toolDefinitions.filter(tool => !['menu_recommend', 'menu_show_recommendations'].includes(tool.function.name)) : toolDefinitions
        rounds++
        response = await streamKioskConversationMessage({ signal, toolResults, ...(decisionState ? { decisionState } : {}), tools: continuationTools, visitorSessionId: sessionId }, (event) => {
          if (signal.aborted || visitorSessionId.value !== sessionId)
            return
          if (event.type === 'turn-failed')
            transportReason = event.reason
          if (event.type === 'turn-started')
            callbacks.onTurnStarted?.()
          if (event.type === 'reply-progress')
            callbacks.onReplyProgress?.()
          if (event.type === 'assistant-delta')
            callbacks.onAssistantDelta?.(event.text)
          if (event.type === 'tool-requested')
            callbacks.onToolRequested?.(event.toolCall.function.name)
        })
        agentMode = response.agentMode
        if (control.manual)
          return unfinished('manual-control')
        // Persist the rejected receipt, but do not let generated success prose
        // or another automatic tool round conceal an unaccepted operation.
      }
      if (response.toolCalls.length && !control.manual && !signal.aborted && lastBrowserWritePresentation?.products.length && seenCalls.size + response.toolCalls.length <= 16 && new Set(response.toolCalls.map(call => call.id)).size === response.toolCalls.length) {
        // A verified write already displayed these exact products. A final
        // model cue (sometimes using the official name instead of its ref) is
        // redundant, not another purchase or proof that other requests finished.
        // Acknowledge only this no-effect case: mixed writes, new products and
        // malformed calls keep the ordinary budget failure below.
        const shown = new Set(lastBrowserWritePresentation.products.flatMap(product => [product.ref, product.name]))
        const redundant = response.toolCalls.every((call) => {
          if (seenCalls.has(call.id) || nativeOrderingToolName(call.function.name) !== 'browser_present' || !toolsForTurn.some(tool => tool.function.name === call.function.name))
            return false
          try {
            const input = JSON.parse(call.function.arguments)
            if (call.function.name === 'point_to_menu_items')
              return input?.purpose === 'information' && Array.isArray(input?.names) && input.names.length > 0 && input.names.every((name: unknown) => typeof name === 'string' && shown.has(name))
            const args = safeParse(browserPresentationInputSchema, input)
            return args.success && args.output.productRefs.length > 0 && args.output.productRefs.every(ref => shown.has(ref))
          }
          catch { return false }
        })
        if (redundant) {
          for (const call of response.toolCalls) {
            requestedTools.push(call.function.name)
            seenCalls.add(call.id)
            await append('tool_result', JSON.stringify({ ok: true, source: 'host', dataOnly: true, alreadyPresented: true, toolCallId: call.id, products: lastBrowserWritePresentation.products }), { name: call.function.name, source: 'host_presentation_dedup' })
            callbacks.onToolActivity?.(call.function.name, 'done')
          }
          return { agentMode, requestedTools, status: 'completed' }
        }
      }
      if (response.toolCalls.length)
        return unfinished(control.manual ? 'manual-control' : signal.aborted ? 'timeout' : 'tool-limit')
      return { answer: response.answer, reply: response.reply, agentMode, requestedTools, status: 'completed' }
    }
    catch {
      if (control.manual)
        return unfinished('manual-control')
      if (callbacks.signal?.aborted)
        return undefined
      error.value = '點餐助手暫時無法回覆。'
      return unfinished(deadline?.aborted ? 'timeout' : stage === 'context' ? 'context-unavailable' : transportReason)
    }
    finally {
      // Record orchestration latency (models, context refresh and browser tools),
      // separately from provider-round timing. Never attach an old turn to a new visitor.
      if (visitorSessionId.value === sessionId)
        await append('service_event', JSON.stringify({ kind: 'main_task_metrics', ...(metricTaskId ? { taskId: metricTaskId } : {}), ...(terminalReason ? { reason: terminalReason, failureStage: stage } : {}), durationMs: performance.now() - startedAt, modelRounds: rounds, requestedToolCount: requestedTools.length, interrupted: control.manual || control.controller.signal.aborted || deadline?.aborted === true || callbacks.signal?.aborted === true }), { source: 'main_task_metrics', utteranceId: callbacks.utteranceId })
      // An older cancelled turn cannot release its replacement's controls.
      if (activeControl === control) {
        activeControl = undefined
        controlState.value = 'idle'
      }
    }
  }

  async function runAssistantAction(
    serviceId: string,
    kind: 'greeting' | 'reminder',
    frame: string | undefined,
    signal?: AbortSignal,
    invitationAllowed = false,
    phase?: GreetingPhase,
  ) {
    const sessionId = await start(serviceId)
    if (!sessionId)
      return undefined

    try {
      return await sendKioskAssistantAction({ frame, kind, signal, invitationAllowed, ...(phase ? { phase } : {}), visitorSessionId: sessionId })
    }
    catch {
      if (signal?.aborted)
        return undefined
      error.value = '點餐助手暫時無法回覆。'
      return undefined
    }
  }

  async function recordOrderResult(result: InteractiveServiceOrderResult) {
    if (!visitorSessionId.value)
      return

    try {
      await recordKioskOrderResult({ ...result, visitorSessionId: visitorSessionId.value })
    }
    catch {
      error.value = '點餐結果暫時無法保存。'
    }
  }

  return {
    flush: () => pendingAppend,
    append,
    end,
    error: readonly(error),
    recordOrderResult,
    recordTranscript,
    requestManualControl,
    controlState: readonly(controlState),
    runAssistantAction,
    send,
    start,
    starting: readonly(starting),
    visitorSessionId: readonly(visitorSessionId),
  }
}

function serializeToolResultContent(content: unknown) {
  return typeof content === 'string' ? content : JSON.stringify(content) ?? ''
}
