import type { Context } from 'hono'
import type { GenericSchema, InferOutput } from 'valibot'

import type { WebnaviorAiControlService } from '../../../services/domain/webnavior-ai-control'
import type { WebnaviorAiRuntimeService } from '../../../services/domain/webnavior-ai-control/runtime'
import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { boolean, maxLength, maxValue, minValue, nonEmpty, number, object, optional, picklist, pipe, safeParse, string, url } from 'valibot'

import { adminGuard } from '../../../middlewares/admin-guard'
import { authGuard } from '../../../middlewares/auth'
import { createBadRequestError } from '../../../utils/error'

const connectionSchema = object({
  baseURL: pipe(string(), url('baseURL must be a valid URL'), maxLength(500)),
  kind: picklist(['ollama', 'openai-compatible']),
  name: pipe(string(), nonEmpty('name is required'), maxLength(120)),
  plaintextKey: optional(pipe(string(), maxLength(8192))),
  timeoutMs: pipe(number(), minValue(1000), maxValue(30_000)),
})

const updateConnectionSchema = object({
  ...connectionSchema.entries,
  clearApiKey: optional(boolean()),
})

const bindingSchema = object({
  connectionId: pipe(string(), nonEmpty('connectionId is required'), maxLength(120)),
  modelId: pipe(string(), nonEmpty('modelId is required'), maxLength(300)),
  voice: optional(pipe(string(), maxLength(200))),
})

const capabilities = ['chat', 'vision', 'asr', 'tts', 'embedding'] as const

async function parseBody<S extends GenericSchema>(c: Context<HonoEnv>, schema: S): Promise<InferOutput<S>> {
  const body = await c.req.json().catch(() => null)
  const result = safeParse(schema, body)
  if (!result.success)
    throw createBadRequestError('設定內容不完整或格式錯誤。', 'INVALID_REQUEST', result.issues)
  return result.output
}

/**
 * Webnavior-only AI connection control plane.
 *
 * This surface curates operator-facing connections and capability bindings;
 * it intentionally does not expose AIRI's generic router JSON configuration.
 */
export function createAdminWebnaviorAiRoutes(deps: {
  runtimeService: WebnaviorAiRuntimeService
  service: WebnaviorAiControlService
}) {
  const { runtimeService, service } = deps
  return new Hono<HonoEnv>()
    .use('*', authGuard)
    .use('*', adminGuard)
    .get('/', async c => c.json({
      bindings: await service.listBindings(),
      connections: await service.listConnections(),
    }))
    .post('/connections', async (c) => {
      const input = await parseBody(c, connectionSchema)
      return c.json(await service.createConnection(input), 201)
    })
    .patch('/connections/:connectionId', async (c) => {
      const input = await parseBody(c, updateConnectionSchema)
      return c.json(await service.updateConnection(c.req.param('connectionId'), input))
    })
    .delete('/connections/:connectionId', async (c) => {
      await service.deleteConnection(c.req.param('connectionId'))
      return c.body(null, 204)
    })
    .post('/connections/:connectionId/models:refresh', async (c) => {
      return c.json(await service.refreshConnectionModels(c.req.param('connectionId')))
    })
    .put('/bindings/:capability', async (c) => {
      const capability = c.req.param('capability')
      if (!capabilities.includes(capability as typeof capabilities[number]))
        throw createBadRequestError('未知的 AI 能力。', 'WEBNAVIOR_AI_UNKNOWN_CAPABILITY')
      const input = await parseBody(c, bindingSchema)
      return c.json(await service.saveBinding({ ...input, capability: capability as typeof capabilities[number] }))
    })
    .post('/apply', async c => c.json(await runtimeService.applyBindings()))
}
