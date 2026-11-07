import type { InferOutput } from 'valibot'

import { defineInvokeEventa } from '@moeru/eventa'
import { array, boolean, check, literal, maxLength, number, object, optional, picklist, pipe, record, strictObject, string, unknown } from 'valibot'

import { serviceOperationSchema } from './serviceOperation'

/** Browser-neutral contract for an approved Kiosk iframe; domain IDs remain opaque. */
export const interactiveServiceChannel = 'airi:interactive-service:v1'

const id = pipe(string(), check(value => value.length > 0 && value.length <= 200))

/** Host-only browser retry evidence; the key binds fresh site state to one document. */
export const browserRecoveryContextSchema = strictObject({
  source: literal('browser'),
  documentId: id,
  contextKey: id,
  canRetry: boolean(),
  execution: optional(serviceOperationSchema),
})

export const toolDescriptorSchema = strictObject({
  name: id,
  description: string(),
  title: optional(string()),
  inputSchema: pipe(record(string(), unknown()), check(value => value.type === 'object')),
  annotations: optional(object({ readOnlyHint: optional(boolean()), untrustedContentHint: optional(boolean()) })),
})

export const discoveryRequestSchema = strictObject({ version: literal(1), connectionId: id, challenge: id })
export const discoveryResultSchema = strictObject({
  version: literal(1),
  connectionId: id,
  challenge: id,
  documentId: id,
  toolsRevision: number(),
  tools: array(toolDescriptorSchema),
})
export const executionRequestSchema = strictObject({
  connectionId: id,
  documentId: id,
  operationId: id,
  toolsRevision: number(),
  name: id,
  input: record(string(), unknown()),
})
export const executionResultSchema = strictObject({
  connectionId: id,
  documentId: id,
  operationId: id,
  result: unknown(),
})

/** Recovery inspects accepted operations; it never invokes or replays them. */
export const inspectionRequestSchema = strictObject({
  connectionId: id,
  documentId: id,
  operationIds: pipe(array(id), maxLength(64)),
})
export const inspectionResultSchema = strictObject({
  connectionId: id,
  documentId: id,
  pendingCount: number(),
  operations: array(strictObject({ operationId: id, status: picklist(['pending', 'settled', 'failed', 'missing']) })),
})

export type ToolDescriptor = InferOutput<typeof toolDescriptorSchema>
/** Host-assigned origin is never accepted from an iframe's tool descriptor. */
export interface ServiceTool extends ToolDescriptor { origin: string }
/** One call's host notification; settled results belong only to its admitted document binding. */
export interface ToolExecution {
  connectionId: string
  documentId: string
  operationId: string
  error?: string
  input: Record<string, unknown>
  phase: 'called' | 'failed' | 'resolved'
  result?: unknown
  tool: ServiceTool
}

export const discoverService = defineInvokeEventa<InferOutput<typeof discoveryResultSchema>, InferOutput<typeof discoveryRequestSchema>>('airi:interactive-service:discover:v1')
export const executeServiceTool = defineInvokeEventa<InferOutput<typeof executionResultSchema>, InferOutput<typeof executionRequestSchema>>('airi:interactive-service:execute:v1')
export const inspectService = defineInvokeEventa<InferOutput<typeof inspectionResultSchema>, InferOutput<typeof inspectionRequestSchema>>('airi:interactive-service:inspect:v1')

/** Validated envelopes shared by window and native service transports. */
export type DiscoveryRequest = InferOutput<typeof discoveryRequestSchema>
export type DiscoveryResult = InferOutput<typeof discoveryResultSchema>
export type ExecutionRequest = InferOutput<typeof executionRequestSchema>
export type ExecutionResult = InferOutput<typeof executionResultSchema>
export type InspectionRequest = InferOutput<typeof inspectionRequestSchema>
export type InspectionResult = InferOutput<typeof inspectionResultSchema>

/** One disposable transport lifetime; disposal revokes waits, never replays calls. */
export interface ServiceConnection {
  signal: AbortSignal
  discover: (request: DiscoveryRequest, signal: AbortSignal) => Promise<unknown>
  execute: (request: ExecutionRequest, signal: AbortSignal) => Promise<unknown>
  inspect: (request: InspectionRequest, signal: AbortSignal) => Promise<unknown>
  dispose: (reason?: unknown) => void
}
