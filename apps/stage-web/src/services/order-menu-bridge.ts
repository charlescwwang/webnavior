export type OrderMenuToolName
  = | 'menu_get'
    | 'menu_select_item'
    | 'menu_set_item_option'
    | 'menu_set_quantity'
    | 'cart_add_item'
    | 'cart_remove_item'
    | 'cart_get'
    | 'order_confirm'

interface PendingCall {
  reject: (reason: Error) => void
  resolve: (value: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}

interface OrderMenuResult {
  error?: string
  requestId: string
  result?: unknown
  source: 'airi-order-bridge'
  type: 'order:result'
}

const defaultMenuUrl = import.meta.env.VITE_ORDER_MENU_URL ?? 'http://localhost:5174'
const menuOrigin = new URL(defaultMenuUrl).origin
const pendingCalls = new Map<string, PendingCall>()
const menuCallTimeoutMs = 12_000
let frameWindow: Window | null = null
let ready = false
let readyResolver: (() => void) | undefined
let readyPromise = new Promise<void>((resolve) => {
  readyResolver = resolve
})
let callQueue = Promise.resolve()

function rejectPendingCalls(reason: Error) {
  for (const [requestId, pending] of pendingCalls) {
    clearTimeout(pending.timeoutId)
    pendingCalls.delete(requestId)
    pending.reject(reason)
  }
}

function onMessage(event: MessageEvent<OrderMenuResult | { source: string, type: string }>) {
  if (event.origin !== menuOrigin || event.data?.source !== 'airi-order-bridge')
    return

  if (event.data.type === 'order:ready') {
    ready = true
    readyResolver?.()
    return
  }

  if (event.data.type !== 'order:result')
    return

  const result = event.data as OrderMenuResult
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

async function callRemoteMenu(name: OrderMenuToolName, args: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('airi:order-menu-open'))
  if (!ready) {
    await Promise.race([
      readyPromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Menu service did not become ready. Start @proj-airi/order-menu first.')), 5000)),
    ])
  }
  if (!frameWindow)
    throw new Error('Menu service iframe is not available.')

  const requestId = crypto.randomUUID()
  return await new Promise<unknown>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingCalls.delete(requestId)
      reject(new Error(`Menu service did not respond to "${name}" within ${menuCallTimeoutMs / 1000} seconds.`))
    }, menuCallTimeoutMs)
    pendingCalls.set(requestId, { resolve, reject, timeoutId })
    frameWindow?.postMessage({
      source: 'airi-order-bridge',
      type: 'order:call',
      requestId,
      name,
      args,
    }, menuOrigin)
  })
}

/** Semantic iframe adapter for the independent menu service when native WebMCP is unavailable. */
export const orderMenuBridge = {
  menuUrl: defaultMenuUrl,
  attach(windowRef: Window | null) {
    frameWindow = windowRef
  },
  async call(name: OrderMenuToolName, args: Record<string, unknown> = {}) {
    // Menu selection is stateful. Serializing calls keeps a model's parallel
    // tool calls from applying options or quantity to the wrong selection.
    const queuedCall = callQueue.then(
      async () => await callRemoteMenu(name, args),
      async () => await callRemoteMenu(name, args),
    )
    callQueue = queuedCall.then(() => undefined, () => undefined)
    return await queuedCall
  },
  resetForIframeReload() {
    rejectPendingCalls(new Error('Menu service reloaded before completing the tool call.'))
    ready = false
    readyPromise = new Promise<void>((resolve) => {
      readyResolver = resolve
    })
  },
}
