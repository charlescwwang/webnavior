import type { Tool } from '@xsai/shared-chat'

import type { KioskInteractionEntryKind, KioskToolCall, KioskToolDefinition } from '../services/kiosk-device'
import type { InteractiveServiceOrderResult } from '../services/scenario-registry'

import { executeTool } from '@xsai/shared-chat'
import { readonly, shallowRef } from 'vue'

import { appendKioskInteraction, endKioskVisitorSession, recordKioskOrderResult, sendKioskAssistantAction, startKioskVisitorSession, streamKioskConversationMessage } from '../services/kiosk-device'

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

  async function append(kind: KioskInteractionEntryKind, content: string, metadata?: Record<string, unknown>) {
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
    onToolActivity?: (toolName: string, state: 'executing' | 'done' | 'error') => void,
    signal?: AbortSignal,
    onAssistantDelta?: (text: string) => void,
  ) {
    const sessionId = await start(serviceId)
    if (!sessionId)
      return undefined

    try {
      const toolDefinitions: KioskToolDefinition[] = tools.map(tool => ({
        function: tool.function,
        type: 'function',
      }))
      let response = await streamKioskConversationMessage({ content, signal, tools: toolDefinitions, visitorSessionId: sessionId }, (event) => {
        if (event.type === 'assistant-delta')
          onAssistantDelta?.(event.text)
      })
      // A browser-owned WebMCP tool cannot execute on the Server. Keep the
      // model credentials server-side while returning each requested call to
      // this kiosk, then resume the same persisted conversation with its result.
      for (let round = 0; response.toolCalls.length > 0 && round < 4; round++) {
        const toolResults = await Promise.all(response.toolCalls.map(async (toolCall: KioskToolCall) => {
          onToolActivity?.(toolCall.function.name, 'executing')
          const result = await executeTool({ captureToolErrors: true, messages: [], toolCall, tools })
          onToolActivity?.(toolCall.function.name, result.completionToolResult.isError ? 'error' : 'done')
          return {
            content: serializeToolResultContent(result.message.content),
            name: toolCall.function.name,
            toolCallId: toolCall.id,
          }
        }))
        if (signal?.aborted)
          return undefined
        response = await streamKioskConversationMessage({ signal, toolResults, tools: toolDefinitions, visitorSessionId: sessionId }, (event) => {
          if (event.type === 'assistant-delta')
            onAssistantDelta?.(event.text)
        })
      }
      return { answer: response.answer, agentMode: response.agentMode }
    }
    catch {
      error.value = '點餐助手暫時無法回覆。'
      return undefined
    }
  }

  async function runAssistantAction(
    serviceId: string,
    kind: 'greeting' | 'reminder',
    frame: string | undefined,
    signal?: AbortSignal,
  ) {
    const sessionId = await start(serviceId)
    if (!sessionId)
      return undefined

    try {
      const { answer } = await sendKioskAssistantAction({ frame, kind, signal, visitorSessionId: sessionId })
      return answer
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
    append,
    end,
    error: readonly(error),
    recordOrderResult,
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
