import type { ServiceConnection, ServiceTool, ToolExecution } from '@proj-airi/stage-shared/interactive-service'

import { errorMessageFrom } from '@moeru/std'
import { discoveryResultSchema, executionResultSchema, inspectionResultSchema } from '@proj-airi/stage-shared/interactive-service'
import { pbGatewayReceiptSchema, pbSubmissionResultSchema } from '@proj-airi/stage-shared/pb-checkout'
import { menuEntryReceiptSchema, readPbJourney, readPbStateJourney, tableSelectionReceiptSchema } from '@proj-airi/stage-shared/pb-journey'
import { browserPresentationInputSchema } from '@proj-airi/stage-shared/product-presentation'
import { parse, safeParse } from 'valibot'
import { readonly, shallowRef, toRaw, watch } from 'vue'

import { connectWindow } from './interactiveServiceWindowConnection'

export type ServiceAvailability = 'idle' | 'loading' | 'ready' | 'manual-payment' | 'unavailable'

/** Owns one document binding; only correlated native entry/submission acknowledgements cross navigation. Never retries writes. */
export function createInteractiveServiceClient() {
  const availability = shallowRef<ServiceAvailability>('idle')
  const tools = shallowRef<readonly ServiceTool[]>([])
  const error = shallowRef<string>()
  const unavailableReason = shallowRef<'connection-failed'>()
  const completionRevision = shallowRef(0)
  const editorRetired = shallowRef(false)
  const listeners = new Set<(event: ToolExecution) => void>()
  let connection: ServiceConnection | undefined
  let binding: { connectionId: string, documentId: string, toolsRevision: number } | undefined
  let readiness: Promise<void> | undefined
  let activeUrl: string | undefined
  let activeConnect: (() => ServiceConnection) | undefined
  let failedBinding: typeof binding
  let recovery: Promise<void> | undefined
  let navigating = false
  const unsettled = new Map<string, 'read' | 'effect'>()

  function publish(event: ToolExecution) {
    listeners.forEach(listener => listener(event))
  }

  function activate(serviceUrl?: string, connect?: () => ServiceConnection, resume?: NonNullable<typeof binding>) {
    connection?.dispose(new Error('互動服務頁面已切換。'))
    connection = undefined
    binding = undefined
    readiness = undefined
    navigating = false
    editorRetired.value = false
    tools.value = []
    error.value = undefined
    unavailableReason.value = undefined
    activeUrl = serviceUrl
    activeConnect = connect
    availability.value = 'idle'
    if (!resume) {
      failedBinding = undefined
      unsettled.clear()
    }
    if (!serviceUrl || !connect)
      return
    const origin = new URL(serviceUrl).origin
    const current = connect()
    connection = current
    availability.value = 'loading'
    const connectionId = resume?.connectionId ?? crypto.randomUUID()
    const challenge = crypto.randomUUID()
    readiness = (async () => {
      const deadline = Date.now() + 5000
      // Only discovery may retry: the catalog/listener can become ready after iframe load.
      while (!current.signal.aborted) {
        const attemptSignal = AbortSignal.timeout(Math.min(500, Math.max(1, deadline - Date.now())))
        try {
          const response = parse(discoveryResultSchema, await current.discover({ version: 1, connectionId, challenge }, attemptSignal))
          if (connection !== current)
            throw new Error('互動服務頁面已切換。')
          if (response.connectionId !== connectionId || response.challenge !== challenge || response.tools.length === 0)
            throw new Error('互動服務連線驗證失敗。')
          if (new Set(response.tools.map(tool => tool.name)).size !== response.tools.length)
            throw new Error('互動服務工具名稱重複。')
          if (resume) {
            if (response.documentId !== resume.documentId)
              throw new Error('菜單頁面已更換，不能沿用先前的訂單操作。')
            const status = parse(inspectionResultSchema, await current.inspect({ connectionId, documentId: resume.documentId, operationIds: [...unsettled.keys()] }, AbortSignal.timeout(1000)))
            // A transport can fail before a PB read enters its journal. Its
            // absence proves no commerce effect was lost; pending reads and
            // every missing write still block. Hints alone grant no exemption.
            if (status.connectionId !== connectionId || status.documentId !== resume.documentId || status.pendingCount !== 0
              || status.operations.length !== unsettled.size || new Set(status.operations.map(operation => operation.operationId)).size !== unsettled.size
              || status.operations.some(operation => !unsettled.has(operation.operationId)
                || (operation.status !== 'settled' && (operation.status !== 'missing' || unsettled.get(operation.operationId) !== 'read')))) {
              throw new Error('先前操作仍未完成或結果無法確認，暫停恢復代操作。')
            }
            unsettled.clear()
            failedBinding = undefined
          }
          binding = { connectionId, documentId: response.documentId, toolsRevision: response.toolsRevision }
          tools.value = response.tools.filter(tool => !editorRetired.value || ['browser_state_get', 'browser_reception_reset', 'browser_payment_open'].includes(tool.name)).map(tool => ({ ...tool, origin }))
          availability.value = 'ready'
          return
        }
        catch (caught) {
          if (current.signal.aborted || Date.now() >= deadline)
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

  async function execute(tool: ServiceTool, input: Record<string, unknown>, signal?: AbortSignal) {
    const current = connection
    const currentBinding = binding
    const issuedUrl = activeUrl
    if (!current || !currentBinding || availability.value !== 'ready')
      throw new Error(error.value ?? '互動服務尚未連線。')
    // Public descriptors are readonly Vue views; compare the underlying identity
    // so a retained descriptor from another activation cannot regain admission.
    if (!tools.value.includes(toRaw(tool)))
      throw new Error('工具已失效，請重新確認目前菜單。')
    const operationId = crypto.randomUUID()
    const safeRead = issuedUrl && (tool.name === 'browser_state_get' ? readPbStateJourney(issuedUrl) : readPbJourney(issuedUrl)) && tool.annotations?.readOnlyHint === true
      && ['browser_cart_get', 'browser_state_get', 'browser_recovery_context'].includes(tool.name)
    const presentation = tool.name === 'browser_present' ? safeParse(browserPresentationInputSchema, input) : undefined
    const optionalVisual = Boolean(issuedUrl && readPbJourney(issuedUrl) && presentation?.success
      && (presentation.output.productRefs.length === 0 || (presentation.output.mode === 'information' && presentation.output.preservePage === true)))
    unsettled.set(operationId, safeRead || optionalVisual ? 'read' : 'effect')
    const correlation = { connectionId: currentBinding.connectionId, documentId: currentBinding.documentId, operationId }
    publish({ ...correlation, phase: 'called', tool, input })
    try {
      // Native execution serialized JSON before reaching the page. Preserve that
      // contract and remove Vue proxies before structured-clone based transport.
      const serializedInput = JSON.parse(JSON.stringify(input))
      const response = parse(executionResultSchema, await current.execute({
        ...currentBinding,
        operationId,
        name: tool.name,
        input: serializedInput,
      }, signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)))
      if (response.connectionId !== currentBinding.connectionId || response.documentId !== currentBinding.documentId || response.operationId !== operationId)
        throw new Error('工具回應不屬於目前頁面。')
      if (connection !== current || navigating) {
        const journey = issuedUrl ? readPbJourney(issuedUrl) : undefined
        const entry = safeParse(menuEntryReceiptSchema, response.result)
        const submission = safeParse(pbSubmissionResultSchema, response.result)
        const gateway = safeParse(pbGatewayReceiptSchema, response.result)
        const opened = tool.name === 'browser_payment_open' && issuedUrl && readPbStateJourney(issuedUrl) && issuedUrl === activeUrl
          && gateway.success && gateway.output.reference === serializedInput.reference && gateway.output.method === serializedInput.method
        const returned = journey?.tablePath && tool.name === 'browser_return_table' && issuedUrl === activeUrl
          && safeParse(tableSelectionReceiptSchema, response.result).success
        const submitted = journey && tool.name === 'browser_order_submit' && submission.success && submission.output.dispatch === 'dispatched' && submission.output.status !== 'rejected' && issuedUrl === activeUrl
        // Only PB's bounded entry/submission acknowledgement may settle across
        // rediscovery. It cannot complete another write, restore old handles or
        // authorize any action in the replacement document.
        if (!opened && !returned && !submitted && (tool.name !== 'browser_start_ordering' || !issuedUrl || issuedUrl !== activeUrl
          || journey?.tablePath !== new URL(issuedUrl).pathname
          || !entry.success || entry.output.selectedTable !== serializedInput.name)) {
          throw new Error('工具回應不屬於目前頁面。')
        }
      }
      const result = response.result
      unsettled.delete(operationId)
      if (result && typeof result === 'object' && 'interaction' in result && result.interaction && typeof result.interaction === 'object' && 'status' in result.interaction && result.interaction.status === 'completed')
        completionRevision.value++
      // Record the correlated result before retirement clears the Host's
      // active-operation owners; the next reception must not inherit that work.
      publish({ ...correlation, phase: 'resolved', tool, input, result })
      const submission = safeParse(pbSubmissionResultSchema, result)
      if (connection === current && issuedUrl && readPbJourney(issuedUrl)
        && tool.name === 'browser_order_submit' && submission.success && submission.output.status !== 'rejected') {
        // SPA submission may never emit loading. Re-discover a read-only peer;
        // even a delayed navigation cannot restore cart/reset/submit tools.
        // Native unknown-write markers survive this transport replacement.
        const reconnect = activeConnect
        activate(issuedUrl, reconnect)
        editorRetired.value = true
      }
      return result
    }
    catch (caught) {
      // Speech framing/cleanup cannot change a cart. A page can leave the menu
      // between cue admission and dispatch; that failure retires only the cue,
      // never the connection or an independently settled customer operation.
      if (optionalVisual) {
        unsettled.delete(operationId)
        publish({ ...correlation, phase: 'failed', tool, input, error: errorMessageFrom(caught) ?? 'Optional visual cue was skipped.' })
        throw caught
      }
      if (connection === current) {
        failedBinding = currentBinding
        publish({ ...correlation, phase: 'failed', tool, input, error: errorMessageFrom(caught) ?? '工具執行結果無法確認。' })
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
    /** Current document identity; undefined until discovery or after activation revokes it. */
    getDocumentId: () => availability.value === 'ready' ? binding?.documentId : undefined,
    activate: (serviceUrl?: string, frameWindow?: Window | null) => activate(serviceUrl, serviceUrl && frameWindow ? () => connectWindow(serviceUrl, frameWindow) : undefined),
    /** Uses the same ownership/recovery coordinator with a trusted native transport. */
    activateTransport: (serviceUrl: string, connect: () => ServiceConnection) => activate(serviceUrl, connect),
    /** Revokes tools during native navigation; only a correlated entry/submission acknowledgement may still settle. */
    beginNavigation: () => {
      navigating = true
      tools.value = []
      availability.value = 'loading'
    },
    /** Human payment is visible but never exposes provider documents as PB tools. */
    beginManualPayment: () => {
      navigating = false
      tools.value = []
      error.value = undefined
      unavailableReason.value = undefined
      availability.value = 'manual-payment'
    },
    availability: readonly(availability),
    completionRevision: readonly(completionRevision),
    /** A dispatched order retired its editor; manual result UI stays usable and reception may restart. */
    editorRetired: readonly(editorRetired),
    error: readonly(error),
    unavailableReason: readonly(unavailableReason),
    tools: readonly(tools),
    execute,
    refresh: () => activate(activeUrl, activeConnect),
    /** Rebinds the same document only after all accepted calls have settled. */
    recover: async () => {
      if (availability.value === 'ready')
        return
      if (recovery)
        return await recovery
      const resume = failedBinding
      // A failed first handshake has issued no tools. Reconnect that configured
      // transport without inventing an old binding; accepted calls still require
      // their original document and settled journal below.
      if (!activeUrl || !activeConnect || (!resume && unsettled.size))
        throw new Error('請先確認菜單頁面已載入。')
      recovery = (async () => {
        activate(activeUrl, activeConnect, resume)
        await readiness
      })()
      try {
        await recovery
      }
      finally { recovery = undefined }
    },
    waitUntilReady: async (signal?: AbortSignal) => {
      // beginNavigation invalidates the old ready promise before the replacement
      // transport exists. Follow observable readiness across that gap, bounded
      // by the caller's reception lifetime and the menu-load timeout.
      const waiting = AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])])
      waiting.throwIfAborted()
      if (availability.value === 'loading') {
        const pending = Promise.withResolvers<void>()
        const stop = watch(availability, (state) => {
          if (state === 'ready' || state === 'manual-payment')
            pending.resolve()
          else if (state !== 'loading')
            pending.reject(new Error(error.value ?? '互動服務頁面已切換。'))
        })
        const abort = () => pending.reject(waiting.reason)
        waiting.addEventListener('abort', abort, { once: true })
        try {
          await pending.promise
        }
        finally {
          stop()
          waiting.removeEventListener('abort', abort)
        }
      }
      if (availability.value === 'unavailable')
        throw new Error(error.value)
    },
    onExecution: (listener: (event: ToolExecution) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
