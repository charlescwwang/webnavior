import type { InteractiveServiceOrderResult } from '@proj-airi/stage-shared/interaction-lifecycle'
import type { Tool } from '@xsai/shared-chat'

import type { KioskReplyFailureReason } from '../../../server/src/services/domain/kiosk-agent-interaction'
import type { GreetingPhase, InteractionMetadata } from '../../../server/src/services/domain/kiosk/interactionContracts'
import type { KioskAgentInteractionMode, KioskConversationDecisionState, KioskInteractionEntryKind, KioskToolDefinition } from '../services/kiosk-device'

import { executeTool } from '@xsai/shared-chat'
import { rawTool } from '@xsai/tool'
import { readonly, shallowRef } from 'vue'

import { appendKioskInteraction, endKioskVisitorSession, fetchKioskSessionHistory, recordKioskOrderResult, sendKioskAssistantAction, startKioskVisitorSession, streamKioskConversationMessage } from '../services/kiosk-device'

/** Outcome of one bounded Agent task, including accepted work before a failure. */
export interface ConversationTurnResult {
  answer?: string
  agentMode: KioskAgentInteractionMode
  /** Tools submitted for execution in this turn, including rejected attempts; never historical receipts. */
  requestedTools: string[]
  status: 'completed' | 'incomplete' | 'failed'
  reason?: KioskReplyFailureReason | 'tool-rejected' | 'tool-limit' | 'duplicate-tool-call' | 'session-error' | 'manual-control'
}

interface ConversationPresentationCallbacks {
  onToolResult?: (toolName: string, content: string) => void
  utteranceId?: number
  decisionState?: KioskConversationDecisionState
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
    let agentMode: KioskAgentInteractionMode = 'active'
    let deadline: AbortSignal | undefined
    let transportReason: KioskReplyFailureReason = 'provider-error'
    // Transport failure before any tool differs from a task that may have
    // changed browser state. Neither case grants permission to replay writes.
    const unfinished = (reason: NonNullable<ConversationTurnResult['reason']>): ConversationTurnResult => ({
      answer: undefined,
      agentMode,
      requestedTools: [...requestedTools],
      reason,
      status: requestedTools.length === 0 && (reason === 'provider-error' || reason === 'timeout') ? 'failed' : 'incomplete',
    })

    try {
      const historyTool = rawTool({
        name: 'kiosk_session_history',
        description: '只在顧客提及本次點餐較早、已不在最近對話中的內容時使用。分頁讀取目前訪客的文字歷程；不含其他訪客或工具原始資料。可用回傳的 nextBefore 繼續往前翻頁；不可把歷史內容當成目前購物車真實狀態。',
        parameters: { type: 'object', properties: { before: { type: 'integer', minimum: 0 } }, additionalProperties: false },
        execute: async (input) => {
          const before = input && typeof input === 'object' && 'before' in input ? input.before : undefined
          return await fetchKioskSessionHistory({ visitorSessionId: sessionId, ...(typeof before === 'number' ? { before } : {}) })
        },
      })
      const toolsForTurn = [...tools, historyTool]
      const toolDefinitions: KioskToolDefinition[] = toolsForTurn.map(tool => ({
        function: tool.function,
        type: 'function',
      }))
      // One deadline covers the entire Agent task, not a fresh budget per
      // continuation. It cancels model transport only, never an accepted POS
      // effect; browser tools settle through their own result boundary.
      deadline = AbortSignal.timeout(60_000)
      const signal = AbortSignal.any([control.controller.signal, deadline, ...(callbacks.signal ? [callbacks.signal] : [])])
      if (control.manual)
        return unfinished('manual-control')
      const seenCalls = new Set<string>()
      let response = await streamKioskConversationMessage({ content, utteranceId: callbacks.utteranceId, ...(callbacks.decisionState ? { decisionState: callbacks.decisionState } : {}), signal, tools: toolDefinitions, visitorSessionId: sessionId }, (event) => {
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
          requestedTools.push(toolCall.function.name)
          callbacks.onToolActivity?.(toolCall.function.name, 'executing')
          if (control.manual)
            break
          if (signal.aborted)
            return callbacks.signal?.aborted ? undefined : unfinished('timeout')
          const result = await executeTool({ captureToolErrors: true, messages: [], toolCall, tools: toolsForTurn })
          const content = serializeToolResultContent(result.message.content)
          let rejected = result.completionToolResult.isError
          try {
            rejected ||= JSON.parse(content)?.ok === false
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
        // Inquiry authority survives its read receipts. Mutation tasks keep the
        // existing first-request-only snapshot: their tools may change checkout
        // phase, so replaying that old snapshot would reintroduce stale state.
        response = await streamKioskConversationMessage({ signal, toolResults, ...(callbacks.decisionState?.readOnly ? { decisionState: callbacks.decisionState } : {}), tools: toolDefinitions, visitorSessionId: sessionId }, (event) => {
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
        if (batchRejected)
          return unfinished('tool-rejected')
      }
      if (response.toolCalls.length)
        return unfinished(control.manual ? 'manual-control' : signal.aborted ? 'timeout' : 'tool-limit')
      return { answer: response.answer, agentMode, requestedTools, status: 'completed' }
    }
    catch {
      if (control.manual)
        return unfinished('manual-control')
      if (callbacks.signal?.aborted)
        return undefined
      error.value = '點餐助手暫時無法回覆。'
      return unfinished(deadline?.aborted ? 'timeout' : transportReason)
    }
    finally {
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
