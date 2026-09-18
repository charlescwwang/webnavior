import type { Database } from '../../../libs/db'

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
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ data: [
        { id: 'chat-model' },
        { id: 'vision-model' },
        { id: 'asr-model' },
        { id: 'tts-model' },
        { id: 'embedding-model' },
      ] }), { status: 200 })),
    })
    runtime = createWebnaviorAiRuntimeService({
      configKV: configKV as any,
      db,
      envelopeCrypto,
      redis: redis as any,
    })
  })

  it('rebuilds the Kiosk runtime only from current capability bindings', async () => {
    const connection = await control.createConnection({
      baseURL: 'https://models.example/v1',
      kind: 'openai-compatible',
      name: '主要模型服務',
      plaintextKey: 'server-secret',
      timeoutMs: 7500,
    })
    await control.refreshConnectionModels(connection.id)
    await Promise.all([
      control.saveBinding({ capability: 'chat', connectionId: connection.id, modelId: 'chat-model' }),
      control.saveBinding({ capability: 'vision', connectionId: connection.id, modelId: 'vision-model' }),
      control.saveBinding({ capability: 'asr', connectionId: connection.id, modelId: 'asr-model' }),
      control.saveBinding({ capability: 'tts', connectionId: connection.id, modelId: 'tts-model', voice: 'zh-TW-Test' }),
      control.saveBinding({ capability: 'embedding', connectionId: connection.id, modelId: 'embedding-model' }),
    ])

    await expect(runtime.applyBindings()).resolves.toEqual({
      appliedCapabilities: expect.arrayContaining(['chat', 'vision', 'asr', 'tts', 'embedding']),
    })
    await expect(runtime.modelFor('chat')).resolves.toBe('webnavior/chat')
    await expect(runtime.modelFor('vision')).resolves.toBe('webnavior/vision')

    expect(store.get('LLM_ROUTER_CONFIG')).toMatchObject({
      llm: {
        models: {
          'webnavior/chat': { upstreams: [{ baseURL: 'https://models.example/v1', overrideModel: 'chat-model' }] },
          'webnavior/vision': { upstreams: [{ baseURL: 'https://models.example/v1', overrideModel: 'vision-model' }] },
        },
      },
      tts: { models: {} },
    })
    expect(store.get('WEBNAVIOR_AUDIO_CONFIG')).toMatchObject({
      asr: { modelName: 'webnavior:asr', upstreamModel: 'asr-model' },
      tts: { modelName: 'webnavior:tts', upstreamModel: 'tts-model', voice: 'zh-TW-Test' },
    })
    expect(store.get('WEBNAVIOR_EMBEDDING_CONFIG')).toMatchObject({
      modelName: 'embedding-model',
      provider: 'openai-compatible',
      timeoutMs: 7500,
    })
  })
})
