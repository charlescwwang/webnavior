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
  } as unknown as KioskService
  const characterAssets = {} as KioskCharacterAssetService

  return new Hono<HonoEnv>()
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
}

describe('admin kiosk model policy route', () => {
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
    const app = createTestApp(configKV)

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
    })
  })
})
