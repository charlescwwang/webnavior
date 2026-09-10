import type { KioskModelOverrides, KioskProfileSnapshot } from '../../../schemas/kiosk'
import type { ConfigKVService } from '../../../services/adapters/config-kv'
import type { KioskService } from '../../../services/domain/kiosk'
import type { KioskCharacterAssetService } from '../../../services/domain/kiosk-character-assets'
import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { integer, minValue, number, object, optional, pipe, safeParse, string } from 'valibot'

import { authGuard } from '../../../middlewares/auth'
import { KioskProfileSnapshotSchema } from '../../../services/domain/kiosk'
import { createBadRequestError, createForbiddenError } from '../../../utils/error'
import { createAdminKioskCharacterAssetRoutes } from './character-assets'

const profileDraftSchema = object({
  name: string(),
  snapshot: KioskProfileSnapshotSchema,
})

const interactionRetentionSchema = object({
  days: pipe(number(), integer(), minValue(0)),
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
}

async function getApprovedModelCatalog(configKV: ConfigKVService): Promise<ApprovedModelCatalog> {
  const [routerConfig, defaultChatModel, defaultTtsModel] = await Promise.all([
    configKV.getOptional('LLM_ROUTER_CONFIG'),
    configKV.getOptional('DEFAULT_CHAT_MODEL'),
    configKV.getOptional('DEFAULT_TTS_MODEL'),
  ])
  return {
    available: {
      asr: Object.keys(routerConfig?.asr?.models ?? {}).sort(),
      llm: Object.keys(routerConfig?.llm.models ?? {}).sort(),
      tts: Object.keys(routerConfig?.tts.models ?? {}).sort(),
      // Vision remains a device-runtime capability until it has a server gateway.
      vision: [],
    },
    defaults: {
      asr: null,
      llm: defaultChatModel,
      tts: defaultTtsModel,
      vision: null,
    },
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
export function createAdminKioskRoutes(kioskService: KioskService, configKV: ConfigKVService, characterAssets: KioskCharacterAssetService) {
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
      return c.json({ ...catalog, overrides })
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
      return c.json(transcript)
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
      const capabilities = await kioskService.getSiteManagementCapabilities({ siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      if (!capabilities.canPublishExperience)
        throw createForbiddenError()
      const release = await kioskService.publishProfileDraft({
        siteId: c.req.param('siteId'),
        actorUserId: c.get('user')!.id,
      })
      return c.json(release, 201)
    })
}
