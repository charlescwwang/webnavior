import type { KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import type { KioskMediaCapturePolicy, KioskProfileSnapshot } from '../../../schemas/kiosk'
import type { KioskService } from '../../../services/domain/kiosk'
import type { KioskCharacterAssetService } from '../../../services/domain/kiosk-character-assets'
import type { KioskMediaService } from '../../../services/domain/kiosk-media'
import type { HonoEnv } from '../../../types/hono'

import JSZip from 'jszip'

import { Hono } from 'hono'
import { array, boolean, integer, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, safeParse, string } from 'valibot'

import { authGuard } from '../../../middlewares/auth'
import { KioskProfileSnapshotSchema } from '../../../services/domain/kiosk'
import { createBadRequestError, createForbiddenError } from '../../../utils/error'
import { createAdminKioskCharacterAssetRoutes } from './character-assets'

const profileDraftSchema = object({
  id: optional(string()),
  name: string(),
  snapshot: KioskProfileSnapshotSchema,
})
const siteProvisionSchema = object({
  interactionRetentionDays: optional(pipe(number(), integer(), minValue(0))),
  name: pipe(string(), minLength(1), maxLength(120)),
  slug: optional(pipe(string(), minLength(1), maxLength(120))),
})

const interactionRetentionSchema = object({
  days: pipe(number(), integer(), minValue(0)),
})

const mediaCapturePolicySchema = object({
  mode: picklist(['off', 'snapshot', 'triggered', 'continuous']),
})
const proactiveVlmSchema = object({ enabled: boolean() })
const performanceProfileSchema = object({ profile: picklist(['constrained', 'balanced', 'high']) })
const voiceVadSettingsSchema = object({
  threshold: pipe(number(), minValue(0.1), maxValue(0.99)),
  minSpeechDurationMs: pipe(number(), integer(), minValue(0), maxValue(60_000)),
  maxSpeechDurationS: pipe(number(), integer(), minValue(1), maxValue(9_999)),
  minSilenceDurationMs: pipe(number(), integer(), minValue(0), maxValue(60_000)),
  speechPadMs: pipe(number(), integer(), minValue(0), maxValue(10_000)),
})

const visitorSessionDeletionSchema = object({
  visitorSessionIds: pipe(array(pipe(string(), minLength(1), maxLength(120))), minLength(1), maxLength(100)),
})
const trainingDataExportSchema = object({
  visitorSessionIds: pipe(array(pipe(string(), minLength(1), maxLength(120))), minLength(1), maxLength(100)),
})
const deviceBatchSchema = object({
  deviceIds: pipe(array(pipe(string(), minLength(1), maxLength(120))), minLength(1), maxLength(100)),
})

/** Applies an independently auditable device operation without rolling back successful devices. */
async function applyDeviceBatch(deviceIds: string[], operation: (deviceId: string) => Promise<void>) {
  const failedDeviceIds: string[] = []
  const succeededDeviceIds: string[] = []
  for (const deviceId of deviceIds) {
    try {
      await operation(deviceId)
      succeededDeviceIds.push(deviceId)
    }
    catch {
      failedDeviceIds.push(deviceId)
    }
  }
  return { failedDeviceIds, succeededDeviceIds }
}

function hasCustomerConversation(entries: Array<{ kind: string }>) {
  return entries.some(entry => entry.kind === 'user_text' || entry.kind === 'asr_transcript' || entry.kind === 'order_result')
}

function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  // JSZip's buffer can be backed by a SharedArrayBuffer; Hono responses require
  // a normal ArrayBuffer-backed view in the Node runtime.
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return new Uint8Array(buffer)
}

/**
 * Minimal Profile management for the kiosk POC.
 *
 * Global administrators may manage every Site. Site administrators may manage
 * only their own Site; the domain service keeps that authorization rule next
 * to the Site membership data rather than depending on a global HTTP guard.
 */
export function createAdminKioskRoutes(kioskService: KioskService, characterAssets: KioskCharacterAssetService, mediaService?: KioskMediaService) {
  return new Hono<HonoEnv>()
    .use('*', authGuard)
    .route('/', createAdminKioskCharacterAssetRoutes({ assets: characterAssets, kioskService }))
    .get('/experience-template', async (c) => {
      return c.json(await kioskService.getOwnerExperienceTemplate(c.get('user')!.id))
    })
    .put('/experience-template/draft', async (c) => {
      const result = safeParse(profileDraftSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Invalid default kiosk experience draft', 'INVALID_REQUEST', result.issues)
      return c.json(await kioskService.saveOwnerExperienceTemplateDraft({
        id: result.output.id,
        name: result.output.name,
        ownerUserId: c.get('user')!.id,
        snapshot: result.output.snapshot as KioskProfileSnapshot,
      }))
    })
    .post('/experience-template/publish', async (c) => {
      return c.json(await kioskService.publishOwnerExperienceTemplate({ ownerUserId: c.get('user')!.id }))
    })
    .get('/sites', async (c) => {
      return c.json(await kioskService.listManagedSites(c.get('user')!.id))
    })
    .post('/sites', async (c) => {
      const result = safeParse(siteProvisionSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Invalid kiosk Site', 'INVALID_REQUEST', result.issues)
      return c.json(await kioskService.provisionSite({ ...result.output, ownerUserId: c.get('user')!.id }), 201)
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
    .post('/sites/:siteId/devices/batch-disable', async (c) => {
      const result = safeParse(deviceBatchSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Select one or more kiosk devices to disable', 'INVALID_REQUEST', result.issues)
      const siteId = c.req.param('siteId')
      const userId = c.get('user')!.id
      const deviceIds = [...new Set(result.output.deviceIds)]
      return c.json(await applyDeviceBatch(deviceIds, deviceId => kioskService.disableDevice({ deviceId, siteId, userId })))
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
    .post('/sites/:siteId/devices/batch-delete', async (c) => {
      const result = safeParse(deviceBatchSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Select one or more kiosk devices to delete', 'INVALID_REQUEST', result.issues)
      const siteId = c.req.param('siteId')
      const userId = c.get('user')!.id
      const deviceIds = [...new Set(result.output.deviceIds)]
      return c.json(await applyDeviceBatch(deviceIds, deviceId => kioskService.deleteDevice({ deviceId, siteId, userId })))
    })
    .get('/sites/:siteId/capabilities', async (c) => {
      return c.json(await kioskService.getSiteManagementCapabilities({
        siteId: c.req.param('siteId'),
        userId: c.get('user')!.id,
      }))
    })
    .get('/sites/:siteId/technical-settings', async (c) => {
      const capabilities = await kioskService.getSiteManagementCapabilities({ siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      if (!capabilities.canEditTechnicalSettings)
        throw createForbiddenError()
      const siteId = c.req.param('siteId')
      const voiceVadSettings = await kioskService.getSiteVoiceVadSettings(siteId)
      return c.json({ proactiveVlmEnabled: await kioskService.getSiteProactiveVlmEnabled(siteId), performanceProfile: await kioskService.getSitePerformanceProfile(siteId), voiceVadSettings, voiceVadThreshold: voiceVadSettings.threshold })
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
      return c.body(ownBytes(file.data), 200, { 'Content-Type': file.media.mimeType })
    })
    .post('/sites/:siteId/training-data/llm', async (c) => {
      const result = safeParse(trainingDataExportSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Select one or more visitor sessions to export', 'INVALID_REQUEST', result.issues)

      const siteId = c.req.param('siteId')
      const userId = c.get('user')!.id
      const lines: string[] = []
      for (const visitorSessionId of new Set(result.output.visitorSessionIds)) {
        const detail = await kioskService.getVisitorSessionForUser({ userId, visitorSessionId })
        if (detail.session.siteId !== siteId)
          throw createForbiddenError()
        if (!hasCustomerConversation(detail.entries))
          continue

        const profile = await kioskService.getProfileRelease(detail.session.profileReleaseId)
        const messages: Array<{ content: string, role: 'assistant' | 'system' | 'user' }> = []
        if (profile?.snapshot.agentInstructions)
          messages.push({ role: 'system', content: profile.snapshot.agentInstructions })
        let previousAsr = ''
        for (const entry of detail.entries) {
          if (entry.kind === 'asr_transcript') {
            previousAsr = entry.content
            messages.push({ role: 'user', content: entry.content })
          }
          else if (entry.kind === 'user_text') {
            // The kiosk persists a transcript and its submitted text separately.
            if (entry.content !== previousAsr)
              messages.push({ role: 'user', content: entry.content })
            previousAsr = ''
          }
          else if (entry.kind === 'assistant_text' && entry.metadata.action !== 'greeting') {
            messages.push({ role: 'assistant', content: entry.content })
          }
        }
        if (messages.some(message => message.role === 'user') && messages.some(message => message.role === 'assistant')) {
          lines.push(JSON.stringify({
            messages,
            metadata: { profileReleaseId: detail.session.profileReleaseId, serviceId: detail.session.serviceId, visitorSessionId },
          }))
        }
      }
      return c.body(lines.join('\n'), 200, {
        'Content-Disposition': 'attachment; filename="kiosk-llm-training.jsonl"',
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      })
    })
    .post('/sites/:siteId/training-data/asr', async (c) => {
      if (!mediaService)
        throw createBadRequestError('Kiosk media storage is unavailable', 'KIOSK_MEDIA_UNAVAILABLE')
      const result = safeParse(trainingDataExportSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Select one or more visitor sessions to export', 'INVALID_REQUEST', result.issues)

      const siteId = c.req.param('siteId')
      const userId = c.get('user')!.id
      const zip = new JSZip()
      const records: string[] = []
      for (const visitorSessionId of new Set(result.output.visitorSessionIds)) {
        const detail = await kioskService.getVisitorSessionForUser({ userId, visitorSessionId })
        if (detail.session.siteId !== siteId)
          throw createForbiddenError()
        const media = await mediaService.listVisitorSessionMedia(visitorSessionId)
        for (const transcript of detail.entries.filter(entry => entry.kind === 'asr_transcript')) {
          const activity = [...detail.entries].reverse().find(entry => entry.sequence < transcript.sequence && entry.kind === 'service_event' && entry.content === 'customer_activity' && entry.metadata.source === 'voice_input')
          const recording = media.find(item => item.kind === 'audio_recording' && item.interactionEntryId === activity?.id)
          if (!recording)
            continue
          const file = await mediaService.getFile(recording.id)
          if (!file)
            continue
          const extension = recording.mimeType.includes('wav') ? 'wav' : 'webm'
          const path = `audio/${recording.id}.${extension}`
          zip.file(path, file.data)
          records.push(JSON.stringify({ audio: path, language: 'zh-TW', text: transcript.content, visitorSessionId }))
        }
      }
      zip.file('metadata.jsonl', records.join('\n'))
      const archive = ownBytes(await zip.generateAsync({ type: 'uint8array' }))
      return c.body(archive, 200, {
        'Content-Disposition': 'attachment; filename="kiosk-asr-training.zip"',
        'Content-Type': 'application/zip',
      })
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
    .put('/sites/:siteId/voice-vad-settings', async (c) => {
      const result = safeParse(voiceVadSettingsSchema, await c.req.json().catch(() => null))
      if (!result.success)
        throw createBadRequestError('Invalid kiosk voice VAD settings', 'INVALID_REQUEST', result.issues)
      return c.json(await kioskService.setSiteVoiceVadSettings({ actorUserId: c.get('user')!.id, settings: result.output as KioskVoiceVadSettings, siteId: c.req.param('siteId') }))
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
