import { errorMessageFrom } from '@moeru/std'
import { readonly, shallowRef, watch } from 'vue'

export type WebMcpAvailability = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface WebMcpTool {
  annotations?: { readOnlyHint?: boolean, untrustedContentHint?: boolean }
  description: string
  inputSchema: Record<string, unknown>
  name: string
  origin: string
  title?: string
}

/** A browser-issued tool handle. Its `window` belongs to the iframe and must never enter Vue reactivity. */
interface RegisteredWebMcpTool extends WebMcpTool {
  window: Window
}

interface ModelContextLike extends EventTarget {
  executeTool: (tool: RegisteredWebMcpTool, inputArguments: string, options?: { signal?: AbortSignal }) => Promise<string | null>
  getTools: (options?: { fromOrigins?: string[] }) => Promise<RegisteredWebMcpTool[]>
}

const readyTimeoutMs = 5_000

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

function toolKey(tool: Pick<WebMcpTool, 'name' | 'origin'>) {
  return `${tool.origin}\u0000${tool.name}`
}

/** Copies browser tool metadata into a Vue-safe descriptor without its cross-origin Window handle. */
function descriptorFrom(tool: RegisteredWebMcpTool): WebMcpTool {
  return {
    annotations: tool.annotations ? { ...tool.annotations } : undefined,
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
    origin: tool.origin,
    title: tool.title,
  }
}

/**
 * Adapts native WebMCP tools from the active trusted iframe into AIRI's LLM
 * runtime. It intentionally has no domain assumptions and no tool transport
 * fallback: unavailable WebMCP leaves the interaction service unavailable.
 */
export function createWebMcpAdapter() {
  const availability = shallowRef<WebMcpAvailability>('idle')
  const error = shallowRef<string>()
  const tools = shallowRef<readonly WebMcpTool[]>([])
  const registeredTools = new Map<string, RegisteredWebMcpTool>()
  let allowedOrigin: string | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let generation = 0

  function clearTimeoutState() {
    if (timeoutId)
      clearTimeout(timeoutId)
    timeoutId = undefined
  }

  async function refresh() {
    const currentGeneration = generation
    const context = modelContext()
    if (!context || !allowedOrigin) {
      tools.value = []
      registeredTools.clear()
      availability.value = allowedOrigin ? 'unavailable' : 'idle'
      error.value = allowedOrigin ? '此瀏覽器不支援 WebMCP。' : undefined
      return
    }

    try {
      const discovered = await context.getTools({ fromOrigins: [allowedOrigin] })
      if (currentGeneration !== generation)
        return
      const availableTools = discovered.filter(tool => tool.origin === allowedOrigin)
      registeredTools.clear()
      for (const tool of availableTools)
        registeredTools.set(toolKey(tool), tool)
      tools.value = availableTools.map(descriptorFrom)
      if (tools.value.length > 0) {
        clearTimeoutState()
        availability.value = 'ready'
        error.value = undefined
      }
    }
    catch (caught) {
      if (currentGeneration !== generation)
        return
      clearTimeoutState()
      tools.value = []
      registeredTools.clear()
      availability.value = 'unavailable'
      error.value = errorMessageFrom(caught) ?? '無法取得互動服務的 WebMCP tools。'
    }
  }

  function activate(serviceUrl: string | undefined) {
    generation++
    clearTimeoutState()
    tools.value = []
    registeredTools.clear()
    error.value = undefined
    allowedOrigin = serviceUrl ? new URL(serviceUrl).origin : undefined
    if (!allowedOrigin) {
      availability.value = 'idle'
      return
    }

    availability.value = 'loading'
    timeoutId = setTimeout(() => {
      if (availability.value === 'loading') {
        availability.value = 'unavailable'
        error.value = '互動服務尚未提供 WebMCP tools。'
      }
    }, readyTimeoutMs)
    void refresh()
  }

  async function execute(tool: WebMcpTool, input: Record<string, unknown>) {
    const context = modelContext()
    if (!context)
      throw new Error('此瀏覽器不支援 WebMCP。')
    const registeredTool = registeredTools.get(toolKey(tool))
    if (!registeredTool)
      throw new Error(`WebMCP tool "${tool.name}" is no longer available from ${tool.origin}.`)
    try {
      // Chrome's native WebMCP execution API receives JSON text, even though the
      // registered callback is given a structured object. Passing the object
      // directly lets discovery succeed but rejects the cross-frame invocation.
      return resultFromWebMcp(await context.executeTool(registeredTool, JSON.stringify(input)))
    }
    catch (caught) {
      console.error('[stage-kiosk] WebMCP tool execution failed:', {
        error: errorMessageFrom(caught),
        origin: tool.origin,
        tool: tool.name,
      })
      throw caught
    }
  }

  async function waitUntilReady() {
    if (!allowedOrigin || availability.value === 'ready')
      return
    if (availability.value === 'unavailable')
      throw new Error(error.value ?? '互動服務無法使用。')
    await new Promise<void>((resolve, reject) => {
      const stop = watch(availability, (next) => {
        if (next === 'ready') {
          stop()
          resolve()
        }
        if (next === 'unavailable') {
          stop()
          reject(new Error(error.value ?? '互動服務無法使用。'))
        }
      })
    })
  }

  const context = modelContext()
  context?.addEventListener('toolchange', () => void refresh())

  return {
    activate,
    availability: readonly(availability),
    error: readonly(error),
    execute,
    refresh,
    tools: readonly(tools),
    waitUntilReady,
  }
}

/** The sole native WebMCP discovery surface for the kiosk host. */
export const webMcpAdapter = createWebMcpAdapter()
