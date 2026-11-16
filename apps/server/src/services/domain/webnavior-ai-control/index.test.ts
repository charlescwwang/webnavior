import type { Database } from '../../../libs/db'

import { Buffer } from 'node:buffer'

import { eq } from 'drizzle-orm'
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

  it('persists a verified chat fallback, preserves it across primary changes, and clears it explicitly', async () => {
    fetchImpl.mockImplementation(async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }))
    const input = { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses' as const, modelId: 'chat', timeoutMs: 5000 }
    const primary = await service.verifyAndCreateProfile('chat', { ...input, name: 'Primary' })
    const fallback = await service.verifyAndCreateProfile('chat', { ...input, name: 'Fallback', plaintextKey: 'fallback-secret' })
    const alternate = await service.verifyAndCreateProfile('chat', { ...input, name: 'Alternate' })
    const selected = await service.selectProfile('chat', primary.id, fallback.id)
    expect(selected.fallbackProviderProfileId).toBe(fallback.id)
    expect(selected.fallbackProviderProfile?.id).toBe(fallback.id)
    expect(selected.fallbackProviderProfile).not.toHaveProperty('apiKeyCiphertext')
    expect((await service.listSelections())[0].fallbackProviderProfile?.hasApiKey).toBe(true)
    expect((await service.selectProfile('chat', alternate.id)).fallbackProviderProfileId).toBe(fallback.id)
    await expect(service.selectProfile('chat', fallback.id)).rejects.toThrow('主要來源與備援來源不能相同')
    await expect(service.deleteProfile('chat', fallback.id)).rejects.toThrow('目前正在使用')
    const cleared = await service.selectProfile('chat', alternate.id, null)
    expect(cleared.fallbackProviderProfileId).toBeNull()
    expect(cleared.fallbackProviderProfile).toBeNull()
    await expect(service.deleteProfile('chat', fallback.id)).resolves.toBeUndefined()
  })

  it('rejects invalid fallback profiles without changing the saved selection', async () => {
    fetchImpl.mockImplementation(async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }))
    const input = { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses' as const, modelId: 'chat', timeoutMs: 5000 }
    const primary = await service.verifyAndCreateProfile('chat', { ...input, name: 'Primary' })
    const unverified = await service.createProfile('chat', { ...input, name: 'Unverified' })
    const vision = await service.createProfile('vision', { baseURL: 'https://models.example/v1', kind: 'openai-compatible', name: 'Vision', timeoutMs: 5000 })
    await service.selectProfile('chat', primary.id)
    await expect(service.selectProfile('chat', primary.id, primary.id)).rejects.toThrow('主要來源與備援來源不能相同')
    await expect(service.selectProfile('chat', primary.id, unverified.id)).rejects.toThrow('只能啟用已通過驗證')
    await expect(service.selectProfile('chat', primary.id, vision.id)).rejects.toThrow('找不到此 AI 能力')
    await expect(service.selectProfile('vision', vision.id, primary.id)).rejects.toThrow('只有對話能力')
    expect((await service.listSelections())[0].fallbackProviderProfileId).toBeNull()
  })

  it('persists native response modes and invalidates verification on transport changes', async () => {
    fetchImpl.mockImplementation(async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }))
    const input = { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses' as const, modelId: 'reasoning', name: 'Native', timeoutMs: 5000 }
    const profile = await service.verifyAndCreateProfile('chat', { ...input, responseMode: 'json' })
    expect(profile.responseMode).toBe('json')
    expect(profile.enableThinking).toBe(false)
    const updated = await service.updateProfile('chat', profile.id, { ...input, responseMode: 'sse' })
    expect(updated.responseMode).toBe('sse')
    expect(updated.verifiedAt).toBeNull()
  })

  it('forwards native verification timeout through new, saved, and edited profiles', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    fetchImpl.mockImplementation(async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }))
    try {
      const input = { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses' as const, modelId: 'reasoning', name: 'Native', timeoutMs: 60_000 }
      const profile = await service.verifyAndCreateProfile('chat', input)
      expect(timeout).toHaveBeenLastCalledWith(60_000)
      await service.verifyProfile('chat', profile.id)
      expect(timeout).toHaveBeenLastCalledWith(60_000)
      await service.verifyAndUpdateProfile('chat', profile.id, { ...input, timeoutMs: 35_000 })
      expect(timeout).toHaveBeenLastCalledWith(35_000)
    }
    finally {
      timeout.mockRestore()
    }
  })

  it.each(['vision', 'asr', 'tts'] as const)('rejects native Responses for %s before persistence or verification', async (capability) => {
    const input = { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses' as const, name: 'Native', modelId: 'reasoning', timeoutMs: 5000 }
    await expect(service.createProfile(capability, input)).rejects.toThrow()
    await expect(service.verifyAndCreateProfile(capability, input)).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await service.listProfiles()).toEqual([])
  })

  it('rejects the unsupported thinking toggle for native Responses', async () => {
    await expect(service.createProfile('chat', { baseURL: 'https://api.openai.com/v1', kind: 'openai-responses', name: 'Native', timeoutMs: 5000, enableThinking: true })).rejects.toThrow()
  })

  it('verifies, persists and revalidates an explicit SSE/JSON chat choice', async () => {
    fetchImpl.mockImplementation(async (_url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (body?.stream)
        return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
      return Response.json({ choices: [{ message: { content: 'OK' } }] })
    })
    const input = { baseURL: 'https://models.example/v1', kind: 'openai-compatible' as const, modelId: 'chat', name: 'Chat', timeoutMs: 5000 }
    const profile = await service.verifyAndCreateProfile('chat', { ...input, responseMode: 'sse' })
    expect(profile.responseMode).toBe('sse')
    expect(profile.verifiedAt).toBeTruthy()
    expect((await service.listProfiles())[0].responseMode).toBe('sse')
    const changed = await service.updateProfile('chat', profile.id, { ...input, responseMode: 'json' })
    expect(changed.verifiedAt).toBeNull()
    const verified = await service.verifyProfile('chat', profile.id)
    expect(verified.responseMode).toBe('json')
    expect(verified.verifiedAt).toBeTruthy()
    expect(JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body)).stream).not.toBe(true)
  })

  it('persists and verifies the thinking choice when editing an OpenAI-compatible chat provider', async () => {
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ choices: [{}] }), { status: 200 }))
    const input = { baseURL: 'https://vllm.example/v1', kind: 'openai-compatible' as const, modelId: 'qwen', name: 'vLLM', timeoutMs: 5000 }
    const profile = await service.verifyAndCreateProfile('chat', input)
    expect(profile.enableThinking).toBe(false)
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).chat_template_kwargs).toEqual({ enable_thinking: false })
    const updated = await service.verifyAndUpdateProfile('chat', profile.id, { ...input, enableThinking: true })
    expect(updated.enableThinking).toBe(true)
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).chat_template_kwargs).toEqual({ enable_thinking: true })
    await service.verifyProfile('chat', profile.id)
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body)).chat_template_kwargs).toEqual({ enable_thinking: true })
    const profiles = await service.listProfiles()
    expect(profiles[0].enableThinking).toBe(true)
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
  it('persists admin TTS speed and uses the selected speed for verification and edits', async () => {
    fetchImpl.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }))
    const input = { baseURL: 'https://tts.example/v1', kind: 'openai-compatible' as const, modelId: 'tts', name: 'Speed test', timeoutMs: 5000, speed: 1.25 }
    const profile = await service.verifyAndCreateProfile('tts', input)
    expect(profile.speed).toBe(1.25)
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)).speed).toBe(1.25)
    const updated = await service.verifyAndUpdateProfile('tts', profile.id, { ...input, speed: 0.85 })
    expect(updated.speed).toBe(0.85)
    const saved = await service.listProfiles()
    expect(saved.find(row => row.id === profile.id)?.speed).toBe(0.85)
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)).speed).toBe(0.85)
  })

  // Report: this chat Nov10 — migrated null speed means the already-verified 1x policy.
  it('keeps an existing TTS verification when saving its unchanged default speed', async () => {
    fetchImpl.mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'audio/mpeg' } }))
    const input = { baseURL: 'https://tts.example/v1', kind: 'openai-compatible' as const, modelId: 'tts', voice: 'existing-voice', name: 'Existing TTS', timeoutMs: 5000 }
    const profile = await service.verifyAndCreateProfile('tts', input)
    // This is the persisted shape of a previously verified profile after 0047.
    await db.update(schema.webnaviorAiProviderProfiles).set({ speed: null }).where(eq(schema.webnaviorAiProviderProfiles.id, profile.id))
    const renamed = await service.updateProfile('tts', profile.id, { ...input, name: 'Renamed TTS', speed: 1 })
    expect(renamed.verifiedAt).toEqual(profile.verifiedAt)
    await expect(service.selectProfile('tts', profile.id)).resolves.toMatchObject({ capability: 'tts', providerProfileId: profile.id })
    const changed = await service.updateProfile('tts', profile.id, { ...input, speed: 0.85 })
    expect(changed.verifiedAt).toBeNull()
    await expect(service.selectProfile('tts', profile.id)).rejects.toThrow('只能啟用已通過驗證')
  })
})
