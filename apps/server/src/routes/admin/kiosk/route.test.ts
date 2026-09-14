import type { ConfigKVService } from '../../../services/adapters/config-kv'
import type { KioskService } from '../../../services/domain/kiosk'
import type { KioskCharacterAssetService } from '../../../services/domain/kiosk-character-assets'
import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { createAdminKioskRoutes } from '.'
import { ApiError } from '../../../utils/error'

function createTestApp(configKV: ConfigKVService) {
  const kioskService = {
    getSiteManagementCapabilities: vi.fn(async () => ({
      canEditExperience: true,
      canEditTechnicalSettings: true,
      canManageDevices: true,
      canPublishExperience: true,
    })),
    getSiteModelOverrides: vi.fn(async () => ({})),
    getSiteProactiveVlmEnabled: vi.fn(async () => false),
    getSitePerformanceProfile: vi.fn(async () => 'balanced'),
    getSiteVoiceVadThreshold: vi.fn(async () => 0.72),
    disableDevice: vi.fn(async () => undefined),
    deleteDevice: vi.fn(async () => undefined),
    setSitePerformanceProfile: vi.fn(async ({ profile }: { profile: 'constrained' | 'balanced' | 'high' }) => ({ performanceProfile: profile })),
    setSiteVoiceVadThreshold: vi.fn(async ({ threshold }: { threshold: number }) => ({ voiceVadThreshold: String(threshold) })),
    setSiteModelOverrides: vi.fn(async () => ({})),
  } as unknown as KioskService
  const characterAssets = {} as KioskCharacterAssetService

  const app = new Hono<HonoEnv>()
    .use('*', async (c, next) => {
      c.set('user', { id: 'admin-1', email: 'admin@example.com', role: 'admin' } as HonoEnv['Variables']['user'])
      await next()
    })
    .route('/api/admin/kiosk', createAdminKioskRoutes(kioskService, configKV, characterAssets))
    .onError((error, c) => {
      if (error instanceof ApiError)
        return c.json({ error: error.errorCode }, error.statusCode)
      return c.json({ error: 'internal' }, 500)
    })
  return { app, kioskService }
}

describe('admin kiosk model policy route', () => {
  it('accepts an unprefixed LLM router model ID', async () => {
    const configKV = {
      getOptional: vi.fn(async (key: string) => {
        if (key === 'LLM_ROUTER_CONFIG') {
          return {
            llm: {
              models: {
                'chat-default': { upstreams: [{ baseURL: 'https://router.example.com/v1' }] },
              },
            },
          }
        }
        return key === 'DEFAULT_CHAT_MODEL' ? 'chat-default' : null
      }),
    } as unknown as ConfigKVService
    const { app } = createTestApp(configKV)

    const response = await app.request('/api/admin/kiosk/sites/site-1/model-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm: 'chat-default' }),
    })

    expect(response.status).toBe(200)
  })

  it('offers only the executable Webnavior TTS connection and returns its voice', async () => {
    const configKV = {
      getOptional: vi.fn(async (key: string) => {
        if (key === 'LLM_ROUTER_CONFIG') {
          return {
            llm: { models: {} },
            asr: { models: {} },
            tts: {
              models: {
                'router-only-tts': { upstreams: [{ baseURL: 'https://router.example.com/v1' }] },
              },
            },
          }
        }
        if (key === 'WEBNAVIOR_AUDIO_CONFIG') {
          return {
            tts: {
              baseURL: 'https://speech.example.com/v1',
              modelName: 'webnavior-tts',
              upstreamModel: 'edge-tts-v1',
              voice: 'zh-TW-HsiaoChenNeural',
            },
          }
        }
        return null
      }),
    } as unknown as ConfigKVService
    const { app } = createTestApp(configKV)

    const response = await app.request('/api/admin/kiosk/sites/site-1/model-policy')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      available: { tts: ['webnavior-tts'] },
      defaults: { tts: 'webnavior-tts' },
      sources: {
        tts: {
          'webnavior-tts': {
            baseURL: 'https://speech.example.com/v1',
            upstreamModel: 'edge-tts-v1',
            voice: 'zh-TW-HsiaoChenNeural',
          },
        },
      },
      performanceProfile: 'balanced',
      voiceVadThreshold: 0.72,
    })
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

  it('stores a kiosk voice VAD threshold', async () => {
    const configKV = { getOptional: vi.fn(async () => null) } as unknown as ConfigKVService
    const { app } = createTestApp(configKV)

    const response = await app.request('/api/admin/kiosk/sites/site-1/voice-vad-threshold', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threshold: 0.72 }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ voiceVadThreshold: '0.72' })
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
