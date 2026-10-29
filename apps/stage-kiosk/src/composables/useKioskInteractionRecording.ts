import type { InteractiveServiceOrderResult } from '@proj-airi/stage-shared/interaction-lifecycle'
import type { ContextReply } from '@proj-airi/stage-shared/kiosk-conversation'
import type { Tool } from '@xsai/shared-chat'

import type { KioskReplyFailureReason } from '../../../server/src/services/domain/kiosk-agent-interaction'
import type { GreetingPhase, InteractionMetadata } from '../../../server/src/services/domain/kiosk/interactionContracts'
import type { KioskAgentInteractionMode, KioskConversationDecisionState, KioskInteractionEntryKind, KioskToolDefinition } from '../services/kiosk-device'

import { serviceRecoveryLimits } from '@proj-airi/stage-shared/kiosk-conversation'
import { executeTool } from '@xsai/shared-chat'
import { rawTool } from '@xsai/tool'
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
  reason?: KioskReplyFailureReason | 'context-unavailable' | 'service-unavailable' | 'tool-rejected' | 'tool-limit' | 'duplicate-tool-call' | 'session-error' | 'manual-control'
}

interface ConversationPresentationCallbacks {
  taskId?: string
  budgetMs?: number
  onToolResult?: (toolName: string, content: string) => void
  utteranceId?: number
  decisionState?: KioskConversationDecisionState
  /** Reads this task's Menu facts; each model continuation must use a new snapshot. */
  prepareRound?: () => Promise<{ decisionState: KioskConversationDecisionState, tools: Tool[] }>
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
  let pendingStart: Promise<string | undefined> | undefined
  let pendingAppend: Promise<unknown> = Promise.resolve()

  async function start(serviceId: string) {
    if (visitorSessionId.value)
      return visitorSessionId.value
    if (pendingStart)
      return await pendingStart

    pendingStart = (async () => {
      starting.value = true
      error.value = undefined
      try {
        const { session } = await startKioskVisitorSession(serviceId)
        visitorSessionId.value = session.id
        return session.id
      }
      catch {
        error.value = '無法建立互動會話，請確認 kiosk 已取得發布設定。'
        return undefined
      }
      finally {
        starting.value = false
        pendingStart = undefined
      }
    })()
    return await pendingStart
  }

  async function append(kind: KioskInteractionEntryKind, content: string, metadata?: InteractionMetadata) {
    if (!visitorSessionId.value || !content.trim())
      return

    const sessionId = visitorSessionId.value
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
        error.value = '互動資料暫時無法保存。'
      }
    }
    const nextAppend = pendingAppend.then(save, save)
    pendingAppend = nextAppend.catch(() => undefined)
    return await nextAppend
  }

  async function end(state: 'completed' | 'cancelled' | 'idle') {
    if (!visitorSessionId.value)
      return

    try {
      await endKioskVisitorSession({ visitorSessionId: visitorSessionId.value, state })
      visitorSessionId.value = undefined
    }
    catch {
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
        status: requestedTools.length === 0 && ['provider-error', 'timeout', 'context-unavailable', 'service-unavailable'].includes(reason) ? 'failed' : 'incomplete',
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
      // The callback crosses the Menu IO seam. Replace facts/tool scope, never
      // accumulate snapshots or overwrite immutable read-only task authority.
      const prepareRound = async () => {
        stage = 'context'
        if (callbacks.prepareRound) {
          const current = await callbacks.prepareRound()
          decisionState = current.decisionState
          metricTaskId = current.decisionState.context?.taskId ?? metricTaskId
          toolsForTurn = [...current.tools, ...(!historyExhausted ? [historyTool] : [])]
        }
        toolsForTurn = toolsForTurn.filter(tool => !historyExhausted || tool.function.name !== 'kiosk_session_history')
        toolDefinitions = toolsForTurn.map(tool => ({ function: tool.function, type: 'function' }))
        stage = 'model'
      }
      // One deadline covers the entire Agent task, not a fresh budget per
      // continuation. It cancels model transport only, never an accepted POS
      // effect; browser tools settle through their own result boundary.
      deadline = AbortSignal.timeout(Math.min(serviceRecoveryLimits.turnMs, Math.max(1, callbacks.budgetMs ?? serviceRecoveryLimits.turnMs)))
      const signal = AbortSignal.any([control.controller.signal, deadline, ...(callbacks.signal ? [callbacks.signal] : [])])
      if (control.manual)
        return unfinished('manual-control')
      const seenCalls = new Set<string>()
      // One customer turn owns one displayed recommendation batch. Internal
      // evidence reads and named comparisons remain available after it; only a
      // new send() may admit another recommendation, including more:true.
      let recommendationPresented = false
      await prepareRound()
      if (signal.aborted)
        return unfinished('timeout')
      rounds++
      let response = await streamKioskConversationMessage({ content, utteranceId: callbacks.utteranceId, ...(decisionState ? { decisionState } : {}), signal, tools: toolDefinitions, visitorSessionId: sessionId }, (event) => {
        if (event.type === 'turn-failed')
          transportReason = event.reason
        if (event.type === 'turn-started')
          callbacks.onTurnStarted?.()
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
      for (let round = 0; response.toolCalls.length > 0 && round < 4; round++) {
        if (seenCalls.size + response.toolCalls.length > 16 || signal.aborted)
          break
        const toolResults = []
        let batchRejected = false
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
          if (!toolsForTurn.some(tool => tool.function.name === toolCall.function.name))
            return unfinished('tool-rejected')
          requestedTools.push(toolCall.function.name)
          stage = 'tool'
          callbacks.onToolActivity?.(toolCall.function.name, 'executing')
          if (control.manual)
            break
          if (signal.aborted)
            return callbacks.signal?.aborted ? undefined : unfinished('timeout')
          let recommendationRead = ['menu_recommend', 'menu_show_recommendations'].includes(toolCall.function.name)
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
          try {
            const payload = JSON.parse(content)
            rejected ||= payload?.ok === false
            if (!rejected && payload?.dataOnly !== true && Array.isArray(payload?.items) && (payload?.presentation?.kind === 'recommendation' || ['menu_recommend', 'menu_show_recommendations'].includes(toolCall.function.name)))
              recommendationPresented = true
          }
          catch {
            // Non-JSON tool prose is allowed by xsAI; only its error bit is
            // authoritative in that case, not a guessed success message.
          }
          if (!rejected)
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
        const scopeQuestion = toolResults.some((result) => {
          try {
            const purpose = JSON.parse(result.content)?.pendingCustomerChoice?.purpose
            return purpose === 'menu-query-scope' || (result.name === 'menu_confirm_item' && purpose === 'confirm-meal')
          }
          catch { return false }
        })
        if (scopeQuestion) {
          for (const result of toolResults)
            await append('tool_result', result.content, { name: result.name })
          return { agentMode, requestedTools, status: 'completed' }
        }
        if (batchRejected) {
          // Rejection is final for this task. Persist its receipts without
          // another model call that would log an unexecuted follow-up demand.
          for (const result of toolResults)
            await append('tool_result', result.content, { name: result.name })
          return unfinished('tool-rejected')
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
          if (event.type === 'turn-failed')
            transportReason = event.reason
          if (event.type === 'turn-started')
            callbacks.onTurnStarted?.()
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
        await append('service_event', JSON.stringify({ kind: 'main_task_metrics', ...(metricTaskId ? { taskId: metricTaskId } : {}), ...(terminalReason ? { reason: terminalReason, failureStage: stage } : {}), durationMs: performance.now() - startedAt, modelRounds: rounds, requestedToolCount: requestedTools.length, interrupted: control.manual || control.controller.signal.aborted || deadline?.aborted === true || callbacks.signal?.aborted === true }), { source: 'main_task_metrics' })
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
