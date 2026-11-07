import type { Context } from 'hono'
import type { GenericSchema, InferOutput } from 'valibot'

import type { createKioskSystemOneService } from '../../../services/domain/kiosk-system-one'
import type { WebnaviorAiControlService } from '../../../services/domain/webnavior-ai-control'
import type { WebnaviorAiRuntimeService } from '../../../services/domain/webnavior-ai-control/runtime'
import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { boolean, maxLength, maxValue, minValue, nonEmpty, number, object, optional, picklist, pipe, safeParse, string, url } from 'valibot'

import { adminGuard } from '../../../middlewares/admin-guard'
import { authGuard } from '../../../middlewares/auth'
import { createBadRequestError } from '../../../utils/error'

const providerProfileSchema = object({
  enableThinking: optional(boolean(), false),
  baseURL: pipe(string(), url('baseURL must be a valid URL'), maxLength(500)),
  kind: picklist(['llama-cpp', 'ollama', 'openai-compatible']),
  modelId: optional(pipe(string(), maxLength(300))),
  name: pipe(string(), nonEmpty('name is required'), maxLength(120)),
  plaintextKey: optional(pipe(string(), maxLength(8192))),
  timeoutMs: pipe(number(), minValue(1000), maxValue(60_000)),
  voice: optional(pipe(string(), maxLength(200))),
  speed: optional(pipe(number(), minValue(0.25), maxValue(4))),
})

const updateProviderProfileSchema = object({
  ...providerProfileSchema.entries,
  clearApiKey: optional(boolean()),
})

const selectionSchema = object({
  providerProfileId: pipe(string(), nonEmpty('providerProfileId is required'), maxLength(120)),
})

const systemOneProfileSchema = object({
  baseURL: pipe(string(), url('baseURL must be a valid URL'), maxLength(500)),
  implementation: picklist(['dasein', 'lookski', 'slm']),
  modelId: pipe(string(), nonEmpty('modelId is required'), maxLength(300)),
  name: pipe(string(), nonEmpty('name is required'), maxLength(120)),
  plaintextKey: optional(pipe(string(), maxLength(8192))),
  timeoutMs: pipe(number(), minValue(1000), maxValue(60_000)),
})

const systemOneRuntimeModelSchema = object({
  baseURL: pipe(string(), url('baseURL must be a valid URL'), maxLength(500)),
  implementation: picklist(['dasein', 'lookski', 'slm']),
  plaintextKey: optional(pipe(string(), maxLength(8192))),
  timeoutMs: pipe(number(), minValue(1000), maxValue(60_000)),
})

const updateSystemOneProfileSchema = object({
  ...systemOneProfileSchema.entries,
  clearApiKey: optional(boolean()),
})

const systemOnePolicySchema = object({
  decisionInstruction: pipe(string(), maxLength(12_000)),
  storeInstruction: pipe(string(), maxLength(2_000)),
})

const capabilities = ['chat', 'vision', 'asr', 'tts'] as const

async function parseBody<S extends GenericSchema>(c: Context<HonoEnv>, schema: S): Promise<InferOutput<S>> {
  const body = await c.req.json().catch(() => null)
  const result = safeParse(schema, body)
  if (!result.success)
    throw createBadRequestError('設定內容不完整或格式錯誤。', 'INVALID_REQUEST', result.issues)
  return result.output
}

/**
 * Webnavior-only capability Provider control plane.
 *
 * This surface curates capability-scoped Provider profiles and active choices;
 * it intentionally does not expose AIRI's generic router JSON configuration.
 */
export function createAdminWebnaviorAiRoutes(deps: {
  runtimeService: WebnaviorAiRuntimeService
  service: WebnaviorAiControlService
  systemOne: ReturnType<typeof createKioskSystemOneService>
}) {
  const { runtimeService, service, systemOne } = deps
  return new Hono<HonoEnv>()
    .use('*', authGuard)
    .use('*', adminGuard)
    .get('/', async c => c.json({
      profiles: await service.listProfiles(),
      selections: await service.listSelections(),
      systemOnePolicy: await systemOne.getPolicy(),
      systemOneProfiles: await systemOne.list(),
    }))
    .post('/capabilities/:capability/providers', async (c) => {
      const capability = parseCapability(c.req.param('capability'))
      const input = await parseBody(c, providerProfileSchema)
      return c.json(await service.createProfile(capability, input), 201)
    })
    .post('/capabilities/:capability/providers/models:discover', async (c) => {
      parseCapability(c.req.param('capability'))
      const input = await parseBody(c, providerProfileSchema)
      return c.json(await service.testProviderConnection(input))
    })
    .post('/capabilities/:capability/providers/:profileId/models:discover', async (c) => {
      const capability = parseCapability(c.req.param('capability'))
      const input = await parseBody(c, providerProfileSchema)
      return c.json(await service.testProviderConnection(input, { capability, id: c.req.param('profileId') }))
    })
    .post('/capabilities/:capability/providers/verify-and-save', async (c) => {
      const capability = parseCapability(c.req.param('capability'))
      const input = await parseBody(c, providerProfileSchema)
      return c.json(await service.verifyAndCreateProfile(capability, input), 201)
    })
    .post('/capabilities/:capability/providers/:profileId/verify-and-save', async (c) => {
      const capability = parseCapability(c.req.param('capability'))
      const input = await parseBody(c, providerProfileSchema)
      return c.json(await service.verifyAndUpdateProfile(capability, c.req.param('profileId'), input))
    })
    .patch('/capabilities/:capability/providers/:profileId', async (c) => {
      const capability = parseCapability(c.req.param('capability'))
      const input = await parseBody(c, updateProviderProfileSchema)
      return c.json(await service.updateProfile(capability, c.req.param('profileId'), input))
    })
    .delete('/capabilities/:capability/providers/:profileId', async (c) => {
      await service.deleteProfile(parseCapability(c.req.param('capability')), c.req.param('profileId'))
      return c.body(null, 204)
    })
    .post('/capabilities/:capability/providers/:profileId/models:refresh', async (c) => {
      return c.json(await service.refreshProfileModels(parseCapability(c.req.param('capability')), c.req.param('profileId')))
    })
    .post('/capabilities/:capability/providers/:profileId/verify', async (c) => {
      return c.json(await service.verifyProfile(parseCapability(c.req.param('capability')), c.req.param('profileId')))
    })
    .put('/capabilities/:capability/active-provider', async (c) => {
      const capability = parseCapability(c.req.param('capability'))
      const input = await parseBody(c, selectionSchema)
      return c.json(await service.selectProfile(capability, input.providerProfileId))
    })
    .post('/apply', async c => c.json(await runtimeService.applyBindings()))
    .put('/system-one/policy', async c => c.json(await systemOne.savePolicy(await parseBody(c, systemOnePolicySchema))))
    .post('/system-one/runtime-model:inspect', async c => c.json(await systemOne.inspectRuntimeModel(await parseBody(c, systemOneRuntimeModelSchema))))
    .post('/system-one/profiles', async c => c.json(await systemOne.save(await parseBody(c, systemOneProfileSchema)), 201))
    .patch('/system-one/profiles/:profileId', async c => c.json(await systemOne.update(c.req.param('profileId'), await parseBody(c, updateSystemOneProfileSchema))))
    .delete('/system-one/profiles/:profileId', async (c) => {
      await systemOne.delete(c.req.param('profileId'))
      return c.body(null, 204)
    })
    .post('/system-one/profiles/:profileId/readiness', async c => c.json(await systemOne.readiness(c.req.param('profileId'))))
    .put('/system-one/active-profile/:profileId', async c => c.json(await systemOne.activate(c.req.param('profileId'))))
    .delete('/system-one/active-profile/:profileId', async (c) => {
      await systemOne.deactivate(c.req.param('profileId'))
      return c.body(null, 204)
    })
}

function parseCapability(value: string) {
  if (!capabilities.includes(value as typeof capabilities[number]))
    throw createBadRequestError('未知的 AI 能力。', 'WEBNAVIOR_AI_UNKNOWN_CAPABILITY')
  return value as typeof capabilities[number]
}
