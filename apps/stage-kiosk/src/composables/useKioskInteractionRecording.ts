import type { KioskInteractionEntryKind } from '../services/kiosk-device'
import type { InteractiveServiceOrderResult } from '../services/scenario-registry'

import { readonly, shallowRef } from 'vue'

import { appendKioskInteraction, endKioskVisitorSession, recordKioskOrderResult, sendKioskAssistantAction, sendKioskConversationMessage, startKioskVisitorSession } from '../services/kiosk-device'

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
  let pendingAppend = Promise.resolve()

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
        await appendKioskInteraction({
          visitorSessionId: sessionId,
          kind,
          content,
          ...(metadata ? { metadata } : {}),
        })
      }
      catch {
        error.value = '互動資料暫時無法保存。'
      }
    }
    const nextAppend = pendingAppend.then(save, save)
    pendingAppend = nextAppend.catch(() => undefined)
    await nextAppend
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

  async function send(serviceId: string, content: string) {
    const sessionId = await start(serviceId)
    if (!sessionId)
      return undefined

    try {
      const { answer } = await sendKioskConversationMessage({ visitorSessionId: sessionId, content })
      return answer
    }
    catch {
      error.value = '點餐助手暫時無法回覆。'
      return undefined
    }
  }

  async function runAssistantAction(serviceId: string, kind: 'greeting' | 'reminder') {
    const sessionId = await start(serviceId)
    if (!sessionId)
      return undefined

    try {
      const { answer } = await sendKioskAssistantAction({ kind, visitorSessionId: sessionId })
      return answer
    }
    catch {
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
