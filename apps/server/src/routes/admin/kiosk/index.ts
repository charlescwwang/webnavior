import type { KioskMediaCapturePolicy, KioskModelOverrides, KioskProfileSnapshot } from '../../../schemas/kiosk'
import type { ConfigKVService } from '../../../services/adapters/config-kv'
import type { KioskService } from '../../../services/domain/kiosk'
import type { KioskCharacterAssetService } from '../../../services/domain/kiosk-character-assets'
import type { KioskMediaService } from '../../../services/domain/kiosk-media'
import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { array, boolean, integer, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, safeParse, string } from 'valibot'

import { authGuard } from '../../../middlewares/auth'
import { DEFAULT_WEBNAVIOR_TTS_VOICE } from '../../../services/adapters/config-kv'
import { KioskProfileSnapshotSchema } from '../../../services/domain/kiosk'
import { createBadRequestError, createForbiddenError } from '../../../utils/error'
import { createAdminKioskCharacterAssetRoutes } from './character-assets'

const profileDraftSchema = object({
  id: optional(string()),
  name: string(),
  snapshot: KioskProfileSnapshotSchema,
})

const interactionRetentionSchema = object({
  days: pipe(number(), integer(), minValue(0)),
})

const mediaCapturePolicySchema = object({
  mode: picklist(['off', 'triggered', 'continuous']),
})
const proactiveVlmSchema = object({ enabled: boolean() })
const performanceProfileSchema = object({ profile: picklist(['constrained', 'balanced', 'high']) })
const voiceVadThresholdSchema = object({ threshold: pipe(number(), minValue(0.5), maxValue(0.95)) })

const visitorSessionDeletionSchema = object({
  visitorSessionIds: pipe(array(pipe(string(), minLength(1), maxLength(120))), minLength(1), maxLength(100)),
})

const modelOverridesSchema = object({
  asr: optional(string()),
  llm: optional(string()),
  tts: optional(string()),
  vision: optional(string()),
})

type ModelCategory = 'asr' | 'llm' | 'tts' | 'vision'

interface ApprovedModelCatalog {
  available: Record<ModelCategory, string[]>
  defaults: Record<ModelCategory, string | null>
  sources: Record<ModelCategory, Record<string, { baseURL: string, upstreamModel: string, voice?: string }>>
}

function modelSource(id: string, upstream: unknown): { baseURL: string, upstreamModel: string } | undefined {
  if (!upstream || typeof upstream !== 'object' || !('baseURL' in upstream) || typeof upstream.baseURL !== 'string')
    return undefined
  return {
    baseURL: upstream.baseURL,
    upstreamModel: 'overrideModel' in upstream && typeof upstream.overrideModel === 'string' ? upstream.overrideModel : id,
  }
}

async function getApprovedModelCatalog(configKV: ConfigKVService): Promise<ApprovedModelCatalog> {
  const [routerConfig, audioConfig, defaultChatModel] = await Promise.all([
    configKV.getOptional('LLM_ROUTER_CONFIG'),
    configKV.getOptional('WEBNAVIOR_AUDIO_CONFIG'),
    configKV.getOptional('DEFAULT_CHAT_MODEL'),
  ])
  const sources = {
    // Kiosk audio is dispatched through the Webnavior gateway, not the
    // general AIRI router. Listing router models here makes a selection that
    // the gateway will always reject as an unconfigured audio policy.
    asr: {},
    llm: Object.fromEntries(Object.entries(routerConfig?.llm.models ?? {}).flatMap(([id, model]) => {
      const source = modelSource(id, model.upstreams[0])
      return source ? [[id, source]] : []
    })),
    tts: {},
    // VLM follows the same router and provider configuration as chat. The
    // selected model itself declares image support to its upstream provider.
    vision: Object.fromEntries(Object.entries(routerConfig?.llm.models ?? {}).filter(([id]) => id.startsWith('vlm/')).flatMap(([id, model]) => {
      const source = modelSource(id, model.upstreams[0])
      return source ? [[id, source]] : []
    })),
  } satisfies ApprovedModelCatalog['sources']
  if (audioConfig?.asr) {
    sources.asr[audioConfig.asr.modelName] = {
      baseURL: audioConfig.asr.baseURL,
      upstreamModel: audioConfig.asr.upstreamModel,
    }
  }
  if (audioConfig?.tts) {
    sources.tts[audioConfig.tts.modelName] = {
      baseURL: audioConfig.tts.baseURL,
      upstreamModel: audioConfig.tts.upstreamModel,
      voice: audioConfig.tts.voice ?? DEFAULT_WEBNAVIOR_TTS_VOICE,
    }
  }
  return {
    available: {
      asr: Object.keys(sources.asr).sort(),
      llm: Object.keys(routerConfig?.llm.models ?? {}).sort(),
      tts: Object.keys(sources.tts).sort(),
      vision: Object.keys(routerConfig?.llm.models ?? {}).filter(id => id.startsWith('vlm/')).sort(),
    },
    defaults: {
      asr: audioConfig?.asr?.modelName ?? null,
      llm: defaultChatModel,
      tts: audioConfig?.tts?.modelName ?? null,
      vision: null,
    },
    sources,
  }
}

function assertApprovedOverrides(overrides: KioskModelOverrides, catalog: ApprovedModelCatalog) {
  for (const category of ['asr', 'llm', 'tts', 'vision'] as const) {
    const modelId = overrides[category]
    if (modelId && !catalog.available[category].includes(modelId))
      throw createBadRequestError(`Model is not approved for ${category}`, 'MODEL_NOT_APPROVED')
  }
}

/**
 * Minimal Profile management for the kiosk POC.
 *
 * Global administrators may manage every Site. Site administrators may manage
 * only their own Site; the domain service keeps that authorization rule next
 * to the Site membership data rather than depending on a global HTTP guard.
 */
export function createAdminKioskRoutes(kioskService: KioskService, configKV: ConfigKVService, characterAssets: KioskCharacterAssetService, mediaService?: KioskMediaService) {
  return new Hono<HonoEnv>()
    .use('*', authGuard)
    .route('/', createAdminKioskCharacterAssetRoutes({ assets: characterAssets, kioskService }))
    .get('/sites', async (c) => {
      return c.json(await kioskService.listManagedSites(c.get('user')!.id))
    })
    .delete('/sites/:siteId', async (c) => {
      const siteId = c.req.param('siteId')
      const assets = await characterAssets.listSiteFiles(siteId)
      await kioskService.deleteSite({ siteId, userId: c.get('user')!.id })
      await characterAssets.cleanupFiles(assets)
      return c.body(null, 204)
    })
    .get('/sites/:siteId/devices', async (c) => {
      return c.json(await kioskService.listSiteDevices({
        siteId: c.req.param('siteId'),
        userId: c.get('user')!.id,
      }))
    })
    .get('/sites/:siteId/devices/:deviceId/settings', async (c) => {
      const siteId = c.req.param('siteId')
      const capabilities = await kioskService.getSiteManagementCapabilities({ siteId, userId: c.get('user')!.id })
      if (!capabilities.canEditTechnicalSettings)
        throw createForbiddenError()
      const devices = await kioskService.listSiteDevices({ siteId, userId: c.get('user')!.id })
      if (!devices.some(device => device.id === c.req.param('deviceId')))
        throw createForbiddenError()
      return c.json(await kioskService.getDeviceSettings(c.req.param('deviceId')))
    })
    .put('/sites/:siteId/devices/:deviceId/settings', async (c) => {
      return c.json(await kioskService.updateDeviceSettings({
        deviceId: c.req.param('deviceId'),
        siteId: c.req.param('siteId'),
        userId: c.get('user')!.id,
        source: 'admin',
        body: await c.req.json().catch(() => null),
      }))
    })
    .get('/sites/:siteId/visitor-sessions', async (c) => {
      return c.json(await kioskService.listSiteVisitorSessions({
        ...(c.req.query('deviceId') ? { deviceId: c.req.query('deviceId') } : {}),
        siteId: c.req.param('siteId'),
        userId: c.get('user')!.id,
      }))
    })
    .post('/sites/:siteId/devices/:deviceId/disable', async (c) => {
      await kioskService.disableDevice({
        deviceId: c.req.param('deviceId'),
        siteId: c.req.param('siteId'),
        userId: c.get('user')!.id,
      })
      return c.body(null, 204)
    })
    .post('/sites/:siteId/devices/:deviceId/enable', async (c) => {
      await kioskService.enableDevice({ deviceId: c.req.param('deviceId'), siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      return c.body(null, 204)
    })
    .delete('/sites/:siteId/devices/:deviceId', async (c) => {
      await kioskService.deleteDevice({
        deviceId: c.req.param('deviceId'),
        siteId: c.req.param('siteId'),
        userId: c.get('user')!.id,
      })
      return c.body(null, 204)
    })
    .get('/sites/:siteId/capabilities', async (c) => {
      return c.json(await kioskService.getSiteManagementCapabilities({
        siteId: c.req.param('siteId'),
        userId: c.get('user')!.id,
      }))
    })
    .get('/sites/:siteId/model-policy', async (c) => {
      const capabilities = await kioskService.getSiteManagementCapabilities({ siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      if (!capabilities.canEditTechnicalSettings)
        throw createForbiddenError()
      const [catalog, overrides] = await Promise.all([
        getApprovedModelCatalog(configKV),
        kioskService.getSiteModelOverrides(c.req.param('siteId')),
      ])
      const siteId = c.req.param('siteId')
      return c.json({ ...catalog, overrides, proactiveVlmEnabled: await kioskService.getSiteProactiveVlmEnabled(siteId), performanceProfile: await kioskService.getSitePerformanceProfile(siteId), voiceVadThreshold: await kioskService.getSiteVoiceVadThreshold(siteId) })
    })
    .get('/sites/:siteId/profile', async (c) => {
      const capabilities = await kioskService.getSiteManagementCapabilities({ siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      if (!capabilities.canEditExperience && !capabilities.canManageDevices)
        throw createForbiddenError()
      return c.json(await kioskService.getSiteProfile(c.req.param('siteId')))
    })
    .get('/visitor-sessions/:visitorSessionId', async (c) => {
      const transcript = await kioskService.getVisitorSessionForUser({
        userId: c.get('user')!.id,
        visitorSessionId: c.req.param('visitorSessionId'),
      })
      return c.json({ ...transcript, media: mediaService ? await mediaService.listVisitorSessionMedia(transcript.session.id) : [] })
    })
    .get('/visitor-media/:mediaId', async (c) => {
      if (!mediaService)
        throw createBadRequestError('Kiosk media storage is unavailable', 'KIOSK_MEDIA_UNAVAILABLE')
      const file = await mediaService.getFile(c.req.param('mediaId'))
      if (!file)
        throw createBadRequestError('Kiosk media was not found', 'MEDIA_NOT_FOUND')
      await kioskService.getVisitorSessionForUser({
        userId: c.get('user')!.id,
        visitorSessionId: file.media.visitorSessionId,
      })
      return c.body(file.data, 200, { 'Content-Type': file.media.mimeType })
    })
    .delete('/sites/:siteId/visitor-sessions', async (c) => {
      const result = safeParse(visitorSessionDeletionSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Select one or more visitor sessions to delete', 'INVALID_REQUEST', result.issues)
      const siteId = c.req.param('siteId')
      await kioskService.assertCanManageSite({ siteId, userId: c.get('user')!.id })
      // Collect file references before the database cascade removes their metadata.
      const media = mediaService
        ? (await Promise.all(result.output.visitorSessionIds.map(id => mediaService.listVisitorSessionMedia(id))).then(records => records.flat()))
        : []
      await kioskService.deleteVisitorSessions({ siteId, userId: c.get('user')!.id, visitorSessionIds: result.output.visitorSessionIds })
      await mediaService?.cleanupFiles(media)
      return c.body(null, 204)
    })
    .put('/sites/:siteId/interaction-retention', async (c) => {
      const body = await c.req.json().catch(() => null)
      const result = safeParse(interactionRetentionSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid kiosk interaction retention policy', 'INVALID_REQUEST', result.issues)

      const site = await kioskService.setSiteInteractionRetentionDays({
        actorUserId: c.get('user')!.id,
        days: result.output.days,
        siteId: c.req.param('siteId'),
      })
      return c.json(site)
    })
    .put('/sites/:siteId/media-capture-policy', async (c) => {
      const result = safeParse(mediaCapturePolicySchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Invalid kiosk media capture policy', 'INVALID_REQUEST', result.issues)
      return c.json(await kioskService.setSiteMediaCapturePolicy({
        actorUserId: c.get('user')!.id,
        policy: result.output as KioskMediaCapturePolicy,
        siteId: c.req.param('siteId'),
      }))
    })
    .put('/sites/:siteId/proactive-vlm', async (c) => {
      const result = safeParse(proactiveVlmSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Invalid proactive VLM setting', 'INVALID_REQUEST', result.issues)
      return c.json(await kioskService.setSiteProactiveVlmEnabled({ actorUserId: c.get('user')!.id, enabled: result.output.enabled, siteId: c.req.param('siteId') }))
    })
    .put('/sites/:siteId/performance-profile', async (c) => {
      const result = safeParse(performanceProfileSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Invalid kiosk performance profile', 'INVALID_REQUEST', result.issues)
      return c.json(await kioskService.setSitePerformanceProfile({ actorUserId: c.get('user')!.id, profile: result.output.profile, siteId: c.req.param('siteId') }))
    })
    .put('/sites/:siteId/voice-vad-threshold', async (c) => {
      const result = safeParse(voiceVadThresholdSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Invalid kiosk voice VAD threshold', 'INVALID_REQUEST', result.issues)
      return c.json(await kioskService.setSiteVoiceVadThreshold({ actorUserId: c.get('user')!.id, threshold: result.output.threshold, siteId: c.req.param('siteId') }))
    })
    .put('/sites/:siteId/model-policy', async (c) => {
      const body = await c.req.json().catch(() => null)
      const result = safeParse(modelOverridesSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid kiosk model policy', 'INVALID_REQUEST', result.issues)

      const siteId = c.req.param('siteId')
      const capabilities = await kioskService.getSiteManagementCapabilities({ siteId, userId: c.get('user')!.id })
      if (!capabilities.canEditTechnicalSettings)
        throw createForbiddenError()
      const catalog = await getApprovedModelCatalog(configKV)
      assertApprovedOverrides(result.output as KioskModelOverrides, catalog)
      return c.json(await kioskService.setSiteModelOverrides({ siteId, overrides: result.output as KioskModelOverrides }))
    })
    .put('/sites/:siteId/profile-draft', async (c) => {
      const body = await c.req.json().catch(() => null)
      const result = safeParse(profileDraftSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid kiosk Profile draft', 'INVALID_REQUEST', result.issues)

      const siteId = c.req.param('siteId')
      const capabilities = await kioskService.getSiteManagementCapabilities({ siteId, userId: c.get('user')!.id })
      if (!capabilities.canEditExperience)
        throw createForbiddenError()
      const draft = capabilities.canEditTechnicalSettings
        ? await kioskService.saveProfileDraft({
            id: result.output.id,
            siteId,
            name: result.output.name,
            snapshot: result.output.snapshot as KioskProfileSnapshot,
          })
        : await kioskService.saveContentProfileDraft({
            siteId,
            snapshot: result.output.snapshot as KioskProfileSnapshot,
          })
      return c.json(draft)
    })
    .post('/sites/:siteId/profile-draft/publish', async (c) => {
      const body = await c.req.json().catch(() => null)
      const result = safeParse(object({ draftId: string() }), body)
      if (!result.success)
        throw createBadRequestError('A kiosk draft must be selected before publishing', 'INVALID_REQUEST', result.issues)
      const capabilities = await kioskService.getSiteManagementCapabilities({ siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      if (!capabilities.canPublishExperience)
        throw createForbiddenError()
      const release = await kioskService.publishProfileDraft({
        siteId: c.req.param('siteId'),
        draftId: result.output.draftId,
        actorUserId: c.get('user')!.id,
      })
      return c.json(release, 201)
    })
}
