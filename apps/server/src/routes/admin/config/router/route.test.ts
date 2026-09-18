import type { AdminRouterConfigService } from '../../../../services/domain/admin/router-config'
import type { HonoEnv } from '../../../../types/hono'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { createAdminRouterConfigRoutes } from '.'
import { ApiError } from '../../../../utils/error'

function createTestApp(service: AdminRouterConfigService, fetchImpl?: typeof fetch) {
  return new Hono<HonoEnv>()
    .use('*', async (c, next) => {
      c.set('user', { id: 'admin-1', email: 'admin@example.com', role: 'admin' } as HonoEnv['Variables']['user'])
      await next()
    })
    .route('/api/admin/config/router', createAdminRouterConfigRoutes(service, { fetchImpl }))
    .onError((err, c) => {
      if (err instanceof ApiError)
        return c.json({ error: err.errorCode, message: err.message, details: err.details }, err.statusCode)
      return c.json({ error: 'internal', message: (err as Error).message }, 500)
    })
}

function createServiceStub(overrides: Partial<AdminRouterConfigService> = {}): AdminRouterConfigService {
  return {
    apply: vi.fn(),
    current: vi.fn(),
    removeLlmModel: vi.fn(),
    ...overrides,
  }
}

describe('admin router config route', () => {
  it('discovers unauthenticated local models without persisting a credential', async () => {
    const service = createServiceStub()
    const fetchImpl: typeof fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe('http://ollama.local:11434/v1/models')
      expect(init?.headers).toBeUndefined()
      return Response.json({ data: [{ id: 'qwen2.5:7b' }, { id: 'llama3.2:3b' }] })
    })
    const app = createTestApp(service, fetchImpl)

    const res = await app.request('/api/admin/config/router/discover-models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseURL: 'http://ollama.local:11434/v1',
      }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      models: [{ id: 'llama3.2:3b' }, { id: 'qwen2.5:7b' }],
    })
    expect(service.apply).not.toHaveBeenCalled()
  })

  it('removes a named LLM model through the authenticated admin route', async () => {
    const service = createServiceStub()
    const app = createTestApp(service)

    const res = await app.request('/api/admin/config/router/models/ollama%2Fqwen2.5%3A7b', { method: 'DELETE' })

    expect(res.status).toBe(204)
    expect(service.removeLlmModel).toHaveBeenCalledWith('ollama/qwen2.5:7b')
  })

  it('discovers an ASR model from an OpenAPI component reference', async () => {
    const service = createServiceStub()
    const fetchImpl: typeof fetch = vi.fn(async () => Response.json({
      paths: {
        '/audio/transcriptions': {
          post: { requestBody: { content: { 'multipart/form-data': { schema: { $ref: '#/components/schemas/TranscriptionBody' } } } } },
        },
      },
      components: { schemas: { TranscriptionBody: { properties: { model: { default: 'medium.zh-v0.1' } } } } },
    }))
    const app = createTestApp(service, fetchImpl)

    const response = await app.request('/api/admin/config/router/discover-audio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability: 'asr', baseURL: 'https://asr.example.com' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ models: [{ id: 'medium.zh-v0.1' }], source: 'openapi' })
  })

  it('accepts Bedrock bearer tokens longer than ordinary provider keys', async () => {
    const service = createServiceStub({
      apply: vi.fn(async () => ({
        applied: [],
        invalidatedKeys: [],
        preview: {},
      })),
    })
    const app = createTestApp(service)
    const body = {
      mode: 'merge',
      slices: [{
        kind: 'bedrock',
        modelName: 'chat-bedrock',
        overrideModel: 'us.amazon.nova-pro-v1:0',
        baseURL: 'https://bedrock-mantle.us-east-1.api.aws/v1',
        plaintextKey: `bedrock-api-key-${'x'.repeat(2180)}`,
      }],
      dryRun: false,
    }

    const res = await app.request('/api/admin/config/router', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(200)
    expect(service.apply).toHaveBeenCalledWith(expect.objectContaining({
      slices: [expect.objectContaining({
        kind: 'bedrock',
        plaintextKey: expect.stringMatching(/^bedrock-api-key-/u),
      })],
    }))
  })
})
