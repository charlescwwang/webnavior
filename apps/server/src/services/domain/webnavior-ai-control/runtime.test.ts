import type { Database } from '../../../libs/db'
import type { WebnaviorAiCapability } from '../../../schemas/webnavior-ai'

import { Buffer } from 'node:buffer'

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
