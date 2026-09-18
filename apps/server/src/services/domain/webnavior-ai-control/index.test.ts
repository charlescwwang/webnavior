import type { Database } from '../../../libs/db'

import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWebnaviorAiControlService } from '.'
import { mockDB } from '../../../libs/mock-db'
import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'

import * as schema from '../../../schemas'

describe('webnavior AI control service', () => {
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

  it('encrypts a connection key without exposing it to management reads', async () => {
    const connection = await service.createConnection({
      baseURL: 'http://ollama.internal/v1',
      kind: 'ollama',
      name: '內網 Ollama',
      plaintextKey: 'secret-key',
      timeoutMs: 5000,
    })

    expect(connection).toMatchObject({ hasApiKey: true, name: '內網 Ollama' })
    expect(connection).not.toHaveProperty('apiKeyCiphertext')
    await expect(service.listConnections()).resolves.toEqual([expect.not.objectContaining({ apiKeyCiphertext: expect.anything() })])

    const stored = await db.query.webnaviorAiConnections.findFirst({
      where: (table, { eq }) => eq(table.id, connection.id),
    })
    expect(stored?.apiKeyCiphertext).toMatch(/^v1\./)
  })

  it('refreshes the stored catalog with the decrypted credential and binds only discovered models', async () => {
    const connection = await service.createConnection({
      baseURL: 'https://models.example/v1',
      kind: 'openai-compatible',
      name: '遠端模型服務',
      plaintextKey: 'catalog-key',
      timeoutMs: 5000,
    })
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'embeddinggemma' }, { id: 'gpt-oss' }] }), { status: 200 }))

    await expect(service.refreshConnectionModels(connection.id)).resolves.toMatchObject({
      discoveredModels: [{ id: 'embeddinggemma' }, { id: 'gpt-oss' }],
      hasApiKey: true,
      lastCheckError: null,
    })
    expect(fetchImpl).toHaveBeenCalledWith('https://models.example/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer catalog-key' },
    }))

    await expect(service.saveBinding({
      capability: 'embedding',
      connectionId: connection.id,
      modelId: 'embeddinggemma',
    })).resolves.toMatchObject({ capability: 'embedding', modelId: 'embeddinggemma' })
    await expect(service.saveBinding({
      capability: 'chat',
      connectionId: connection.id,
      modelId: 'not-in-catalog',
    })).rejects.toThrow('請先成功讀取')
  })

  it('keeps a connection referenced by a capability binding from being deleted', async () => {
    const connection = await service.createConnection({
      baseURL: 'http://ollama.internal/v1',
      kind: 'ollama',
      name: 'Ollama',
      timeoutMs: 5000,
    })
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ models: [{ id: 'gemma3' }] }), { status: 200 }))
    await service.refreshConnectionModels(connection.id)
    await service.saveBinding({ capability: 'vision', connectionId: connection.id, modelId: 'gemma3' })

    await expect(service.deleteConnection(connection.id)).rejects.toThrow('此服務仍被能力設定使用')
  })

  it('requires a new catalog after changing a connection endpoint', async () => {
    const connection = await service.createConnection({
      baseURL: 'http://ollama.internal/v1',
      kind: 'ollama',
      name: 'Ollama',
      timeoutMs: 5000,
    })
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ models: [{ id: 'gemma3' }] }), { status: 200 }))
    await service.refreshConnectionModels(connection.id)

    await expect(service.updateConnection(connection.id, {
      baseURL: 'https://models.example/v1',
      kind: 'openai-compatible',
      name: '遠端模型服務',
      timeoutMs: 5000,
    })).resolves.toMatchObject({ discoveredModels: [] })
  })
})
