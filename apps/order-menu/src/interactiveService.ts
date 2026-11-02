/// <reference path="./toolValidators.d.ts" />

import type { ToolDescriptor } from '@proj-airi/stage-shared/interactive-service'

import type { createMenuToolRuntime } from './webmcp'

// The virtual module belongs to this entry, including when another workspace
// imports it; consumers must not depend on Order Menu's tsconfig include list.
import validators from 'virtual:menu-tool-validators'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/window-message'
import { discoverService, discoveryRequestSchema, executeServiceTool, executionRequestSchema, inspectionRequestSchema, inspectService, interactiveServiceChannel } from '@proj-airi/stage-shared/interactive-service'
import { parse } from 'valibot'

/** Binds the current Menu document to one approved parent; runtime retains all commerce state. */
export function connectInteractiveService(runtime: ReturnType<typeof createMenuToolRuntime>, hostOrigin: string) {
  const documentId = crypto.randomUUID()
  const connection = createContext({
    channel: interactiveServiceChannel,
    currentWindow: window,
    targetWindow: () => window.parent,
    expectedSource: () => window.parent,
    targetOrigin: hostOrigin,
    expectedOrigin: hostOrigin,
  })
  let active: { id: string, operations: Map<string, { fingerprint: string, result: Promise<unknown>, status: 'pending' | 'settled' | 'failed' }> } | undefined
  let toolsRevision = 0
  let fingerprint = ''

  function descriptors(): ToolDescriptor[] {
    const tools = runtime.toolDefinitions.map(({ readOnly, ...tool }) => ({ ...tool, annotations: readOnly ? { readOnlyHint: true } : undefined }))
    const next = JSON.stringify(tools)
    if (next !== fingerprint) {
      fingerprint = next
      toolsRevision++
    }
    return tools
  }

  defineInvokeHandler(connection.context, discoverService, (raw) => {
    const request = parse(discoveryRequestSchema, raw)
    const tools = descriptors()
    if (active?.id !== request.connectionId)
      active = { id: request.connectionId, operations: new Map() }
    return { ...request, documentId, toolsRevision, tools }
  })

  defineInvokeHandler(connection.context, executeServiceTool, async (raw) => {
    const request = parse(executionRequestSchema, raw)
    if (!active || active.id !== request.connectionId || request.documentId !== documentId || connection.context.signal.aborted)
      throw new Error('STALE_CONNECTION: This request belongs to another menu document.')
    descriptors()
    const definition = runtime.toolDefinitions.find(tool => tool.name === request.name)
    if (!definition || request.toolsRevision !== toolsRevision)
      throw new Error('STALE_TOOLS: Discover the current menu capabilities before requesting an operation.')
    const operationFingerprint = JSON.stringify({ name: request.name, input: request.input })
    const previous = active.operations.get(request.operationId)
    if (previous && previous.fingerprint !== operationFingerprint)
      throw new Error('OPERATION_CONFLICT: An operation ID cannot identify different inputs.')
    if (!previous && active.operations.size >= 2048)
      throw new Error('CONNECTION_LIMIT: Refresh the connection before another request.')
    let operation = previous?.result
    if (!operation) {
      const enums = Object.fromEntries(Object.entries(definition.inputSchema.properties as Record<string, { enum?: unknown }>).filter(([, schema]) => schema.enum !== undefined).map(([key, schema]) => [key, schema.enum]))
      const validate = validators[definition.name]
      operation = validate?.({ input: request.input, enums })
        ? runtime.executeTool(definition.name, request.input).then((result) => {
            // Snapshot once before caching: native receipts crossed a JSON boundary,
            // and repeated IDs must return that receipt rather than later shared state.
            const serialized = JSON.stringify(result)
            return serialized === undefined ? null : JSON.parse(serialized)
          })
        : Promise.resolve({ ok: false, executed: false, toolName: definition.name, error: 'INVALID_TOOL_INPUT', message: `尚未執行。請依工具參數契約修正：${JSON.stringify(validate?.errors ?? []).slice(0, 1600)}。不要重做已成功的操作。` })
      // Cache before awaiting, including in-flight operations. No eviction within a
      // binding: an old repeated ID must never become a second commerce operation.
      const accepted = { fingerprint: operationFingerprint, result: operation, status: 'pending' as 'pending' | 'settled' | 'failed' }
      active.operations.set(request.operationId, accepted)
      void operation.then(() => accepted.status = 'settled', () => accepted.status = 'failed')
    }
    const result = await operation
    // A binding replacement may not cancel a write already admitted by the runtime.
    // Returning its receipt is safe; the old host context has already been revoked.
    return { connectionId: request.connectionId, documentId, operationId: request.operationId, result }
  })

  defineInvokeHandler(connection.context, inspectService, (raw) => {
    const request = parse(inspectionRequestSchema, raw)
    if (!active || active.id !== request.connectionId || request.documentId !== documentId)
      throw new Error('STALE_CONNECTION: Cannot inspect operations from another binding.')
    return {
      connectionId: active.id,
      documentId,
      pendingCount: [...active.operations.values()].filter(operation => operation.status === 'pending').length,
      operations: request.operationIds.map(operationId => ({ operationId, status: active!.operations.get(operationId)?.status ?? 'missing' as const })),
    }
  })

  return () => {
    active = undefined
    connection.dispose(new Error('Menu document unloaded.'))
  }
}
