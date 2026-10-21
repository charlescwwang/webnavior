import type { ServiceTool, ToolExecution } from '@proj-airi/stage-shared/interactive-service'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { errorMessageFrom } from '@moeru/std'
import { discoverService, discoveryResultSchema, executeServiceTool, executionResultSchema, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'
import { parse } from 'valibot'
import { readonly, shallowRef, toRaw } from 'vue'

export type ServiceAvailability = 'idle' | 'loading' | 'ready' | 'unavailable'

/** Owns exactly one iframe binding. Switching documents aborts pending RPC, never retries writes. */
export function createInteractiveServiceClient() {
  const availability = shallowRef<ServiceAvailability>('idle')
  const tools = shallowRef<readonly ServiceTool[]>([])
  const error = shallowRef<string>()
  const unavailableReason = shallowRef<'connection-failed'>()
  const completionRevision = shallowRef(0)
  const listeners = new Set<(event: ToolExecution) => void>()
  let connection: ReturnType<typeof createContext> | undefined
  let binding: { connectionId: string, documentId: string, toolsRevision: number } | undefined
  let readiness: Promise<void> | undefined
  let activeUrl: string | undefined
  let activeWindow: Window | undefined

  function publish(event: ToolExecution) {
    listeners.forEach(listener => listener(event))
  }

  function activate(serviceUrl?: string, frameWindow?: Window | null) {
    connection?.dispose(new Error('互動服務頁面已切換。'))
    connection = undefined
    binding = undefined
    readiness = undefined
    tools.value = []
    error.value = undefined
    unavailableReason.value = undefined
    activeUrl = serviceUrl
    activeWindow = frameWindow ?? undefined
    availability.value = 'idle'
    if (!serviceUrl || !frameWindow)
      return
    const origin = new URL(serviceUrl).origin
    const current = createContext({
      channel: interactiveServiceChannel,
      currentWindow: window,
      targetWindow: () => frameWindow,
      expectedSource: () => frameWindow,
      targetOrigin: origin,
      expectedOrigin: origin,
    })
    connection = current
    availability.value = 'loading'
    const connectionId = crypto.randomUUID()
    const challenge = crypto.randomUUID()
    const discover = defineInvoke(current.context, discoverService)
    readiness = (async () => {
      const deadline = Date.now() + 5000
      // Only discovery may retry: the catalog/listener can become ready after iframe load.
      while (!current.context.signal.aborted) {
        const attemptSignal = AbortSignal.timeout(Math.min(500, Math.max(1, deadline - Date.now())))
        try {
          const response = parse(discoveryResultSchema, await discover({ version: 1, connectionId, challenge }, {
            signal: attemptSignal,
          }))
          if (connection !== current)
            throw new Error('互動服務頁面已切換。')
          if (response.connectionId !== connectionId || response.challenge !== challenge || response.tools.length === 0)
            throw new Error('互動服務連線驗證失敗。')
          if (new Set(response.tools.map(tool => tool.name)).size !== response.tools.length)
            throw new Error('互動服務工具名稱重複。')
          binding = { connectionId, documentId: response.documentId, toolsRevision: response.toolsRevision }
          tools.value = response.tools.map(tool => ({ ...tool, origin }))
          availability.value = 'ready'
          return
        }
        catch (caught) {
          if (current.context.signal.aborted || Date.now() >= deadline)
            throw caught
          // A well-formed error indicates an incompatible service, not a missing listener.
          if (!attemptSignal.aborted)
            throw caught
        }
      }
      throw new Error('互動服務連線已結束。')
    })().catch((caught) => {
      if (connection === current) {
        tools.value = []
        availability.value = 'unavailable'
        unavailableReason.value = 'connection-failed'
        error.value = '無法連接互動服務，請確認菜單已載入或直接操作畫面。'
        current.dispose(caught)
      }
      throw caught
    })
    // Activation is driven by DOM events; waitUntilReady remains the explicit error boundary.
    void readiness.catch(() => {})
  }

  async function execute(tool: ServiceTool, input: Record<string, unknown>) {
    const current = connection
    const currentBinding = binding
    if (!current || !currentBinding || availability.value !== 'ready')
      throw new Error(error.value ?? '互動服務尚未連線。')
    // Public descriptors are readonly Vue views; compare the underlying identity
    // so a retained descriptor from another activation cannot regain admission.
    if (!tools.value.includes(toRaw(tool)))
      throw new Error('工具已失效，請重新確認目前菜單。')
    const operationId = crypto.randomUUID()
    publish({ phase: 'called', tool, input })
    try {
      // Native execution serialized JSON before reaching the page. Preserve that
      // contract and remove Vue proxies before structured-clone based transport.
      const serializedInput = JSON.parse(JSON.stringify(input))
      const response = parse(executionResultSchema, await defineInvoke(current.context, executeServiceTool)({
        ...currentBinding,
        operationId,
        name: tool.name,
        input: serializedInput,
      }, { signal: AbortSignal.timeout(60_000) }))
      if (connection !== current || response.connectionId !== currentBinding.connectionId || response.documentId !== currentBinding.documentId || response.operationId !== operationId)
        throw new Error('工具回應不屬於目前頁面。')
      const result = response.result
      if (result && typeof result === 'object' && 'interaction' in result && result.interaction && typeof result.interaction === 'object' && 'status' in result.interaction && result.interaction.status === 'completed')
        completionRevision.value++
      publish({ phase: 'resolved', tool, input, result })
      return result
    }
    catch (caught) {
      if (connection === current) {
        publish({ phase: 'failed', tool, input, error: errorMessageFrom(caught) ?? '工具執行結果無法確認。' })
        // A lost receipt can hide a committed write. Revoke admission; do not retry or unlock it.
        error.value = '工具執行結果無法確認，請確認目前畫面後再繼續。'
        availability.value = 'unavailable'
        unavailableReason.value = 'connection-failed'
        tools.value = []
        current.dispose(caught)
      }
      throw caught
    }
  }

  return {
    activate,
    availability: readonly(availability),
    completionRevision: readonly(completionRevision),
    error: readonly(error),
    unavailableReason: readonly(unavailableReason),
    tools: readonly(tools),
    execute,
    refresh: () => activate(activeUrl, activeWindow),
    waitUntilReady: async () => {
      await readiness
      if (availability.value === 'unavailable')
        throw new Error(error.value)
    },
    onExecution: (listener: (event: ToolExecution) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
