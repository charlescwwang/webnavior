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
      fetchImpl: vi.fn(async (url) => {
        const endpoint = String(url)
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
        ...(capability === 'tts' ? { voice: 'zh-TW-Test' } : {}),
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
      tts: { modelName: 'webnavior:tts', upstreamModel: 'tts-model', voice: 'zh-TW-Test' },
    })
  })
})
