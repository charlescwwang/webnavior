import type { InferOutput } from 'valibot'

import { boolean, check, integer, literal, maxLength, maxValue, minValue, number, object, picklist, pipe, string, url } from 'valibot'

/** Connection draft only. Saving this configuration does not activate the AV pipeline. */
export const falconSettingsSchema = object({
  mode: picklist(['legacy', 'falcon']),
  baseURL: pipe(string(), url(), maxLength(500), check((value) => {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/'
  }, 'Use an HTTP service origin without credentials, path, query or fragment.')),
  path: pipe(string(), maxLength(200), check(value => /^\/[\w/-]+$/.test(value))),
  engine: picklist(['onnx', 'pytorch']),
  precision: picklist(['fp32', 'fp16', 'int8']),
  responseFormat: picklist(['transcription-json', 'chat-completions']),
  timeoutMs: pipe(number(), integer(), minValue(1000), maxValue(180_000)),
  maxUtteranceSeconds: pipe(number(), integer(), minValue(1), maxValue(30)),
})

/** Public settings never contain a plaintext or encrypted provider key. */
export type FalconSettings = InferOutput<typeof falconSettingsSchema>

export const falconSettingsSnapshotSchema = object({ settings: falconSettingsSchema, hasApiKey: boolean(), ready: literal(false), responseStatus: literal('pending') })

export type FalconSettingsSnapshot = InferOutput<typeof falconSettingsSnapshotSchema>

/** Editable connection fields; an empty key preserves the stored credential. */
export type FalconSettingsInput = FalconSettings & { plaintextKey?: string, clearApiKey?: boolean }

export const defaultFalconSettings: Readonly<FalconSettings> = {
  mode: 'legacy',
  baseURL: 'http://192.168.8.64:8766',
  path: '/api/falcon/extract',
  engine: 'onnx',
  precision: 'fp32',
  responseFormat: 'transcription-json',
  timeoutMs: 60_000,
  maxUtteranceSeconds: 15,
}
