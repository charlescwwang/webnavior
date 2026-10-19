import { errorMessageFrom } from '@moeru/std'
import { webMcpHealthResultSchema, webMcpHealthTool } from '@proj-airi/stage-shared/webmcp'
import { safeParse } from 'valibot'
import { readonly, shallowRef, watch } from 'vue'

export type WebMcpAvailability = 'idle' | 'loading' | 'ready' | 'unavailable'
/** Stable host-facing reasons for retaining manual interaction instead of admitting tools. */
export type WebMcpUnavailableReason = 'unsupported-browser' | 'missing-health-check' | 'compatibility-check-failed' | 'discovery-failed' | 'no-tools'

/** A Vue-safe description of a native WebMCP tool discovered from an approved iframe origin. */
export interface WebMcpTool {
  annotations?: { readOnlyHint?: boolean, untrustedContentHint?: boolean }
  description: string
  inputSchema: Record<string, unknown>
  name: string
  origin: string
  title?: string
}

/** One native WebMCP execution observed by the host after origin validation. */
export interface WebMcpToolExecution {
  error?: string
  input: Record<string, unknown>
  phase: 'called' | 'failed' | 'resolved'
  result?: unknown
  tool: WebMcpTool
}

/** A browser-issued tool handle. Its `window` belongs to an iframe and must never enter Vue reactivity. */
interface RegisteredWebMcpTool extends Omit<WebMcpTool, 'inputSchema'> {
  inputSchema: string | Record<string, unknown>
  window: Window
}

interface ModelContextLike {
  executeTool: (tool: RegisteredWebMcpTool, inputObject: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<string | null>
  getTools: (options?: { fromOrigins?: string[] }) => Promise<RegisteredWebMcpTool[]>
  /** Some WebMCP implementations notify hosts when a frame changes its tools. */
  addEventListener?: (type: 'toolchange', listener: () => void) => void
}

const readyTimeoutMs = 5_000

// A browser implementation can ignore cancellation. Race it locally as well so
// iframe replacement and the discovery deadline always settle pending waiters.
async function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let onAbort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, cancelled])
  }
  finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function modelContext(): ModelContextLike | undefined {
  return (globalThis.document as Document & { modelContext?: ModelContextLike } | undefined)?.modelContext
}

function resultFromWebMcp(result: string | null): unknown {
  if (result === null)
    return null
  try {
    return JSON.parse(result)
  }
  catch {
    return result
  }
}

function isCompletionResult(result: unknown) {
  if (!result || typeof result !== 'object')
    return false

  const interaction = (result as Record<string, unknown>).interaction
  if (!interaction || typeof interaction !== 'object')
    return false

  return (interaction as Record<string, unknown>).status === 'completed'
}

function toolKey(tool: Pick<WebMcpTool, 'name' | 'origin'>) {
  return `${tool.origin}\u0000${tool.name}`
}

function inputSchemaFrom(tool: RegisteredWebMcpTool): Record<string, unknown> {
  // Native WebMCP discovery serializes schemas as JSON text. Agent tool
  // builders need the parsed object; spreading the string creates numeric
  // character keys instead of JSON Schema fields.
  const schema: unknown = typeof tool.inputSchema === 'string' ? JSON.parse(tool.inputSchema) : tool.inputSchema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || (schema as Record<string, unknown>).type !== 'object')
    throw new Error(`Invalid input schema for WebMCP tool "${tool.name}".`)
  return schema as Record<string, unknown>
}

/** Copies browser tool metadata into a Vue-safe descriptor without its cross-origin Window handle. */
function descriptorFrom(tool: RegisteredWebMcpTool): WebMcpTool {
  return {
    annotations: tool.annotations ? { ...tool.annotations } : undefined,
    description: tool.description,
    inputSchema: inputSchemaFrom(tool),
    name: tool.name,
    origin: tool.origin,
    title: tool.title,
  }
}

/**
 * Discovers and executes native WebMCP tools from the active approved iframe.
 *
 * Call {@link activate} after the host iframe has loaded. The adapter only
 * exposes tools from that URL's origin after a side-effect-free compatibility
 * probe passes. It has no postMessage tool fallback or business-action retry.
 */
export function createWebMcpAdapter() {
  const availability = shallowRef<WebMcpAvailability>('idle')
  const completionRevision = shallowRef(0)
  const error = shallowRef<string>()
  const unavailableReason = shallowRef<WebMcpUnavailableReason>()
  const tools = shallowRef<readonly WebMcpTool[]>([])
  const registeredTools = new Map<string, RegisteredWebMcpTool>()
  const executionListeners = new Set<(execution: WebMcpToolExecution) => void>()
  let allowedOrigin: string | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let refreshRevision = 0
  let discoveryController: AbortController | undefined
  // Each activation owns its discovery and readiness waiters. Changing pages
  // invalidates both, even when the replacement has the same origin.
  const generation = shallowRef(0)

  function clearTimeoutState() {
    if (timeoutId)
      clearTimeout(timeoutId)
    timeoutId = undefined
  }

  function fail(reason: WebMcpUnavailableReason, message: string) {
    clearTimeoutState()
    tools.value = []
    registeredTools.clear()
    unavailableReason.value = reason
    error.value = message
    availability.value = 'unavailable'
  }

  async function refresh() {
    const previouslyReady = availability.value === 'ready'
    const currentGeneration = generation.value
    const currentRevision = ++refreshRevision
    discoveryController?.abort(new Error('WebMCP discovery was replaced.'))
    discoveryController = undefined
    clearTimeoutState()
    const context = modelContext()
    if (!context?.getTools || !context.executeTool || !allowedOrigin) {
      tools.value = []
      registeredTools.clear()
      availability.value = allowedOrigin ? 'unavailable' : 'idle'
      error.value = allowedOrigin ? '此瀏覽器不支援 WebMCP。' : undefined
      unavailableReason.value = allowedOrigin ? 'unsupported-browser' : undefined
      return
    }

    const controller = new AbortController()
    discoveryController = controller
    // Every refresh revokes admission until this origin's new handles pass the
    // transport probe. No domain tool runs during discovery or compatibility checks.
    availability.value = 'loading'
    unavailableReason.value = undefined
    tools.value = []
    registeredTools.clear()
    error.value = undefined
    let checkingCompatibility = false
    timeoutId = setTimeout(() => {
      if (currentGeneration !== generation.value || currentRevision !== refreshRevision)
        return
      const message = checkingCompatibility ? 'WebMCP 相容性檢查逾時，請直接操作服務畫面。' : '互動服務尚未提供 WebMCP tools。'
      console.warn('[webmcp] timeout:', message)
      fail(checkingCompatibility ? 'compatibility-check-failed' : 'no-tools', message)
      controller.abort(new Error(message))
    }, readyTimeoutMs)
    try {
      const discovered = await untilAborted(context.getTools({ fromOrigins: [allowedOrigin] }), controller.signal)
      if (currentGeneration !== generation.value || currentRevision !== refreshRevision)
        return
      const availableTools = discovered.filter(tool => tool.origin === allowedOrigin)
      const healthTool = availableTools.find(tool => tool.name === webMcpHealthTool.name)
      const businessTools = availableTools.filter(tool => tool.name !== webMcpHealthTool.name)
      // Tools can arrive incrementally during service registration. Keep the
      // bounded discovery grace period until at least one business tool exists.
      if (businessTools.length === 0) {
        if (previouslyReady)
          fail('no-tools', '互動服務尚未提供 WebMCP tools。')
        return
      }
      checkingCompatibility = true
      if (!healthTool) {
        fail('missing-health-check', '互動服務未提供相容性檢查，請更新服務或直接操作畫面。')
        return
      }
      // Correlate the echo with this activation AND discovery revision; a
      // response from a previous iframe or refresh cannot grant admission.
      const challenge = `${currentGeneration}:${currentRevision}`
      const response = await untilAborted(context.executeTool(healthTool, { challenge }, { signal: controller.signal }), controller.signal)
      const acknowledgement = safeParse(webMcpHealthResultSchema, resultFromWebMcp(response))
      if (currentGeneration !== generation.value || currentRevision !== refreshRevision)
        return
      if (!acknowledgement.success || acknowledgement.output.challenge !== challenge)
        throw new Error('WebMCP 相容性檢查回應格式不符，請更新瀏覽器或服務。')
      const descriptors = businessTools.map(descriptorFrom)
      for (const tool of businessTools)
        registeredTools.set(toolKey(tool), tool)
      tools.value = descriptors
      clearTimeoutState()
      availability.value = 'ready'
      error.value = undefined
    }
    catch (caught) {
      if (currentGeneration !== generation.value || currentRevision !== refreshRevision)
        return
      console.warn('[webmcp] compatibility check failed:', caught)
      fail(checkingCompatibility ? 'compatibility-check-failed' : 'discovery-failed', errorMessageFrom(caught) ?? '無法取得互動服務的 WebMCP tools。')
    }
  }

  function activate(serviceUrl: string | undefined) {
    generation.value++
    discoveryController?.abort(new Error('WebMCP document was deactivated.'))
    discoveryController = undefined
    clearTimeoutState()
    tools.value = []
    registeredTools.clear()
    error.value = undefined
    unavailableReason.value = undefined
    allowedOrigin = serviceUrl ? new URL(serviceUrl).origin : undefined
    if (!allowedOrigin) {
      availability.value = 'idle'
      return
    }

    availability.value = 'loading'
    void refresh()
  }

  async function execute(tool: WebMcpTool, input: Record<string, unknown>) {
    if (availability.value !== 'ready')
      throw new Error(error.value ?? 'WebMCP 相容性檢查尚未完成，請直接操作服務畫面。')
    const context = modelContext()
    if (!context)
      throw new Error('此瀏覽器不支援 WebMCP。')
    const registeredTool = registeredTools.get(toolKey(tool))
    if (!registeredTool)
      throw new Error(`WebMCP tool "${tool.name}" is no longer available from ${tool.origin}.`)
    publishExecution({ input, phase: 'called', tool })
    try {
      // Chrome 155 serializes object input at the native boundary. Passing JSON
      // text here fails validation before the registered page tool runs.
      const result = resultFromWebMcp(await context.executeTool(registeredTool, input))
      if (isCompletionResult(result))
        completionRevision.value += 1
      publishExecution({ input, phase: 'resolved', result, tool })
      return result
    }
    catch (caught) {
      console.error('[webmcp] tool execution failed:', {
        error: errorMessageFrom(caught),
        origin: tool.origin,
        tool: tool.name,
      })
      publishExecution({ error: errorMessageFrom(caught) ?? 'WebMCP tool execution failed.', input, phase: 'failed', tool })
      throw caught
    }
  }

  function onExecution(listener: (execution: WebMcpToolExecution) => void) {
    executionListeners.add(listener)
    return () => executionListeners.delete(listener)
  }

  function publishExecution(execution: WebMcpToolExecution) {
    executionListeners.forEach(listener => listener(execution))
  }

  async function waitUntilReady() {
    if (!allowedOrigin || availability.value === 'ready')
      return
    if (availability.value === 'unavailable')
      throw new Error(error.value ?? '互動服務無法使用。')
    const waitingGeneration = generation.value
    await new Promise<void>((resolve, reject) => {
      const stop = watch([availability, generation], ([next, nextGeneration]) => {
        if (nextGeneration !== waitingGeneration || next === 'idle') {
          stop()
          reject(new Error('互動服務頁面已切換，請重新確認目前畫面。'))
          return
        }
        if (next === 'ready') {
          stop()
          resolve()
        }
        if (next === 'unavailable') {
          stop()
          reject(new Error(error.value ?? '互動服務無法使用。'))
        }
      }, { flush: 'sync' })
    })
  }

  const context = modelContext()
  // `getTools` and `executeTool` are sufficient for a functional WebMCP host.
  // `toolchange` is an optional enhancement, so a provider without EventTarget
  // support must not prevent Stage Web from mounting.
  context?.addEventListener?.('toolchange', () => void refresh())

  return {
    activate,
    availability: readonly(availability),
    completionRevision: readonly(completionRevision),
    error: readonly(error),
    execute,
    onExecution,
    refresh,
    tools: readonly(tools),
    unavailableReason: readonly(unavailableReason),
    waitUntilReady,
  }
}
