import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { buildApp } from './app'

// Report: this chat, 2026-10-26; four kiosk ASR size refusals were returned as500.
describe('request size refusal', () => {
  it('returns a specific 413 for oversized ASR uploads without calling the provider', async () => {
    const { deps } = createTestDeps()
    const { app } = await buildApp(deps)
    const body = new FormData()
    body.set('file', new Blob([new Uint8Array(1024 * 1024)], { type: 'audio/wav' }), 'recording.wav')
    const upload = new Request('http://localhost/api/kiosk/audio/transcriptions', { method: 'POST', body })
    const bytes = await upload.arrayBuffer()
    upload.headers.set('Content-Length', String(bytes.byteLength))
    const res = await app.request(upload.url, { method: 'POST', headers: upload.headers, body: bytes })
    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toMatchObject({ error: 'KIOSK_AUDIO_TOO_LARGE' })
    expect(deps.llmRouter.route).not.toHaveBeenCalled()
  })

  it('preserves the 413 status for oversized ordinary JSON requests', async () => {
    const { deps } = createTestDeps()
    const { app } = await buildApp(deps)
    const body = JSON.stringify({ text: 'x'.repeat(1024 * 1024) })
    const res = await app.request('/api/kiosk/interaction-decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(body).byteLength) },
      body,
    })
    expect(res.status).toBe(413)
  })
})

function createTestDeps() {
  const authServerMetadata = {
    issuer: 'http://localhost:3000/api/auth',
    authorization_endpoint: 'http://localhost:3000/api/auth/oauth2/authorize',
    token_endpoint: 'http://localhost:3000/api/auth/oauth2/token',
  }

  const openIdConfig = {
    issuer: 'http://localhost:3000/api/auth',
    jwks_uri: 'http://localhost:3000/api/auth/jwks',
    authorization_endpoint: 'http://localhost:3000/api/auth/oauth2/authorize',
    token_endpoint: 'http://localhost:3000/api/auth/oauth2/token',
  }

  const auth = {
    api: {
      getSession: vi.fn(async () => null),
      getOAuthServerConfig: vi.fn(async () => authServerMetadata),
      getOpenIdConfig: vi.fn(async () => openIdConfig),
    },
    handler: vi.fn(async () => new Response('not-found', { status: 404 })),
  } as any

  const redisSubscriber = {
    on: vi.fn(),
    subscribe: vi.fn(async () => 1),
    unsubscribe: vi.fn(async () => 0),
  }

  const redis = {
    duplicate: vi.fn(() => redisSubscriber),
    publish: vi.fn(async () => 0),
  }

  const deps = {
    auth,
    db: {} as any,
    characterService: {} as any,
    chatService: {} as any,
    kioskService: {
      resolveDeviceCredential: vi.fn(),
    } as any,
    kioskCharacterAssetService: {
      getFile: vi.fn(async () => ({
        data: Buffer.from('asset'),
        format: 'vrm' as const,
      })),
    } as any,
    kioskSystemOneService: {} as any,
    providerService: {} as any,
    fluxService: {} as any,
    fluxTransactionService: {} as any,
    stripeService: {} as any,
    billingService: {} as any,
    adminFluxGrantsService: {} as any,
    adminRouterConfigService: {} as any,
    webnaviorAiControlService: {} as any,
    webnaviorAiRuntimeService: { modelFor: vi.fn(async () => 'test-model') } as any,
    adminUsersService: {} as any,
    ttsMeter: {} as any,
    requestLogService: {} as any,
    voicePackService: {} as any,
    providerCatalogService: {} as any,
    productEventService: {
      track: vi.fn(async () => undefined),
      trackGeneration: vi.fn(async () => undefined),
      countDistinctUsersByFeature: vi.fn(async () => []),
    },
    configKV: {
      getOrThrow: vi.fn(async (key: string) => {
        switch (key) {
          case 'AUTH_RATE_LIMIT_MAX':
            return 20
          case 'AUTH_RATE_LIMIT_WINDOW_SEC':
            return 60
          default:
            throw new Error(`Unexpected config key: ${key}`)
        }
      }),
    } as any,
    redis: redis as any,
    env: {
      API_SERVER_URL: 'http://localhost:3000',
      WEBNAVIOR_KIOSK_ASSET_DIR: '/tmp/webnavior-app-test-assets',
    } as any,
    otel: null,
    userDeletionService: {} as any,
    llmRouter: {
      route: vi.fn(async () => new Response('{}', { status: 200 })),
      invalidateConfig: vi.fn(),
    } as any,
    envelopeCrypto: {
      encryptKey: vi.fn(),
      decryptKey: vi.fn(),
    } as any,
  }

  return {
    deps,
    auth,
    authServerMetadata,
    openIdConfig,
    redis,
  }
}

describe('app well-known metadata routes', () => {
  it('serves oauth authorization server metadata at the root well-known path', async () => {
    const { deps, auth, authServerMetadata } = createTestDeps()
    const { app } = await buildApp(deps)

    const res = await app.request('/.well-known/oauth-authorization-server/api/auth')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual(authServerMetadata)
    expect(auth.api.getOAuthServerConfig).toHaveBeenCalledTimes(1)
    expect(auth.api.getOpenIdConfig).not.toHaveBeenCalled()
  })

  it('serves openid configuration at the issuer-appended well-known path', async () => {
    const { deps, auth, openIdConfig } = createTestDeps()
    const { app } = await buildApp(deps)

    const res = await app.request('/api/auth/.well-known/openid-configuration')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual(openIdConfig)
    expect(auth.api.getOpenIdConfig).toHaveBeenCalledTimes(1)
    expect(auth.api.getOAuthServerConfig).not.toHaveBeenCalled()
  })
})

describe('kiosk character asset routes', () => {
  it('allows the kiosk development origin to download a published character asset', async () => {
    const { deps } = createTestDeps()
    const { app } = await buildApp(deps)

    const res = await app.request('/assets/kiosk/asset-id', {
      headers: {
        Origin: 'http://localhost:5169',
      },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5169')
    expect(res.headers.get('content-type')).toContain('model/gltf-binary')
  })
})
