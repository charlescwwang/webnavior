import { readonly, shallowRef } from 'vue'

export interface ScenarioToolDefinition {
  description: string
  inputSchema: Record<string, unknown>
  name: string
}

export interface ScenarioManifest {
  /** Stable external service identifier, such as `restaurant-ordering` or `patient-registration`. */
  id: string
  /** Customer-facing title rendered by the generic kiosk surface. */
  title: string
  /** Trusted, scenario-specific instruction appended to the AIRI system prompt. */
  agentPrompt: string
  tools: ScenarioToolDefinition[]
  session?: {
    /** Host-only cleanup call; it is never registered as an LLM tool. */
    reset?: { args?: Record<string, unknown>, name: string }
  }
}

export type ScenarioBridgeEvent = 'activity' | 'completed'

interface PendingCall {
  reject: (reason: Error) => void
  resolve: (value: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}

interface ScenarioResultMessage {
  error?: string
  requestId: string
  result?: unknown
  source: 'airi-scenario-bridge'
  type: 'scenario:result'
}

interface ScenarioReadyMessage {
  manifest: ScenarioManifest
  source: 'airi-scenario-bridge'
  type: 'scenario:ready'
}

interface ScenarioEventMessage {
  event: ScenarioBridgeEvent
  source: 'airi-scenario-bridge'
  type: 'scenario:event'
}

export interface ScenarioBridgeOptions {
  serviceUrl: string
}

const callTimeoutMs = 12_000
const readyTimeoutMs = 5_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isManifest(value: unknown): value is ScenarioManifest {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || typeof value.agentPrompt !== 'string'
    || !Array.isArray(value.tools)) {
    return false
  }

  return value.tools.every(tool => isRecord(tool)
    && typeof tool.name === 'string'
    && typeof tool.description === 'string'
    && isRecord(tool.inputSchema))
}

function createReadyPromise() {
  let resolveReady: ((manifest: ScenarioManifest) => void) | undefined
  const readyPromise = new Promise<ScenarioManifest>((resolve) => {
    resolveReady = resolve
  })
  return { readyPromise, resolveReady }
}

/**
 * Bridges one independently deployed interactive scenario into the kiosk.
 *
 * The host knows only the protocol: a trusted scenario service declares its
 * own tools, customer prompt, lifecycle events, and optional reset operation.
 * Domain concepts such as carts, doctors, or appointments stay outside AIRI.
 */
export function createScenarioBridge(options: ScenarioBridgeOptions) {
  const serviceOrigin = new URL(options.serviceUrl).origin
  const manifest = shallowRef<ScenarioManifest>()
  const pendingCalls = new Map<string, PendingCall>()
  const eventListeners = new Set<(event: ScenarioBridgeEvent) => void>()
  let frameWindow: Window | null = null
  let readyState = createReadyPromise()
  let callQueue = Promise.resolve()

  function rejectPendingCalls(reason: Error) {
    for (const [requestId, pending] of pendingCalls) {
      clearTimeout(pending.timeoutId)
      pendingCalls.delete(requestId)
      pending.reject(reason)
    }
  }

  function onMessage(event: MessageEvent<ScenarioReadyMessage | ScenarioResultMessage | ScenarioEventMessage | { source: string, type: string }>) {
    // Multiple registered scenarios may share one origin. Origin validation on
    // its own would let an inactive sibling iframe impersonate the active
    // page, so bind every bridge message to its actual iframe window as well.
    if (event.origin !== serviceOrigin || event.source !== frameWindow || event.data?.source !== 'airi-scenario-bridge')
      return

    if (event.data.type === 'scenario:ready') {
      const ready = event.data as ScenarioReadyMessage
      if (!isManifest(ready.manifest)) {
        console.error('[stage-kiosk] scenario service announced an invalid manifest.')
        return
      }
      manifest.value = ready.manifest
      readyState.resolveReady?.(ready.manifest)
      return
    }

    if (event.data.type === 'scenario:event') {
      const scenarioEvent = event.data as ScenarioEventMessage
      eventListeners.forEach(listener => listener(scenarioEvent.event))
      return
    }

    if (event.data.type !== 'scenario:result')
      return

    const result = event.data as ScenarioResultMessage
    const pending = pendingCalls.get(result.requestId)
    if (!pending)
      return

    pendingCalls.delete(result.requestId)
    clearTimeout(pending.timeoutId)
    if (result.error) {
      pending.reject(new Error(result.error))
      return
    }
    pending.resolve(result.result)
  }

  window.addEventListener('message', onMessage)

  async function waitForManifest() {
    if (manifest.value)
      return manifest.value

    return await Promise.race([
      readyState.readyPromise,
      new Promise<ScenarioManifest>((_, reject) => setTimeout(() => reject(new Error('Scenario service did not become ready. Start the configured scenario service first.')), readyTimeoutMs)),
    ])
  }

  async function callRemoteScenario(name: string, args: Record<string, unknown>) {
    await waitForManifest()
    if (!frameWindow)
      throw new Error('Scenario service iframe is not available.')

    const requestId = crypto.randomUUID()
    return await new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingCalls.delete(requestId)
        reject(new Error(`Scenario service did not respond to "${name}" within ${callTimeoutMs / 1000} seconds.`))
      }, callTimeoutMs)
      pendingCalls.set(requestId, { resolve, reject, timeoutId })
      frameWindow?.postMessage({
        source: 'airi-scenario-bridge',
        type: 'scenario:call',
        requestId,
        name,
        args,
      }, serviceOrigin)
    })
  }

  async function call(name: string, args: Record<string, unknown> = {}) {
    // Scenario mutations can be stateful. Serialize calls so the service
    // observes the same order in which the model issued its tool calls.
    const queuedCall = callQueue.then(
      async () => await callRemoteScenario(name, args),
      async () => await callRemoteScenario(name, args),
    )
    callQueue = queuedCall.then(() => undefined, () => undefined)
    return await queuedCall
  }

  async function reset() {
    const currentManifest = await waitForManifest()
    const resetCommand = currentManifest.session?.reset
    if (!resetCommand)
      return
    await call(resetCommand.name, resetCommand.args)
  }

  return {
    manifest: readonly(manifest),
    serviceUrl: options.serviceUrl,
    attach(windowRef: Window | null) {
      frameWindow = windowRef
    },
    call,
    on(event: ScenarioBridgeEvent, listener: () => void) {
      const wrappedListener = (received: ScenarioBridgeEvent) => {
        if (received === event)
          listener()
      }
      eventListeners.add(wrappedListener)
      return () => eventListeners.delete(wrappedListener)
    },
    reset,
    resetForIframeReload() {
      rejectPendingCalls(new Error('Scenario service reloaded before completing the tool call.'))
      manifest.value = undefined
      readyState = createReadyPromise()
    },
    waitForManifest,
  }
}
