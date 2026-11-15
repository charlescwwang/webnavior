import type { Buffer } from 'node:buffer'

import type { Counter } from '@opentelemetry/api'
import type { ChatResponseMode } from '@proj-airi/stage-shared/ai-provider'
import type Redis from 'ioredis'

import type { GatewayMetrics } from '../../../../otel'
import type { ConfigKVService } from '../../../adapters/config-kv'
import type { ConcurrencyLedger } from '../concurrency-ledger'
import type { LlmRouteContext, RouterConfig } from '../types'

import { randomBytes } from 'node:crypto'

import { parse } from 'valibot'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEnvelopeCrypto } from '../../../../utils/envelope-crypto'
import { ApiError } from '../../../../utils/error'
import { llmRouterConfigSchema } from '../../../adapters/config-kv'
import { createLlmRouterService } from '../router'

/**
 * Minimal redis stub shared across `createLlmRouterService` tests. The router
 * only touches redis through the TTS voice catalog cache, which the LLM-side
 * tests never exercise — every method here is a no-op vi.fn so the type
 * checker is happy without spinning a real client.
 */
function makeRedisStub(): Redis {
  async function* emptyScan(): AsyncGenerator<string[]> {}
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    scanStream: vi.fn(() => emptyScan()),
    pipeline: vi.fn(() => ({ del: vi.fn(), exec: vi.fn(async () => []) })),
  } as unknown as Redis
}

function freshMasterKey(): Buffer {
  return randomBytes(32)
}

function makeCounter(): Counter {
  return { add: vi.fn() } as unknown as Counter
}

function makeMetrics(): GatewayMetrics {
  return {
    fallbackCount: makeCounter(),
    upstreamErrors: makeCounter(),
    keyExhaustedCount: makeCounter(),
    sameStatusExhaustion: makeCounter(),
    configReload: makeCounter(),
    decryptFailures: makeCounter(),
    subscriberState: makeCounter(),
    configWrite: makeCounter(),
    configInvalidHmac: makeCounter(),
    poolSlotRejected: makeCounter(),
    poolSaturationMarked: makeCounter(),
    poolInflight: { addCallback: vi.fn(), removeCallback: vi.fn() },
  } as unknown as GatewayMetrics
}

/**
 * Stub concurrency ledger. Defaults model an always-free pool (tryAcquire grants,
 * nothing saturated) so the existing fixed-order LLM/TTS tests never engage the
 * pooling branch. Pooling tests pass `overrides` to drive capacity decisions.
 */
function makeLedger(overrides: Partial<ConcurrencyLedger> = {}): ConcurrencyLedger {
  return {
    tryAcquire: vi.fn(async () => true),
    release: vi.fn(async () => {}),
    markSaturated: vi.fn(async () => {}),
    isSaturated: vi.fn(async () => false),
    currentInflight: vi.fn(async () => 0),
    snapshot: vi.fn(async () => []),
    ...overrides,
  }
}

function makeConfigKV(config: RouterConfig | null): ConfigKVService {
  return {
    getOptional: vi.fn(async (key: string) => (key === 'LLM_ROUTER_CONFIG' ? config : null)),
    // routeTts reads UNSPEECH_UPSTREAM once per request via getOrThrow.
    // LLM-side tests never invoke routeTts so the value is irrelevant; TTS
    // tests need a populated restBaseURL.
    getOrThrow: vi.fn(async (key: string) => {
      if (key === 'UNSPEECH_UPSTREAM')
        return { restBaseURL: 'http://unspeech.local:5933' }
      return undefined
    }),
    get: vi.fn(),
    set: vi.fn(),
  } as unknown as ConfigKVService
}

function makeConfig(opts: {
  upstreams?: Array<{ baseURL: string, cachePrompt?: boolean, enableThinking?: boolean, responseMode?: ChatResponseMode, keyIds: string[], overrideModel?: string, timeoutMs?: number }>
  fallbackHttpCodes?: number[]
  fullChainTimeoutMs?: number
}): { config: RouterConfig, ciphertextByKey: Map<string, string>, crypto: ReturnType<typeof createEnvelopeCrypto> } {
  const crypto = createEnvelopeCrypto({ masterKey: freshMasterKey() })
  const modelName = 'openai/gpt-5-mini'
  const ciphertextByKey = new Map<string, string>()

  const upstreams = opts.upstreams ?? [{ baseURL: 'https://up-a.example/v1', keyIds: ['kA1'] }]
  const upstreamConfigs = upstreams.map(u => ({
    baseURL: u.baseURL,
    cachePrompt: u.cachePrompt,
    enableThinking: u.enableThinking,
    responseMode: u.responseMode,
    overrideModel: u.overrideModel,
    headerTemplate: 'Bearer {KEY}',
    timeoutMs: u.timeoutMs,
    keys: u.keyIds.map((id) => {
      const plaintext = `sk-${id}`
      const ct = crypto.encryptKey(plaintext, { modelName, keyEntryId: id })
      ciphertextByKey.set(id, ct)
      return { id, ciphertext: ct }
    }),
  }))

  const config: RouterConfig = {
    llm: {
      models: {
        [modelName]: {
          upstreams: upstreamConfigs,
          fallbackTriggers: {
            httpCodes: opts.fallbackHttpCodes ?? [401, 402, 403, 429, 500, 502, 503, 504],
            onTimeout: true,
          },
        },
      },
    },
    tts: { models: {} },
    defaults: {
      perAttemptTimeoutMs: 30000,
      fullChainTimeoutMs: opts.fullChainTimeoutMs ?? 60000,
      fallbackHttpCodes: opts.fallbackHttpCodes ?? [401, 402, 403, 429, 500, 502, 503, 504],
    },
  } as RouterConfig

  return { config, ciphertextByKey, crypto }
}

function happyResponse(bodyJson: object) {
  return new Response(JSON.stringify(bodyJson), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function failResponse(status: number, body: object = { error: 'bad' }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createLlmRouterService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([false, true])('pins only configured Ollama upstreams with stream=%s and fallback isolation', async (stream) => {
    const { config, crypto } = makeConfig({ upstreams: [
      { baseURL: 'https://ollama.example/v1', keyIds: ['ollama'] },
      { baseURL: 'https://other.example/v1', keyIds: ['other'] },
    ] })
    // NOTICE: Start with the schema-parsed config to reproduce production
    // validation: an unsupported extension would be stripped before dispatch.
    const configured = structuredClone(config)
    Object.assign(configured.llm.models['openai/gpt-5-mini']!.upstreams[0]!, { ollamaKeepAlive: -1 })
    const parsed = parse(llmRouterConfigSchema, configured)
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(failResponse(500))
      .mockResolvedValueOnce(happyResponse({ ok: 1 }))
    const router = createLlmRouterService({ configKV: makeConfigKV(parsed), envelopeCrypto: crypto, gatewayMetrics: null, fetchImpl, redis: makeRedisStub(), concurrencyLedger: makeLedger() })
    const request = { messages: [], stream }
    await router.route({ modelName: 'openai/gpt-5-mini', body: request })
    const first = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))
    const second = JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body))
    expect(first.keep_alive).toBe(-1)
    expect(first.stream).toBe(stream)
    expect(second).not.toHaveProperty('keep_alive')
    expect(request).not.toHaveProperty('keep_alive')
  })

  /**
   * @example Happy path: one upstream, one key, returns Response
   */
  it('happy path: one upstream + one key + 200 → returns Response, no fallback', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up.example/v1', keyIds: ['kA1'] }] })
    const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 }))
    const metrics = makeMetrics()

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: metrics,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    const res = await router.route({ modelName: 'openai/gpt-5-mini', body: { messages: [] } })
    expect(res.status).toBe(200)
    expect(fetchImpl.mock.calls.length).toBe(1)
    expect((metrics.fallbackCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
    expect((metrics.keyExhaustedCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('reports the winning upstream via ctx.provider (happy path)', async () => {
    // ROOT CAUSE:
    //
    // The success-path gen_ai metrics (operation count/duration/tokens) were
    // labelled by model only, so a per-provider rollup in Grafana was
    // impossible — the route layer never learned which upstream served the
    // request. We thread an out-param `ctx` the router fills with the upstream
    // it used so those metrics can carry a `provider` label.
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up.example/v1', keyIds: ['kA1'] }] })
    const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 }))
    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    const ctx: LlmRouteContext = { provider: 'unknown', triedUpstreams: 0, triedKeys: 0, lastStatus: null }
    const res = await router.route({ modelName: 'openai/gpt-5-mini', body: { messages: [] } }, ctx)
    expect(res.status).toBe(200)
    // deriveProviderTag = URL hostname.
    expect(ctx.provider).toBe('up.example')
  })

  it('ctx.provider reflects the upstream that actually succeeded after fallback', async () => {
    // ROOT CAUSE:
    //
    // With a fallback chain the winning provider is whichever upstream finally
    // returned 200, not the first one tried. ctx.provider must be the winner
    // (up-b), else per-provider success metrics would mis-attribute the request
    // to the failing upstream.
    const { config, crypto } = makeConfig({
      upstreams: [
        { baseURL: 'https://up-a.example/v1', keyIds: ['kA1'] },
        { baseURL: 'https://up-b.example/v1', keyIds: ['kB1'] },
      ],
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(failResponse(401))
      .mockResolvedValueOnce(happyResponse({ ok: 1 }))
    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: makeMetrics(),
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    const ctx: LlmRouteContext = { provider: 'unknown', triedUpstreams: 0, triedKeys: 0, lastStatus: null }
    const res = await router.route({ modelName: 'openai/gpt-5-mini', body: {} }, ctx)
    expect(res.status).toBe(200)
    expect(ctx.provider).toBe('up-b.example')
  })

  it('happy path injects Bearer + model + url correctly', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up.example/v1/', keyIds: ['kA1'] }] })
    const fetchImpl: typeof fetch = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    await router.route({ modelName: 'openai/gpt-5-mini', body: { messages: [{ role: 'user', content: 'hi' }] } })

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toBe('https://up.example/v1/chat/completions')
    const init = calls[0][1] as Parameters<typeof fetch>[1] & { headers: Record<string, string>, body: string, method: string }
    expect(init.headers.authorization).toBe('Bearer sk-kA1')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.method).toBe('POST')
    const sent = JSON.parse(init.body) as { model: string, messages: unknown }
    expect(sent.model).toBe('openai/gpt-5-mini')
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('uses upstream.overrideModel when set (so admin can rewrite the model id sent upstream)', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up.example/v1', keyIds: ['kA1'], overrideModel: 'real/upstream-id' }] })
    const fetchImpl: typeof fetch = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    const ctx: LlmRouteContext = { provider: 'unknown', triedUpstreams: 0, triedKeys: 0, lastStatus: null }
    await router.route({ modelName: 'openai/gpt-5-mini', body: { messages: [] } }, ctx)
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    const init = calls[0][1] as { body: string }
    expect((JSON.parse(init.body) as { model: string }).model).toBe('real/upstream-id')
    expect(ctx.upstreamModel).toBe('real/upstream-id')
  })

  it('enables prompt caching only for an upstream that opts in', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://llama.example/v1', cachePrompt: true, keyIds: ['kA1'] }] })
    const fetchImpl: typeof fetch = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch
    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    await router.route({ modelName: 'openai/gpt-5-mini', body: { messages: [] } })

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    const init = calls[0][1] as { body: string }
    expect(JSON.parse(init.body)).toMatchObject({ cache_prompt: true })
  })

  it.each(['auto', 'json', 'sse'] as const)('honors %s response mode without changing tool continuation arguments', async (responseMode) => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://models.example/v1', responseMode, keyIds: ['k1'] }] })
    const fetchImpl = vi.fn<typeof fetch>(async () => happyResponse({ choices: [] }))
    const router = createLlmRouterService({ configKV: makeConfigKV(parse(llmRouterConfigSchema, config)), envelopeCrypto: crypto, gatewayMetrics: null, fetchImpl, redis: makeRedisStub(), concurrencyLedger: makeLedger() })
    await router.route({ modelName: 'openai/gpt-5-mini', body: { messages: [{ role: 'tool', content: 'cart', tool_call_id: 'call-1' }], stream: true, stream_options: { include_usage: true } } })
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.stream).toBe(responseMode !== 'json')
    expect(body.messages[0].tool_call_id).toBe('call-1')
    if (responseMode === 'json')
      expect(body.stream_options).toBeUndefined()
    else
      expect(body.stream_options).toEqual({ include_usage: true })

    await router.route({ modelName: 'openai/gpt-5-mini', body: { messages: [{ role: 'user', content: 'JSON decision' }], stream: false } })
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).stream).toBe(false)
  })

  it.each([true, false])('sends the provider thinking choice on tool continuations: %s', async (enableThinking) => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://vllm.example/v1', enableThinking, keyIds: ['k1'] }] })
    const fetchImpl = vi.fn<typeof fetch>(async () => happyResponse({ ok: 1 }))
    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })
    await router.route({ modelName: 'openai/gpt-5-mini', body: {
      messages: [{ role: 'tool', content: 'menu', tool_call_id: 'call-1' }],
      chat_template_kwargs: { enable_thinking: !enableThinking, custom_template_option: true },
      stream: true,
    } })
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.chat_template_kwargs.enable_thinking).toBe(enableThinking)
    expect(body.chat_template_kwargs.custom_template_option).toBe(true)
    expect(body.stream).toBe(true)
    expect(body.messages[0].tool_call_id).toBe('call-1')
  })

  it('does not carry thinking policy into an unconfigured fallback provider', async () => {
    const { config, crypto } = makeConfig({ upstreams: [
      { baseURL: 'https://vllm.example/v1', enableThinking: false, keyIds: ['k1'] },
      { baseURL: 'https://generic.example/v1', keyIds: ['k2'] },
    ] })
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(failResponse(500))
      .mockResolvedValueOnce(happyResponse({ ok: 1 }))
    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })
    await router.route({ modelName: 'openai/gpt-5-mini', body: { messages: [] } })
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).not.toHaveProperty('chat_template_kwargs')
  })

  it('multi-key fallback: k1=401 then k2=200 → returns 200 and records fallbackCount once', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up-a.example/v1', keyIds: ['k1', 'k2'] }] })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(failResponse(401))
      .mockResolvedValueOnce(happyResponse({ ok: 1 }))
    const metrics = makeMetrics()

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: metrics,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    const res = await router.route({ modelName: 'openai/gpt-5-mini', body: {} })
    expect(res.status).toBe(200)
    expect(fetchImpl.mock.calls.length).toBe(2)

    expect((metrics.fallbackCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    const fbArgs = (metrics.fallbackCount.add as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fbArgs[0]).toBe(1)
    expect(fbArgs[1]).toMatchObject({ from_key: 'k1', reason: '401' })

    expect((metrics.upstreamErrors.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    expect((metrics.keyExhaustedCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('cross-upstream fallback: upstream A keys all 401, upstream B[0] = 200 → returns 200, A exhaustion counted', async () => {
    const { config, crypto } = makeConfig({
      upstreams: [
        { baseURL: 'https://up-a.example/v1', keyIds: ['kA1', 'kA2'] },
        { baseURL: 'https://up-b.example/v1', keyIds: ['kB1'] },
      ],
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(failResponse(401))
      .mockResolvedValueOnce(failResponse(401))
      .mockResolvedValueOnce(happyResponse({ ok: 1 }))
    const metrics = makeMetrics()

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: metrics,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    const res = await router.route({ modelName: 'openai/gpt-5-mini', body: {} })
    expect(res.status).toBe(200)
    expect(fetchImpl.mock.calls.length).toBe(3)

    expect((metrics.keyExhaustedCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    expect((metrics.fallbackCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('full exhaustion: every upstream + every key 401 → throws 502 BAD_GATEWAY (KTD-1 last-cause = 401 → 502)', async () => {
    const { config, crypto } = makeConfig({
      upstreams: [
        { baseURL: 'https://up-a.example/v1', keyIds: ['kA1'] },
        { baseURL: 'https://up-b.example/v1', keyIds: ['kB1'] },
      ],
    })
    const fetchImpl = vi.fn(async () => failResponse(401))
    const metrics = makeMetrics()

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: metrics,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    try {
      await router.route({ modelName: 'openai/gpt-5-mini', body: {} })
      throw new Error('expected throw')
    }
    catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).statusCode).toBe(502)
      expect((err as ApiError).errorCode).toBe('BAD_GATEWAY')
      expect((err as ApiError).details).toMatchObject({ triedKeys: 2, triedUpstreams: 2, lastStatusCode: 401 })
    }

    expect((metrics.keyExhaustedCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('full exhaustion attaches per-attempt cause (bodySnippet for HTTP, errorMessage for network) so operators can debug 502s', async () => {
    // ROOT CAUSE:
    //
    // Before this regression, `mapUpstreamError` only put `lastStatusCode`
    // into ApiError.details — the upstream body (e.g. OpenRouter 403
    // "This model is not available in your region.") was cancelled on the
    // wire and never reached the logger. Operators saw the bare 502 and
    // had to re-probe the upstream by hand to find the real reason.
    //
    // We now snapshot up to 256 body bytes per failed HTTP attempt and
    // capture errorMessageFromUnknown(err) for network attempts, then
    // attach the full attempt list to ApiError.cause. SEC-5 keeps it out
    // of details/response body; the logger surfaces cause for diagnosis.
    const { config, crypto } = makeConfig({
      upstreams: [
        { baseURL: 'https://up-a.example/v1', keyIds: ['kA1'] },
        { baseURL: 'https://up-b.example/v1', keyIds: ['kB1'] },
      ],
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(failResponse(401, { error: { message: 'key disabled', code: 'AUTH' } }))
      .mockImplementationOnce(async () => { throw new Error('ECONNRESET while reading response') })

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    try {
      await router.route({ modelName: 'openai/gpt-5-mini', body: {} })
      throw new Error('expected throw')
    }
    catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      // Client-facing surface stays SEC-5 clean — no body content here.
      expect((err as ApiError).details).toMatchObject({ triedKeys: 2, triedUpstreams: 2, lastStatusCode: 'timeout' })
      expect(JSON.stringify((err as ApiError).details)).not.toContain('key disabled')

      // Server-side cause carries the actual diagnostics.
      const cause = (err as ApiError & { cause?: { attempts?: unknown[] } }).cause
      expect(cause).toBeDefined()
      expect(cause?.attempts).toHaveLength(2)

      const first = (cause!.attempts as Array<Record<string, unknown>>)[0]
      expect(first).toMatchObject({ keyId: 'kA1', status: 401 })
      expect(first.bodySnippet).toEqual(expect.stringContaining('key disabled'))
      expect(first.errorMessage).toBeUndefined()

      const second = (cause!.attempts as Array<Record<string, unknown>>)[1]
      expect(second).toMatchObject({ keyId: 'kB1', status: 'timeout' })
      expect(second.errorMessage).toEqual(expect.stringContaining('ECONNRESET'))
      expect(second.bodySnippet).toBeUndefined()
    }
  })

  it('same-status exhaustion: all keys 429 → throws 503 + sameStatusExhaustion incremented per provider', async () => {
    const { config, crypto } = makeConfig({
      upstreams: [
        { baseURL: 'https://up-a.example/v1', keyIds: ['kA1', 'kA2'] },
        { baseURL: 'https://up-b.example/v1', keyIds: ['kB1'] },
      ],
    })
    const fetchImpl = vi.fn(async () => failResponse(429))
    const metrics = makeMetrics()

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: metrics,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    await expect(router.route({ modelName: 'openai/gpt-5-mini', body: {} })).rejects.toMatchObject({ statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE' })

    const calls = (metrics.sameStatusExhaustion.add as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBe(2)
    expect(calls[0][1]).toMatchObject({ status_code: 429 })
    expect(calls[1][1]).toMatchObject({ status_code: 429 })
  })

  it('mixed-cause exhaustion: 429 + 500 + timeout → last-cause wins (timeout → 504 GATEWAY_TIMEOUT)', async () => {
    const { config, crypto } = makeConfig({
      upstreams: [
        { baseURL: 'https://up-a.example/v1', keyIds: ['kA1', 'kA2'] },
        { baseURL: 'https://up-b.example/v1', keyIds: ['kB1'] },
      ],
    })
    // k1 → 429, k2 → 500, k3 → network/timeout-like error.
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(failResponse(429))
      .mockResolvedValueOnce(failResponse(500))
      .mockImplementationOnce(async () => { throw new Error('ETIMEDOUT') })

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    try {
      await router.route({ modelName: 'openai/gpt-5-mini', body: {} })
      throw new Error('expected throw')
    }
    catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).statusCode).toBe(504)
      expect((err as ApiError).errorCode).toBe('GATEWAY_TIMEOUT')
      expect((err as ApiError).details).toMatchObject({ triedKeys: 3, triedUpstreams: 2, lastStatusCode: 'timeout' })
    }
  })

  it('per-attempt timeout: upstream hangs longer than timeoutMs → router moves to next key', async () => {
    // ROOT CAUSE:
    //
    // Without the per-attempt AbortSignal.timeout wiring, one hung upstream
    // would block the entire full-chain budget. We assert the router treats
    // an AbortError as a timeout failure and continues to the next key.
    const { config, crypto } = makeConfig({
      upstreams: [{ baseURL: 'https://up-a.example/v1', keyIds: ['kA1', 'kA2'], timeoutMs: 25 }],
    })

    let firstCallSawAbort = false
    const fetchImpl = vi.fn()
      .mockImplementationOnce(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        await new Promise<void>((_resolve, reject) => {
          const sig = init?.signal
          if (sig != null) {
            sig.addEventListener('abort', () => {
              firstCallSawAbort = true
              reject(sig.reason ?? new Error('aborted'))
            }, { once: true })
          }
          // No resolve — wait for abort.
        })
      })
      .mockResolvedValueOnce(happyResponse({ ok: 1 }))

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    const res = await router.route({ modelName: 'openai/gpt-5-mini', body: {} })
    expect(res.status).toBe(200)
    expect(firstCallSawAbort).toBe(true)
    expect(fetchImpl.mock.calls.length).toBe(2)
  })

  it('full-chain timeout stops a slow attempt before its longer per-attempt timeout', async () => {
    const { config, crypto } = makeConfig({
      fullChainTimeoutMs: 20,
      upstreams: [{ baseURL: 'https://up-a.example/v1', keyIds: ['k1', 'k2'], timeoutMs: 100 }],
    })

    const fetchImpl = vi.fn().mockImplementation(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      await new Promise<void>((_resolve, reject) => {
        const sig = init?.signal
        sig?.addEventListener('abort', () => reject(sig.reason ?? new Error('aborted')), { once: true })
      })
    })

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    const result = router.route({ modelName: 'openai/gpt-5-mini', body: {} })

    await expect(result).rejects.toMatchObject({ statusCode: 504, errorCode: 'GATEWAY_TIMEOUT' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('pre-upstream validation: unknown model → throws 400, no fetch issued, no fallback metric', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up.example/v1', keyIds: ['k1'] }] })
    const fetchImpl = vi.fn()
    const metrics = makeMetrics()

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: metrics,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    try {
      await router.route({ modelName: 'nope/unknown', body: {} })
      throw new Error('expected throw')
    }
    catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).statusCode).toBe(400)
      expect((err as ApiError).errorCode).toBe('BAD_REQUEST')
    }

    expect(fetchImpl.mock.calls.length).toBe(0)
    expect((metrics.fallbackCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('config not set → throws 503 CONFIG_NOT_SET (no fetch issued)', async () => {
    const crypto = createEnvelopeCrypto({ masterKey: freshMasterKey() })
    const fetchImpl = vi.fn()
    const router = createLlmRouterService({
      configKV: makeConfigKV(null),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    await expect(router.route({ modelName: 'whatever', body: {} })).rejects.toMatchObject({ statusCode: 503, errorCode: 'CONFIG_NOT_SET' })
    expect(fetchImpl.mock.calls.length).toBe(0)
  })

  it('caller AbortSignal already-aborted → throws without dispatching any fetch', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up.example/v1', keyIds: ['k1'] }] })
    const fetchImpl = vi.fn()
    const ctrl = new AbortController()
    ctrl.abort(new Error('client-disconnected'))

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    await expect(router.route({ modelName: 'openai/gpt-5-mini', body: {}, abortSignal: ctrl.signal })).rejects.toThrow(/client-disconnected/)
    expect(fetchImpl.mock.calls.length).toBe(0)
  })

  it('caller AbortSignal aborts mid-flight → propagates, no fallback to next key', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up.example/v1', keyIds: ['k1', 'k2'] }] })

    const ctrl = new AbortController()
    const fetchImpl = vi.fn().mockImplementation(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      // Schedule caller-side abort on the next microtask so the router has a
      // chance to register its listener, then wait on the merged attempt
      // signal (which the router pre-wires from req.abortSignal).
      queueMicrotask(() => ctrl.abort(new Error('client-disconnected')))
      await new Promise<void>((_resolve, reject) => {
        const sig = init?.signal
        if (sig?.aborted) {
          reject(sig.reason ?? new Error('aborted'))
          return
        }
        sig?.addEventListener('abort', () => reject(sig.reason ?? new Error('aborted')), { once: true })
      })
    })

    const router = createLlmRouterService({
      configKV: makeConfigKV(config),
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    await expect(router.route({ modelName: 'openai/gpt-5-mini', body: {}, abortSignal: ctrl.signal })).rejects.toThrow(/client-disconnected/)
    // No fallback to k2: caller-abort short-circuits the loop.
    expect(fetchImpl.mock.calls.length).toBe(1)
  })

  it('config invalidate hook clears the cache (re-reads on next call)', async () => {
    const { config, crypto } = makeConfig({ upstreams: [{ baseURL: 'https://up.example/v1', keyIds: ['k1'] }] })
    const configKV = makeConfigKV(config)
    const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 }))

    const router = createLlmRouterService({
      configKV,
      envelopeCrypto: crypto,
      gatewayMetrics: null,
      fetchImpl,
      redis: makeRedisStub(),
      concurrencyLedger: makeLedger(),
    })

    await router.route({ modelName: 'openai/gpt-5-mini', body: {} })
    router.invalidateConfig()
    await router.route({ modelName: 'openai/gpt-5-mini', body: {} })

    // 2 fetches + 2 configKV reads (because invalidate fired between them)
    expect(fetchImpl.mock.calls.length).toBe(2)
    expect((configKV.getOptional as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  // --- routeTts adapter error contract -------------------------------------
  //
  // ROOT CAUSE:
  //
  // Before patch, `dispatchOneTtsUpstream` read `err.status` to decide
  // fallback, but `ApiError.statusCode` (not `.status`) is the canonical
  // field. Every adapter-internal `ApiError` (invalid voice, missing
  // adapter params, network wrap) was silently coerced to `'timeout'` and
  // walked every key + upstream before surfacing — wasting upstream quota
  // and hiding the actual user-facing 400 behind a 502 mapping.
  //
  // After patch: ApiError 4xx propagates immediately; ApiError 5xx folds
  // into the network-failure fallback path using `statusCode`; `Error &
  // { status }` stays on the existing fallback policy.
  describe('routeTts adapter error handling', () => {
    function makeTtsConfig(opts: {
      provider?: 'azure'
      upstreams?: Array<{ baseURL: string, keyIds: string[], adapterParams?: Record<string, unknown> }>
    }): { config: RouterConfig, crypto: ReturnType<typeof createEnvelopeCrypto> } {
      const crypto = createEnvelopeCrypto({ masterKey: freshMasterKey() })
      const modelName = 'tts-test'
      const upstreams = opts.upstreams ?? [{ baseURL: 'https://up-a.example', keyIds: ['kA1'] }]
      const upstreamConfigs = upstreams.map(u => ({
        baseURL: u.baseURL,
        keys: u.keyIds.map((id) => {
          const plaintext = `sk-${id}`
          const ct = crypto.encryptKey(plaintext, { modelName, keyEntryId: id })
          return { id, ciphertext: ct }
        }),
        adapterParams: u.adapterParams ?? {},
      }))
      const config: RouterConfig = {
        llm: { models: {} },
        tts: {
          models: {
            [modelName]: {
              provider: opts.provider ?? 'azure',
              upstreams: upstreamConfigs,
              fallbackTriggers: { httpCodes: [401, 429, 500, 502, 503, 504], onTimeout: true },
            },
          },
        },
        defaults: {
          perAttemptTimeoutMs: 5000,
          fullChainTimeoutMs: 10000,
          fallbackHttpCodes: [401, 429, 500, 502, 503, 504],
        },
      } as RouterConfig
      return { config, crypto }
    }

    it('apiError 4xx (invalid voice) propagates without touching the second key', async () => {
      // azure adapter validates `voice` against AZURE_VOICE_ID before any
      // network call; an invalid voice throws createBadRequestError(400).
      // Two keys are configured: the second must NEVER be tried.
      const { config, crypto } = makeTtsConfig({ upstreams: [{ baseURL: 'https://az.example', keyIds: ['kA1', 'kA2'] }] })
      const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 }))
      const metrics = makeMetrics()

      const router = createLlmRouterService({
        configKV: makeConfigKV(config),
        envelopeCrypto: crypto,
        gatewayMetrics: metrics,
        fetchImpl,
        redis: makeRedisStub(),
        concurrencyLedger: makeLedger(),
      })

      let caught: unknown
      try {
        await router.routeTts({
          modelName: 'tts-test',
          input: { text: 'hi', voice: 'bogus voice with spaces' },
        })
      }
      catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(ApiError)
      expect((caught as ApiError).statusCode).toBe(400)
      // The adapter rejects before fetch; with the bug this would have walked
      // both keys (and pushed fallback counters). After the fix: zero fetch,
      // zero fallback bookkeeping.
      expect(fetchImpl).not.toHaveBeenCalled()
      expect((metrics.fallbackCount.add as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    })

    it('apiError 5xx (adapter-wrapped network failure) walks to the next key', async () => {
      // azure adapter wraps a fetch reject as createInternalError(500).
      // The router should treat that as a fallback-eligible network failure
      // and try the second key — not propagate the 500 as a final error.
      const { config, crypto } = makeTtsConfig({ upstreams: [{ baseURL: 'https://az.example', keyIds: ['kA1', 'kA2'], adapterParams: { region: 'eastasia' } }] })

      let callIdx = 0
      const fetchImpl = vi.fn(async () => {
        callIdx += 1
        if (callIdx === 1)
          throw new TypeError('network unreachable')
        return new Response(new Uint8Array([0x01]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
      })
      const metrics = makeMetrics()

      const router = createLlmRouterService({
        configKV: makeConfigKV(config),
        envelopeCrypto: crypto,
        gatewayMetrics: metrics,
        fetchImpl,
        redis: makeRedisStub(),
        concurrencyLedger: makeLedger(),
      })

      const res = await router.routeTts({
        modelName: 'tts-test',
        input: { text: 'hi', voice: 'en-US-AvaMultilingualNeural' },
      })

      expect(res.status).toBe(200)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      // Adapter-wrapped 500 is in the fallback list, so one fallback hop is
      // recorded between key 1 and key 2.
      expect((metrics.fallbackCount.add as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    })

    it('upstream `Error & { status: 401 }` folds into the existing fallback path', async () => {
      // azure adapter throws `Error & { status: number }` on upstream non-2xx
      // (see azure.ts:189-194). 401 is in fallbackHttpCodes so we must try
      // the next key.
      const { config, crypto } = makeTtsConfig({ upstreams: [{ baseURL: 'https://az.example', keyIds: ['kA1', 'kA2'], adapterParams: { region: 'eastasia' } }] })

      let callIdx = 0
      const fetchImpl = vi.fn(async () => {
        callIdx += 1
        if (callIdx === 1)
          return failResponse(401)
        return new Response(new Uint8Array([0x01]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
      })
      const metrics = makeMetrics()

      const router = createLlmRouterService({
        configKV: makeConfigKV(config),
        envelopeCrypto: crypto,
        gatewayMetrics: metrics,
        fetchImpl,
        redis: makeRedisStub(),
        concurrencyLedger: makeLedger(),
      })

      const res = await router.routeTts({
        modelName: 'tts-test',
        input: { text: 'hi', voice: 'en-US-AvaMultilingualNeural' },
      })

      expect(res.status).toBe(200)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      const fallbackCalls = (metrics.fallbackCount.add as ReturnType<typeof vi.fn>).mock.calls
      expect(fallbackCalls.length).toBe(1)
      // Recorded reason matches the upstream status, not 'timeout' — that's
      // the regression: pre-fix this would have been 'timeout' because the
      // adapter's `Error & { status }` was read as undefined.
      expect(fallbackCalls[0][1]).toMatchObject({ reason: '401' })
    })

    it('listTtsVoices deduplicates concurrent cold-cache upstream fetches per model', async () => {
      // ROOT CAUSE:
      //
      // Azure voice catalogs are cached after a successful fetch, but concurrent
      // cold-cache requests used to miss Redis together and each hit unspeech's
      // microsoft voices endpoint. That can amplify one settings-page open into
      // several Azure voices/list calls and trigger upstream 429.
      //
      // We fixed this by sharing the in-flight catalog load for the same
      // provider/model cache key. Failures are still returned to every caller and
      // are not cached.
      const { config, crypto } = makeTtsConfig({
        upstreams: [{ baseURL: 'https://az.example', keyIds: ['kA1'], adapterParams: { region: 'eastasia' } }],
      })

      let resolveFetch!: () => void
      const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
        resolveFetch = () => resolve(happyResponse({
          voices: [{ id: 'en-US-AvaMultilingualNeural', name: 'Ava' }],
        }))
      }))

      const router = createLlmRouterService({
        configKV: makeConfigKV(config),
        envelopeCrypto: crypto,
        gatewayMetrics: null,
        fetchImpl,
        redis: makeRedisStub(),
        concurrencyLedger: makeLedger(),
      })

      const first = router.listTtsVoices('tts-test')
      const second = router.listTtsVoices('tts-test')

      await vi.waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(1)
      })
      resolveFetch()

      const [firstVoices, secondVoices] = await Promise.all([first, second])
      expect(firstVoices.map(voice => voice.id)).toEqual(['en-US-AvaMultilingualNeural'])
      expect(secondVoices.map(voice => voice.id)).toEqual(['en-US-AvaMultilingualNeural'])
    })
  })

  describe('routeTtspool capacity-aware routing', () => {
    // One app_id == one upstream (Volcengine `adapterParams.appid`), each capped
    // at `maxConcurrency`. The router spreads load least-loaded-first across pools
    // and circuit-breaks a pool on 429 (app_id concurrency exceeded upstream-side).
    function makePoolConfig(
      upstreams: Array<{ baseURL: string, appid: string, maxConcurrency?: number }>,
    ): { config: RouterConfig, crypto: ReturnType<typeof createEnvelopeCrypto> } {
      const crypto = createEnvelopeCrypto({ masterKey: freshMasterKey() })
      const modelName = 'tts-pool'
      const upstreamConfigs = upstreams.map((u, i) => {
        const id = `k${i}`
        const ct = crypto.encryptKey(`sk-${id}`, { modelName, keyEntryId: id })
        return {
          baseURL: u.baseURL,
          keys: [{ id, ciphertext: ct }],
          adapterParams: { appid: u.appid },
          ...(u.maxConcurrency != null ? { maxConcurrency: u.maxConcurrency } : {}),
        }
      })
      const config = {
        llm: { models: {} },
        tts: {
          models: {
            [modelName]: {
              provider: 'volcengine',
              upstreams: upstreamConfigs,
              fallbackTriggers: { httpCodes: [401, 429, 500, 502, 503, 504], onTimeout: true },
            },
          },
        },
        defaults: { perAttemptTimeoutMs: 5000, fullChainTimeoutMs: 10000, fallbackHttpCodes: [401, 429, 500, 502, 503, 504] },
      } as RouterConfig
      return { config, crypto }
    }

    // Stateful in-memory ledger so least-loaded ordering and capacity gating are
    // observable. `seed` pre-loads inflight counts to drive deterministic ranking.
    function makeStatefulLedger(seed: Record<string, number> = {}, saturatedSeed: string[] = []) {
      const inflight = new Map<string, number>(Object.entries(seed))
      const saturated = new Set<string>(saturatedSeed)
      const tryAcquire = vi.fn(async (poolId: string, max: number) => {
        const cur = inflight.get(poolId) ?? 0
        if (saturated.has(poolId) || cur >= max)
          return false
        inflight.set(poolId, cur + 1)
        return true
      })
      const release = vi.fn(async (poolId: string) => {
        inflight.set(poolId, Math.max(0, (inflight.get(poolId) ?? 0) - 1))
      })
      const markSaturated = vi.fn(async (poolId: string) => {
        saturated.add(poolId)
      })
      const ledger: ConcurrencyLedger = {
        tryAcquire,
        release,
        markSaturated,
        isSaturated: vi.fn(async (poolId: string) => saturated.has(poolId)),
        currentInflight: vi.fn(async (poolId: string) => inflight.get(poolId) ?? 0),
        snapshot: vi.fn(async () => [...inflight].map(([poolId, n]) => ({ poolId, inflight: n }))),
      }
      return { ledger, inflight, saturated, tryAcquire, release, markSaturated }
    }

    function makePoolRouter(config: RouterConfig, crypto: ReturnType<typeof createEnvelopeCrypto>, ledger: ConcurrencyLedger, fetchImpl: typeof fetch) {
      return createLlmRouterService({
        configKV: makeConfigKV(config),
        envelopeCrypto: crypto,
        gatewayMetrics: makeMetrics(),
        fetchImpl,
        redis: makeRedisStub(),
        concurrencyLedger: ledger,
      })
    }

    it('routes to the least-loadedpool (covers AE1 — load spread, not first-fill)', async () => {
      // @example two app_ids cap 10, seeded 8 vs 2 in-flight -> the new request
      // goes to the freer pool (app-2), not the config-first pool (app-1).
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1', maxConcurrency: 10 },
        { baseURL: 'https://up-b.example', appid: 'app-2', maxConcurrency: 10 },
      ])
      const { ledger, tryAcquire } = makeStatefulLedger({ 'app-1': 8, 'app-2': 2 })
      const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      const res = await router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })

      expect(res.status).toBe(200)
      expect(tryAcquire).toHaveBeenCalledTimes(1)
      expect(tryAcquire.mock.calls[0][0]).toBe('app-2')
    })

    it('skips a fullpool and dispatches to one with capacity', async () => {
      // @example app-1 at cap (10/10) -> filtered out; app-2 (0/10) serves.
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1', maxConcurrency: 10 },
        { baseURL: 'https://up-b.example', appid: 'app-2', maxConcurrency: 10 },
      ])
      const { ledger, tryAcquire } = makeStatefulLedger({ 'app-1': 10, 'app-2': 0 })
      const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      const res = await router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })

      expect(res.status).toBe(200)
      expect(tryAcquire.mock.calls.every(([poolId]) => poolId !== 'app-1')).toBe(true)
      expect(tryAcquire.mock.calls.some(([poolId]) => poolId === 'app-2')).toBe(true)
    })

    it('fails fast with 503 TTS_POOL_SATURATED when everypool is full (covers AE2 — no silent stall)', async () => {
      // @example both app_ids at cap -> 503, upstream is never dispatched.
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1', maxConcurrency: 10 },
        { baseURL: 'https://up-b.example', appid: 'app-2', maxConcurrency: 10 },
      ])
      const { ledger } = makeStatefulLedger({ 'app-1': 10, 'app-2': 10 })
      const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      let caught: unknown
      try {
        await router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })
      }
      catch (err) {
        caught = err
      }

      expect(caught).toBeInstanceOf(ApiError)
      expect((caught as ApiError).statusCode).toBe(503)
      expect((caught as ApiError).errorCode).toBe('TTS_POOL_SATURATED')
      expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('releases the slot after a successful dispatch', async () => {
      // @example acquire then release leaves the pool's inflight back at baseline.
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1', maxConcurrency: 10 },
      ])
      const { ledger, release, inflight } = makeStatefulLedger({ 'app-1': 3 })
      const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      await router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })

      expect(release).toHaveBeenCalledWith('app-1')
      expect(inflight.get('app-1')).toBe(3)
    })

    it('makes zero ledger calls when no upstream declares maxConcurrency (no regression)', async () => {
      // @example a model without any concurrency cap keeps the original
      // fixed-order path and never touches Redis.
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1' },
      ])
      const { ledger, tryAcquire } = makeStatefulLedger()
      const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      const res = await router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })

      expect(res.status).toBe(200)
      expect(tryAcquire).not.toHaveBeenCalled()
    })

    it('marks a pool saturated when it exhausts with a 429 (covers AE3 — bad-pool circuit break)', async () => {
      // @example single pool returns 429 (app_id concurrency exceeded) -> the
      // pool is circuit-broken so later requests skip it during the cool-down.
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1', maxConcurrency: 10 },
      ])
      const { ledger, markSaturated } = makeStatefulLedger()
      const fetchImpl = vi.fn(async () => failResponse(429)) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      await expect(router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })).rejects.toBeInstanceOf(ApiError)

      expect(markSaturated).toHaveBeenCalledWith('app-1', expect.any(Number))
    })

    it('does NOT mark saturated when a pool exhausts with a non-429 status', async () => {
      // @example a 500 is a server error, not a concurrency signal — the pool
      // must stay eligible rather than being circuit-broken.
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1', maxConcurrency: 10 },
      ])
      const { ledger, markSaturated } = makeStatefulLedger()
      const fetchImpl = vi.fn(async () => failResponse(500)) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      await expect(router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })).rejects.toBeInstanceOf(ApiError)

      expect(markSaturated).not.toHaveBeenCalled()
    })

    it('skips a pool already in a saturation cool-down', async () => {
      // @example app-1 flagged saturated -> filtered out; app-2 serves.
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1', maxConcurrency: 10 },
        { baseURL: 'https://up-b.example', appid: 'app-2', maxConcurrency: 10 },
      ])
      const { ledger, tryAcquire } = makeStatefulLedger({}, ['app-1'])
      const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      const res = await router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })

      expect(res.status).toBe(200)
      expect(tryAcquire.mock.calls.every(([poolId]) => poolId !== 'app-1')).toBe(true)
      expect(tryAcquire.mock.calls.some(([poolId]) => poolId === 'app-2')).toBe(true)
    })

    it('skips an uncapped pool already in a saturation cool-down when another pool is capped', async () => {
      // ROOT CAUSE:
      //
      // Before the fix, the capacity-aware branch returned uncapped pools as
      // always eligible without reading the saturation flag. In mixed configs
      // (`app-1` uncapped, `app-2` capped), a 429-saturated uncapped app stayed
      // first because it had infinite remaining capacity.
      //
      // We fixed this by checking cooldown state before the capped/uncapped
      // branch so both pool shapes honor the same circuit breaker.
      const { config, crypto } = makePoolConfig([
        { baseURL: 'https://up-a.example', appid: 'app-1' },
        { baseURL: 'https://up-b.example', appid: 'app-2', maxConcurrency: 10 },
      ])
      const { ledger, tryAcquire } = makeStatefulLedger({}, ['app-1'])
      const fetchImpl = vi.fn(async () => happyResponse({ ok: 1 })) as unknown as typeof fetch

      const router = makePoolRouter(config, crypto, ledger, fetchImpl)
      const res = await router.routeTts({ modelName: 'tts-pool', input: { text: 'hi' } })

      expect(res.status).toBe(200)
      expect(tryAcquire).toHaveBeenCalledTimes(1)
      expect(tryAcquire).toHaveBeenCalledWith('app-2', 10)
    })
  })
})
