import type { InferOutput } from 'valibot'

import { defineInvokeEventa } from '@moeru/eventa'
import { array, boolean, check, literal, number, object, optional, pipe, record, strictObject, string, unknown } from 'valibot'

/** Browser-neutral contract for an approved Kiosk iframe; domain IDs remain opaque. */
export const interactiveServiceChannel = 'airi:interactive-service:v1'

const id = pipe(string(), check(value => value.length > 0 && value.length <= 200))
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

export type ToolDescriptor = InferOutput<typeof toolDescriptorSchema>
/** Host-assigned origin is never accepted from an iframe's tool descriptor. */
export interface ServiceTool extends ToolDescriptor { origin: string }
/** One call's host notification; settled results belong only to its admitted document binding. */
export interface ToolExecution {
  error?: string
  input: Record<string, unknown>
  phase: 'called' | 'failed' | 'resolved'
  result?: unknown
  tool: ServiceTool
}

export const discoverService = defineInvokeEventa<InferOutput<typeof discoveryResultSchema>, InferOutput<typeof discoveryRequestSchema>>('airi:interactive-service:discover:v1')
export const executeServiceTool = defineInvokeEventa<InferOutput<typeof executionResultSchema>, InferOutput<typeof executionRequestSchema>>('airi:interactive-service:execute:v1')
