import type { ConfigKVService } from '../../../services/adapters/config-kv'
import type { KioskService } from '../../../services/domain/kiosk'
import type { KioskCharacterAssetService } from '../../../services/domain/kiosk-character-assets'
import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { createAdminKioskRoutes } from '.'
import { ApiError } from '../../../utils/error'

function createTestApp(_configKV?: ConfigKVService) {
  const kioskService = {
    getSiteManagementCapabilities: vi.fn(async () => ({
      canEditExperience: true,
      canEditTechnicalSettings: true,
      canManageDevices: true,
      canPublishExperience: true,
    })),
    getSiteProactiveVlmEnabled: vi.fn(async () => false),
    getSitePerformanceProfile: vi.fn(async () => 'balanced'),
    getSiteVoiceVadSettings: vi.fn(async () => ({ threshold: 0.5, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 })),
    getOwnerExperienceTemplate: vi.fn(async () => ({ draft: undefined, release: undefined })),
    saveOwnerExperienceTemplateDraft: vi.fn(async ({ name, snapshot }: { name: string, snapshot: object }) => ({ id: 'template-draft', name, snapshot })),
    publishOwnerExperienceTemplate: vi.fn(async () => ({ id: 'template-release', revision: 1 })),
    provisionSite: vi.fn(async ({ name, ownerUserId }: { name: string, ownerUserId: string }) => ({ id: 'site-new', name, ownerUserId })),
    disableDevice: vi.fn(async () => undefined),
    deleteDevice: vi.fn(async () => undefined),
    setSitePerformanceProfile: vi.fn(async ({ profile }: { profile: 'constrained' | 'balanced' | 'high' }) => ({ performanceProfile: profile })),
    setSiteVoiceVadSettings: vi.fn(async ({ settings }: { settings: object }) => ({ voiceVadSettings: settings })),
  } as unknown as KioskService
  const characterAssets = {} as KioskCharacterAssetService

  const app = new Hono<HonoEnv>()
    .use('*', async (c, next) => {
      c.set('user', { id: 'admin-1', email: 'admin@example.com', role: 'admin' } as HonoEnv['Variables']['user'])
      await next()
    })
    .route('/api/admin/kiosk', createAdminKioskRoutes(kioskService, characterAssets))
    .onError((error, c) => {
      if (error instanceof ApiError)
        return c.json({ error: error.errorCode }, error.statusCode)
      return c.json({ error: 'internal' }, 500)
    })
  return { app, kioskService }
}

describe('admin kiosk model policy route', () => {
  it('publishes the signed-in administrator default experience and provisions a site from it', async () => {
    const { app, kioskService } = createTestApp()
    const draft = {
      name: '營運者預設',
      snapshot: {
        version: 1,
        assistanceReminderPrompt: '需要時協助。',
        agentInstructions: '保持簡潔。',
        characterName: '助手',
        greetingPrompt: '您好。',
        interactiveService: { id: 'ordering', title: '點餐', description: '點餐服務', url: 'http://localhost:5166' },
        surveyUrl: 'https://example.com/survey',
        voiceConversationOnly: false,
      },
    }
    const saved = await app.request('/api/admin/kiosk/experience-template/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
    expect(saved.status).toBe(200)
    expect(kioskService.saveOwnerExperienceTemplateDraft).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'admin-1' }))

    const published = await app.request('/api/admin/kiosk/experience-template/publish', { method: 'POST' })
    expect(published.status).toBe(200)
    const site = await app.request('/api/admin/kiosk/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '新店' }) })
    expect(site.status).toBe(201)
    expect(kioskService.provisionSite).toHaveBeenCalledWith({ name: '新店', ownerUserId: 'admin-1' })
  })

  it('stores a selected kiosk performance profile', async () => {
    const configKV = { getOptional: vi.fn(async () => null) } as unknown as ConfigKVService
    const { app } = createTestApp(configKV)

    const response = await app.request('/api/admin/kiosk/sites/site-1/performance-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'constrained' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ performanceProfile: 'constrained' })
  })

  it('stores kiosk Silero VAD segmentation settings', async () => {
    const configKV = { getOptional: vi.fn(async () => null) } as unknown as ConfigKVService
    const { app } = createTestApp(configKV)

    const response = await app.request('/api/admin/kiosk/sites/site-1/voice-vad-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: 0.5, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ voiceVadSettings: { threshold: 0.5, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } })
  })

  it('returns individual results when disabling a device batch has partial failures', async () => {
    const configKV = { getOptional: vi.fn(async () => null) } as unknown as ConfigKVService
    const { app, kioskService } = createTestApp(configKV)
    vi.mocked(kioskService.disableDevice).mockImplementation(async ({ deviceId }) => {
      if (deviceId === 'device-failed')
        throw new Error('Device is unavailable')
    })

    const response = await app.request('/api/admin/kiosk/sites/site-1/devices/batch-disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceIds: ['device-1', 'device-failed'] }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      failedDeviceIds: ['device-failed'],
      succeededDeviceIds: ['device-1'],
    })
  })

  it('forwards only selected devices to batch deletion', async () => {
    const configKV = { getOptional: vi.fn(async () => null) } as unknown as ConfigKVService
    const { app, kioskService } = createTestApp(configKV)

    const response = await app.request('/api/admin/kiosk/sites/site-1/devices/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceIds: ['device-disabled'] }),
    })

    expect(response.status).toBe(200)
    expect(kioskService.deleteDevice).toHaveBeenCalledWith({ deviceId: 'device-disabled', siteId: 'site-1', userId: 'admin-1' })
  })
})
