import type { Database } from '../../../libs/db'

import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWebnaviorAiControlService } from '.'
import { mockDB } from '../../../libs/mock-db'
import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'

import * as schema from '../../../schemas'

describe('webnavior AI capability Provider profiles', () => {
  let db: Database
  let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>
  let service: ReturnType<typeof createWebnaviorAiControlService>

  beforeEach(async () => {
    db = await mockDB(schema)
    fetchImpl = vi.fn<typeof fetch>()
    service = createWebnaviorAiControlService({
      db,
      envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 7) }),
      fetchImpl,
    })
  })

  it('keeps Provider profiles scoped to one capability without exposing credentials', async () => {
    const profile = await service.createProfile('chat', {
      baseURL: 'http://ollama.internal/v1',
      kind: 'ollama',
      name: '店內對話模型',
      plaintextKey: 'secret-key',
      timeoutMs: 5000,
    })

    expect(profile).toMatchObject({ capability: 'chat', hasApiKey: true, name: '店內對話模型' })
    expect(profile).not.toHaveProperty('apiKeyCiphertext')
    await expect(service.listProfiles()).resolves.toEqual([expect.not.objectContaining({ apiKeyCiphertext: expect.anything() })])

    const stored = await db.query.webnaviorAiProviderProfiles.findFirst({
      where: (table, { eq }) => eq(table.id, profile.id),
    })
    expect(stored?.apiKeyCiphertext).toMatch(/^v1\./)
  })

  it('tests a new Provider connection without persisting a partial profile', async () => {
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'gemma3' }] }), { status: 200 }))

    await expect(service.testProviderConnection({
      baseURL: 'http://ollama.internal/v1',
      plaintextKey: 'temporary-secret',
      timeoutMs: 7500,
    })).resolves.toEqual({ catalogAvailable: true, models: [{ id: 'gemma3' }] })
    await expect(service.listProfiles()).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledWith('http://ollama.internal/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer temporary-secret' },
    }))
  })

  it('allows a reachable Provider without a model catalog to use a manually supplied model ID', async () => {
    fetchImpl.mockImplementation(async (url) => {
      if (String(url).endsWith('/models'))
        return new Response(null, { status: 404 })
      if (String(url).endsWith('/chat/completions'))
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
      return new Response(null, { status: 404 })
    })

    await expect(service.testProviderConnection({
      baseURL: 'https://models.example/v1',
      timeoutMs: 5000,
    })).resolves.toMatchObject({ catalogAvailable: false, models: [] })

    await expect(service.verifyAndCreateProfile('chat', {
      baseURL: 'https://models.example/v1',
      kind: 'openai-compatible',
      modelId: 'gemma4:26b',
      name: '不提供清單的服務',
      timeoutMs: 5000,
    })).resolves.toMatchObject({
      discoveredModels: [{ id: 'gemma4:26b' }],
      modelId: 'gemma4:26b',
      verifiedAt: expect.any(Date),
    })
  })

  it('does not overwrite an existing Provider when its changed settings fail verification', async () => {
    const profile = await service.createProfile('chat', {
      baseURL: 'https://models.example/v1',
      kind: 'openai-compatible',
      modelId: 'gemma-3-4b-it',
      name: '原本的設定',
      timeoutMs: 5000,
    })
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ error: 'bad model' }), { status: 400 }))

    await expect(service.verifyAndUpdateProfile('chat', profile.id, {
      baseURL: 'https://new-models.example/v1',
      kind: 'openai-compatible',
      modelId: 'new-gemma',
      name: '失敗的新設定',
      timeoutMs: 5000,
    })).rejects.toThrow()

    await expect(service.listProfiles()).resolves.toEqual([expect.objectContaining({
      baseURL: 'https://models.example/v1',
      modelId: 'gemma-3-4b-it',
      name: '原本的設定',
    })])
  })

  it('requires a capability-local verified profile before selection', async () => {
    const profile = await service.createProfile('chat', {
      baseURL: 'https://models.example/v1',
      kind: 'openai-compatible',
      name: '遠端對話模型',
      timeoutMs: 5000,
    })
    fetchImpl.mockImplementation(async (url) => {
      if (String(url).endsWith('/models'))
        return new Response(JSON.stringify({ data: [{ id: 'gemma-3-4b-it' }] }), { status: 200 })
      if (String(url).endsWith('/chat/completions'))
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
      return new Response(null, { status: 404 })
    })

    await service.refreshProfileModels('chat', profile.id)
    await service.updateProfile('chat', profile.id, {
      baseURL: 'https://models.example/v1',
      kind: 'openai-compatible',
      modelId: 'gemma-3-4b-it',
      name: '遠端對話模型',
      timeoutMs: 5000,
    })
    await expect(service.selectProfile('chat', profile.id)).rejects.toThrow('只能啟用已通過驗證')
    await service.verifyProfile('chat', profile.id)
    await expect(service.selectProfile('chat', profile.id)).resolves.toMatchObject({
      capability: 'chat',
      providerProfile: { id: profile.id, name: '遠端對話模型' },
    })
    await expect(service.selectProfile('vision', profile.id)).rejects.toThrow('找不到此 AI 能力')
  })

  it('does not allow deletion of the currently selected Provider profile', async () => {
    const profile = await service.createProfile('chat', {
      baseURL: 'http://ollama.internal/v1',
      kind: 'ollama',
      modelId: 'gemma3',
      name: '主要對話模型',
      timeoutMs: 5000,
    })
    fetchImpl.mockImplementation(async url => String(url).endsWith('/models')
      ? new Response(JSON.stringify({ models: [{ id: 'gemma3' }] }), { status: 200 })
      : new Response(JSON.stringify({ choices: [{}] }), { status: 200 }))
    await service.refreshProfileModels('chat', profile.id)
    await service.verifyProfile('chat', profile.id)
    await service.selectProfile('chat', profile.id)

    await expect(service.deleteProfile('chat', profile.id)).rejects.toThrow('此 Provider 目前正在使用')
  })
})
