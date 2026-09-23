import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { createAdminWebnaviorAiRoutes } from '.'

describe('admin Webnavior AI routes', () => {
  it('passes a Provider ID unchanged when verifying a saved profile', async () => {
    const verifyProfile = vi.fn(async () => ({ id: 'RB_zw84In0eWFofqtM-9K' }))
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('user', { id: 'admin-1', role: 'admin' } as HonoEnv['Variables']['user'])
        await next()
      })
      .route('/', createAdminWebnaviorAiRoutes({
        runtimeService: { applyBindings: async () => ({ appliedCapabilities: [] }), modelFor: async () => undefined },
        service: {
          createProfile: vi.fn(),
          deleteProfile: vi.fn(),
          listProfiles: vi.fn(),
          listSelections: vi.fn(),
          refreshProfileModels: vi.fn(),
          selectProfile: vi.fn(),
          testProviderConnection: vi.fn(),
          updateProfile: vi.fn(),
          verifyAndCreateProfile: vi.fn(),
          verifyAndUpdateProfile: vi.fn(),
          verifyProfile,
        },
        speechGuard: {
          classifyInitialSpeech: async () => undefined,
          getStatus: async () => ({ baselineCount: 0, ready: false }),
          initialize: async () => ({ baselineCount: 680, embeddingModelId: 'embeddinggemma', embeddingProfileId: 'profile-1' }),
        },
      }))

    const response = await app.request('/capabilities/chat/providers/RB_zw84In0eWFofqtM-9K/verify', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(verifyProfile).toHaveBeenCalledWith('chat', 'RB_zw84In0eWFofqtM-9K')
  })

  it('uses verify-and-save before it creates a Provider profile', async () => {
    const verifyAndCreateProfile = vi.fn(async () => ({ id: 'new-profile' }))
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('user', { id: 'admin-1', role: 'admin' } as HonoEnv['Variables']['user'])
        await next()
      })
      .route('/', createAdminWebnaviorAiRoutes({
        runtimeService: { applyBindings: async () => ({ appliedCapabilities: [] }), modelFor: async () => undefined },
        service: {
          createProfile: vi.fn(),
          deleteProfile: vi.fn(),
          listProfiles: vi.fn(),
          listSelections: vi.fn(),
          refreshProfileModels: vi.fn(),
          selectProfile: vi.fn(),
          testProviderConnection: vi.fn(),
          updateProfile: vi.fn(),
          verifyAndCreateProfile,
          verifyAndUpdateProfile: vi.fn(),
          verifyProfile: vi.fn(),
        },
        speechGuard: {
          classifyInitialSpeech: async () => undefined,
          getStatus: async () => ({ baselineCount: 0, ready: false }),
          initialize: async () => ({ baselineCount: 680, embeddingModelId: 'embeddinggemma', embeddingProfileId: 'profile-1' }),
        },
      }))

    const response = await app.request('/capabilities/chat/providers/verify-and-save', {
      body: JSON.stringify({ baseURL: 'https://models.example/v1', kind: 'llama-cpp', modelId: 'gemma4:26b', name: '主要模型', timeoutMs: 5000 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(201)
    expect(verifyAndCreateProfile).toHaveBeenCalledWith('chat', expect.objectContaining({ kind: 'llama-cpp', modelId: 'gemma4:26b' }))
  })
})
