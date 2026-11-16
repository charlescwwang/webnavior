import type { Database } from '../../../libs/db'
import type { WebnaviorAiCapability } from '../../../schemas/webnavior-ai'

import { Buffer } from 'node:buffer'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWebnaviorAiControlService } from '.'
import { mockDB } from '../../../libs/mock-db'
import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'
import { createWebnaviorAiRuntimeService } from './runtime'

import * as schema from '../../../schemas'

describe('webnavior AI runtime compiler', () => {
  let db: Database
  let store: Map<string, unknown>
  let control: ReturnType<typeof createWebnaviorAiControlService>
  let runtime: ReturnType<typeof createWebnaviorAiRuntimeService>

  beforeEach(async () => {
    db = await mockDB(schema)
    store = new Map()
    const envelopeCrypto = createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 9) })
    const configKV = {
      getOptional: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
      unset: vi.fn(async (key: string) => { store.delete(key) }),
    }
    const redis = { publish: vi.fn(async () => 1) }
    control = createWebnaviorAiControlService({
      db,
      envelopeCrypto,
      fetchImpl: vi.fn(async (url, init) => {
        const endpoint = String(url)
        if (endpoint.endsWith('/chat/completions') && init?.body && JSON.parse(String(init.body)).stream === true)
          return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
        if (endpoint.endsWith('/responses')) {
          const result = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }
          return JSON.parse(String(init?.body)).stream
            ? new Response(`data: ${JSON.stringify({ type: 'response.completed', response: result })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
            : Response.json(result)
        }
        if (endpoint.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [
            { id: 'chat-model' },
            { id: 'vision-model' },
            { id: 'asr-model' },
            { id: 'tts-model' },
          ] }), { status: 200 })
        }
        if (endpoint.endsWith('/audio/transcriptions'))
          return new Response(JSON.stringify({ text: '' }), { status: 200 })
        if (endpoint.endsWith('/audio/speech'))
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
        return new Response(JSON.stringify({ choices: [{}] }), { status: 200 })
      }),
    })
    runtime = createWebnaviorAiRuntimeService({
      configKV: configKV as any,
      db,
      envelopeCrypto,
      redis: redis as any,
    })
  })

  it('compiles primary and native fallback in order with independent credentials and transport policies', async () => {
    const primary = await control.verifyAndCreateProfile('chat', { baseURL: 'https://local.example/v1', kind: 'openai-compatible', modelId: 'chat-model', name: 'Qwen', plaintextKey: 'primary-secret', responseMode: 'sse', timeoutMs: 7500 })
    const fallback = await control.verifyAndCreateProfile('chat', { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses', modelId: 'chat-model', name: 'OpenAI', plaintextKey: 'fallback-secret', responseMode: 'json', timeoutMs: 12000 })
    await control.selectProfile('chat', primary.id, fallback.id)
    await runtime.applyBindings()
    const router = store.get('LLM_ROUTER_CONFIG') as { llm: { models: Record<string, { upstreams: { baseURL: string, keys: { id: string, ciphertext: string }[] }[] }> } }
    const upstreams = router.llm.models['webnavior/chat'].upstreams
    expect(upstreams).toHaveLength(2)
    expect(upstreams[0]).toMatchObject({ baseURL: primary.baseURL, responseMode: 'sse', enableThinking: false })
    expect(upstreams[1]).toMatchObject({ baseURL: fallback.baseURL, apiFormat: 'openai-responses', responseMode: 'json', timeoutMs: 12000 })
    expect(upstreams[1]).not.toHaveProperty('enableThinking')
    expect(upstreams[0].keys[0].id).not.toBe(upstreams[1].keys[0].id)
    const crypto = createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 9) })
    expect(crypto.decryptKey(upstreams[0].keys[0].ciphertext, { keyEntryId: upstreams[0].keys[0].id, modelName: 'webnavior/chat' }).toString()).toBe('primary-secret')
    expect(crypto.decryptKey(upstreams[1].keys[0].ciphertext, { keyEntryId: upstreams[1].keys[0].id, modelName: 'webnavior/chat' }).toString()).toBe('fallback-secret')
    await control.selectProfile('chat', primary.id, null)
    await runtime.applyBindings()
    const cleared = store.get('LLM_ROUTER_CONFIG') as typeof router
    expect(cleared.llm.models['webnavior/chat'].upstreams).toHaveLength(1)
  })

  it('changes the runtime credential identity when the same saved profile receives a different API key', async () => {
    const input = { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses' as const, modelId: 'chat-model', name: 'Native', timeoutMs: 7500 }
    const profile = await control.verifyAndCreateProfile('chat', { ...input, plaintextKey: 'old-secret' })
    // An already persisted revision makes this independent of millisecond clock resolution.
    await db.update(schema.webnaviorAiProviderProfiles).set({ updatedAt: new Date('2026-01-01T00:00:00Z') }).where(eq(schema.webnaviorAiProviderProfiles.id, profile.id))
    await control.selectProfile('chat', profile.id)
    await runtime.applyBindings()
    const oldRouter = store.get('LLM_ROUTER_CONFIG') as { llm: { models: Record<string, { upstreams: { keys: { id: string, ciphertext: string }[] }[] }> } }
    const oldKey = oldRouter.llm.models['webnavior/chat'].upstreams[0].keys[0]
    await control.verifyAndUpdateProfile('chat', profile.id, { ...input, plaintextKey: 'new-secret' })
    await runtime.applyBindings()
    const newRouter = store.get('LLM_ROUTER_CONFIG') as typeof oldRouter
    const newKey = newRouter.llm.models['webnavior/chat'].upstreams[0].keys[0]
    expect(newKey.id).not.toBe(oldKey.id)
    expect(newKey.id).not.toContain('old-secret')
    expect(newKey.id).not.toContain('new-secret')
    const crypto = createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 9) })
    expect(crypto.decryptKey(newKey.ciphertext, { keyEntryId: newKey.id, modelName: 'webnavior/chat' }).toString()).toBe('new-secret')
    expect(() => crypto.decryptKey(newKey.ciphertext, { keyEntryId: oldKey.id, modelName: 'webnavior/chat' })).toThrow()
  })

  it('rejects a chat backup referencing a different capability before publishing any runtime settings', async () => {
    const input = { baseURL: 'https://models.example/v1', kind: 'openai-compatible' as const, timeoutMs: 7500 }
    const primary = await control.verifyAndCreateProfile('chat', { ...input, modelId: 'chat-model', name: 'Chat' })
    const vision = await control.verifyAndCreateProfile('vision', { ...input, modelId: 'vision-model', name: 'Vision' })
    await control.selectProfile('chat', primary.id)
    // The foreign key protects identity, while capability equality is a domain invariant.
    await db.update(schema.webnaviorAiCapabilitySelections).set({ fallbackProviderProfileId: vision.id }).where(eq(schema.webnaviorAiCapabilitySelections.capability, 'chat'))
    await expect(runtime.applyBindings()).rejects.toThrow('備援來源必須屬於對話能力')
    expect(store.size).toBe(0)
  })

  it('reserves the full configured backup timeout after a sixty-second primary attempt', async () => {
    const input = { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses' as const, modelId: 'chat-model', timeoutMs: 60_000 }
    const primary = await control.verifyAndCreateProfile('chat', { ...input, name: 'Primary' })
    const fallback = await control.verifyAndCreateProfile('chat', { ...input, name: 'Fallback' })
    await control.selectProfile('chat', primary.id, fallback.id)
    await runtime.applyBindings()
    expect(store.get('LLM_ROUTER_CONFIG')).toMatchObject({
      defaults: { fullChainTimeoutMs: 120_000 },
      llm: { models: { 'webnavior/chat': { upstreams: [{ timeoutMs: 60_000 }, { timeoutMs: 60_000 }] } } },
    })
  })

  it('does not publish partial runtime changes when a fallback loses verification', async () => {
    const input = { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses' as const, modelId: 'chat-model', timeoutMs: 7500 }
    const primary = await control.verifyAndCreateProfile('chat', { ...input, name: 'Primary' })
    const fallback = await control.verifyAndCreateProfile('chat', { ...input, name: 'Fallback' })
    await control.selectProfile('chat', primary.id, fallback.id)
    await runtime.applyBindings()
    const previous = store.get('LLM_ROUTER_CONFIG')
    await control.updateProfile('chat', fallback.id, { ...input, name: 'Fallback', modelId: 'changed' })
    await expect(runtime.applyBindings()).rejects.toThrow('尚未通過目前模型的驗證')
    expect(store.get('LLM_ROUTER_CONFIG')).toBe(previous)
  })

  it.each(['auto', 'json', 'sse'] as const)('compiles the saved %s chat response policy on apply', async (responseMode) => {
    const profile = await control.verifyAndCreateProfile('chat', {
      baseURL: 'https://models.example/v1',
      kind: 'openai-compatible',
      modelId: 'chat-model',
      name: 'Chat',
      timeoutMs: 7500,
      responseMode,
    })
    await control.selectProfile('chat', profile.id)
    await runtime.applyBindings()
    expect(store.get('LLM_ROUTER_CONFIG')).toMatchObject({ llm: { models: { 'webnavior/chat': { upstreams: [{ responseMode }] } } } })
  })

  it.each(['auto', 'json', 'sse'] as const)('compiles native Responses %s without local thinking parameters', async (responseMode) => {
    const profile = await control.verifyAndCreateProfile('chat', { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses', modelId: 'chat-model', name: 'Native', timeoutMs: 7500, responseMode })
    await control.selectProfile('chat', profile.id)
    await runtime.applyBindings()
    expect(store.get('LLM_ROUTER_CONFIG')).toMatchObject({ llm: { models: { 'webnavior/chat': { upstreams: [{ apiFormat: 'openai-responses', responseMode }] } } } })
    expect(JSON.stringify(store.get('LLM_ROUTER_CONFIG'))).not.toContain('enableThinking')
    expect(JSON.stringify(store.get('LLM_ROUTER_CONFIG'))).not.toContain('chat_template')
  })

  it('rebuilds Kiosk runtime only from active, verified capability profiles', async () => {
    const capabilities: WebnaviorAiCapability[] = ['chat', 'vision', 'asr', 'tts']
    for (const capability of capabilities) {
      const profile = await control.createProfile(capability, {
        baseURL: 'https://models.example/v1',
        kind: capability === 'chat' ? 'llama-cpp' : 'openai-compatible',
        modelId: `${capability}-model`,
        name: `${capability} 主要 Provider`,
        plaintextKey: 'server-secret',
        timeoutMs: 7500,
        ...(capability === 'tts' ? { voice: 'zh-TW-Test', speed: 1.25 } : {}),
      })
      await control.refreshProfileModels(capability, profile.id)
      await control.verifyProfile(capability, profile.id)
      await control.selectProfile(capability, profile.id)
    }

    await expect(runtime.applyBindings()).resolves.toEqual({
      appliedCapabilities: expect.arrayContaining(['chat', 'vision', 'asr', 'tts']),
    })
    await expect(runtime.modelFor('chat')).resolves.toBe('webnavior/chat')
    await expect(runtime.modelFor('vision')).resolves.toBe('webnavior/vision')

    expect(store.get('LLM_ROUTER_CONFIG')).toMatchObject({
      llm: {
        models: {
          'webnavior/chat': { upstreams: [{ baseURL: 'https://models.example/v1', cachePrompt: true, overrideModel: 'chat-model', timeoutMs: 7500 }] },
          'webnavior/vision': { upstreams: [{ baseURL: 'https://models.example/v1', overrideModel: 'vision-model', timeoutMs: 7500 }] },
        },
      },
      tts: { models: {} },
    })
    expect(store.get('WEBNAVIOR_AUDIO_CONFIG')).toMatchObject({
      asr: { modelName: 'webnavior:asr', upstreamModel: 'asr-model' },
      tts: { modelName: 'webnavior:tts', upstreamModel: 'tts-model', voice: 'zh-TW-Test', speed: 1.25 },
    })
  })

  it.each([true, false])('applies the saved chat thinking choice: %s', async (enableThinking) => {
    const profile = await control.verifyAndCreateProfile('chat', {
      baseURL: 'https://vllm.example/v1',
      kind: 'openai-compatible',
      modelId: 'chat-model',
      name: 'vLLM',
      timeoutMs: 7500,
      enableThinking,
    })
    await control.selectProfile('chat', profile.id)
    await runtime.applyBindings()
    expect(store.get('LLM_ROUTER_CONFIG')).toMatchObject({
      llm: { models: { 'webnavior/chat': { upstreams: [{ enableThinking }] } } },
    })
  })

  it.each(['ollama', 'llama-cpp', 'openai-compatible'] as const)('compiles model residency only for Ollama: %s', async (kind) => {
    const profile = await control.createProfile('chat', { baseURL: 'https://models.example/v1', kind, modelId: 'chat-model', name: 'Chat provider', timeoutMs: 7500 })
    await control.refreshProfileModels('chat', profile.id)
    await control.verifyProfile('chat', profile.id)
    await control.selectProfile('chat', profile.id)
    await runtime.applyBindings()
    if (kind === 'ollama')
      expect(store.get('LLM_ROUTER_CONFIG')).toMatchObject({ llm: { models: { 'webnavior/chat': { upstreams: [{ ollamaKeepAlive: -1 }] } } } })
    else
      expect(JSON.stringify(store.get('LLM_ROUTER_CONFIG'))).not.toContain('ollamaKeepAlive')
    if (kind !== 'openai-compatible')
      expect(JSON.stringify(store.get('LLM_ROUTER_CONFIG'))).not.toContain('enableThinking')
  })
})
