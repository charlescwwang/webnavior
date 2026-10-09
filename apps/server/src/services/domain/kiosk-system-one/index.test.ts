import type { Database } from '../../../libs/db'

import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKioskSystemOneService } from '.'
import { mockDB } from '../../../libs/mock-db'
import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'
import { defaultDecisionInstruction } from '../kiosk-interaction-decision/prompt'

import * as schema from '../../../schemas'

describe('kiosk System One profiles', () => {
  let db: Database
  let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>
  let service: ReturnType<typeof createKioskSystemOneService>

  beforeEach(async () => {
    db = await mockDB(schema)
    fetchImpl = vi.fn<typeof fetch>()
    service = createKioskSystemOneService({
      db,
      envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 4) }),
      fetchImpl,
    })
  })

  it('encrypts credentials without returning them to System Managers', async () => {
    const profile = await service.save({ baseURL: 'http://dasein.local', implementation: 'lookski', modelId: 'gemma-3-4b-it', name: '店內 Gemma', plaintextKey: 'secret', timeoutMs: 5000 })

    expect(profile).toMatchObject({ hasApiKey: true, implementation: 'lookski', modelId: 'gemma-3-4b-it' })
    expect(profile).not.toHaveProperty('apiKeyCiphertext')
    const stored = await db.query.kioskSystemOneProfiles.findFirst()
    expect(stored?.apiKeyCiphertext).toMatch(/^v1\./)
  })

  it('persists an editable System One prompt while allowing the built-in prompt to remain current', async () => {
    await expect(service.getPolicy()).resolves.toMatchObject({ decisionInstruction: '', defaultDecisionInstruction: expect.any(String), storeInstruction: '', updatedAt: null })

    await expect(service.savePolicy({ decisionInstruction: '  只選現有候選。  ', storeInstruction: '  顧客說套餐時先開啟套餐分類。  ' })).resolves.toMatchObject({
      decisionInstruction: '只選現有候選。',
      storeInstruction: '顧客說套餐時先開啟套餐分類。',
    })
    await expect(service.getPolicy()).resolves.toMatchObject({ decisionInstruction: '只選現有候選。', storeInstruction: '顧客說套餐時先開啟套餐分類。' })
  })

  it('stores an exact restored default as an empty override', async () => {
    await expect(service.savePolicy({ decisionInstruction: defaultDecisionInstruction, storeInstruction: '' })).resolves.toMatchObject({
      decisionInstruction: '',
      defaultDecisionInstruction,
    })
  })

  it('updates a profile without replacing an omitted credential and requires readiness again', async () => {
    const profile = await service.save({ baseURL: 'http://dasein.local', implementation: 'dasein', modelId: 'gemma-3-4b-it', name: '店內 Gemma', plaintextKey: 'secret', timeoutMs: 5000 })
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 1 } } })))
    await service.readiness(profile.id)

    await expect(service.update(profile.id, {
      baseURL: 'http://dasein.local',
      implementation: 'lookski',
      modelId: 'gemma-3-4b-it',
      name: '店內 Gemma 30 秒',
      timeoutMs: 30_000,
    })).resolves.toMatchObject({ hasApiKey: true, implementation: 'lookski', name: '店內 Gemma 30 秒', timeoutMs: 30_000, verifiedAt: null })
  })

  it('allows deletion of an unverified profile but protects the active profile', async () => {
    const pending = await service.save({ baseURL: 'http://dasein.local', implementation: 'dasein', modelId: 'gemma-3-4b-it', name: '待驗證', timeoutMs: 5000 })
    await service.delete(pending.id)
    await expect(service.list()).resolves.toEqual([])

    const active = await service.save({ baseURL: 'http://dasein.local', implementation: 'dasein', modelId: 'gemma-3-4b-it', name: '目前使用', timeoutMs: 5000 })
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 1 } } })))
    await service.readiness(active.id)
    await service.activate(active.id)

    await expect(service.delete(active.id)).rejects.toThrow('目前正在使用')
  })

  it('deactivates the active profile and deactivates it when its connection changes', async () => {
    const profile = await service.save({ baseURL: 'http://dasein.local', implementation: 'dasein', modelId: 'gemma-3-4b-it', name: '目前使用', timeoutMs: 5000 })
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 1 } } })))
    await service.readiness(profile.id)
    await service.activate(profile.id)

    await expect(service.deactivate(profile.id)).resolves.toMatchObject({ id: profile.id, isActive: false })
    expect(await service.isEnabled()).toBe(false)

    await service.readiness(profile.id)
    await service.activate(profile.id)
    expect(await service.isEnabled()).toBe(true)
    await expect(service.update(profile.id, {
      baseURL: 'http://dasein.new',
      implementation: 'lookski',
      modelId: 'gemma-3-4b-it',
      name: '目前使用',
      timeoutMs: 5000,
    })).resolves.toMatchObject({ isActive: false, verifiedAt: null })
  })

  it('reports a duplicate profile name as a conflict', async () => {
    await service.save({ baseURL: 'http://dasein.local', implementation: 'dasein', modelId: 'gemma-3-4b-it', name: '店內 Gemma', timeoutMs: 5000 })

    await expect(service.save({ baseURL: 'http://dasein.backup', implementation: 'lookski', modelId: 'gemma-3-4b-it', name: '店內 Gemma', timeoutMs: 5000 }))
      .rejects
      .toMatchObject({ errorCode: 'CONFLICT', statusCode: 409 })
  })

  it('requires a real System One answer before activation', async () => {
    const profile = await service.save({ baseURL: 'http://dasein.local/', implementation: 'dasein', modelId: 'gemma-3-4b-it', name: '店內 Gemma', timeoutMs: 5000 })
    await expect(service.activate(profile.id)).rejects.toThrow('請先通過 readiness')

    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 1 } } })))
    await service.readiness(profile.id)
    await expect(service.activate(profile.id)).resolves.toMatchObject({ id: profile.id, isActive: true })
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://dasein.local/v1/systemone')
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).not.toHaveProperty('model')
  })

  it('reads Dasein’s actual loaded model from its health payload', async () => {
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ model: 'google/gemma-3-4b-it', ok: true })))

    await expect(service.inspectRuntimeModel({ baseURL: 'https://system-one.example', implementation: 'dasein', timeoutMs: 5000 })).resolves.toEqual({ modelId: 'google/gemma-3-4b-it' })
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://system-one.example/health')
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  it('reads lookski’s actual loaded model from its distinct health payload', async () => {
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ engine_loaded: true, model_id: 'Qwen/Qwen3-0.6B', status: 'ok' })))

    await expect(service.inspectRuntimeModel({ baseURL: 'http://open-jev.local', implementation: 'lookski', timeoutMs: 5000 })).resolves.toEqual({ modelId: 'Qwen/Qwen3-0.6B' })
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://open-jev.local/health')
  })

  it('uses the lookski profile through the same System One wire contract', async () => {
    const profile = await service.save({ baseURL: 'https://lookski.example', implementation: 'lookski', modelId: 'qwen3:4b', name: '遠端 lookski', timeoutMs: 5000 })
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 1 } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ answers: { route: { choice: 'IGNORE' } } })))

    await service.readiness(profile.id)
    await service.activate(profile.id)
    await expect(service.decide('顧客語音：看看套餐', {
      route: { criteria: { IGNORE: 'Ignore.' }, instructions: 'Choose.', type: 'choice' },
    })).resolves.toEqual({ answers: { route: { choice: 'IGNORE' } } })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://lookski.example/v1/systemone')
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe('https://lookski.example/v1/systemone')
  })

  it('observes the exact outgoing Jev payload without its credential headers', async () => {
    const profile = await service.save({ baseURL: 'https://lookski.example', implementation: 'lookski', modelId: 'qwen3:4b', name: 'payload trace', plaintextKey: 'private-api-key', timeoutMs: 5000 })
    const providerResponse = { model: 'loaded-model', answers: { ready: { noul: 1 }, route: { choice: 'GREET' } }, usage: { forward_passes: 12 } }
    fetchImpl.mockImplementation(async () => Response.json(providerResponse))
    await service.readiness(profile.id)
    await service.activate(profile.id)
    const record = vi.fn()
    const traced = createKioskSystemOneService({ db, envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 4) }), fetchImpl, traceObserver: { record } })
    const state = '近期角色標記對話：[{"role":"assistant","content":"您好"}]\n顧客語音：午安'
    const questions = { route: { type: 'choice' as const, instructions: '只選合法意圖。', criteria: { GREET: '向店員打招呼。' } } }
    await traced.decide(state, questions)
    const body = JSON.parse(String(fetchImpl.mock.lastCall?.[1]?.body))
    expect(record).toHaveBeenCalledTimes(2)
    expect(record).toHaveBeenNthCalledWith(1, { requestId: expect.any(String), phase: 'request', endpoint: 'https://lookski.example/v1/systemone', payload: body })
    expect(record).toHaveBeenNthCalledWith(2, { requestId: record.mock.calls[0]?.[0].requestId, phase: 'response', endpoint: 'https://lookski.example/v1/systemone', status: 200, durationMs: expect.any(Number), payload: providerResponse })
    expect(body).toEqual({ state, questions })
    expect(fetchImpl.mock.lastCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer private-api-key' })
    expect(JSON.stringify(record.mock.calls)).not.toContain('private-api-key')
    expect(JSON.stringify(record.mock.calls)).not.toContain('Authorization')
    record.mockClear()
    fetchImpl.mockResolvedValueOnce(new Response('provider unavailable', { status: 503 }))
    await expect(traced.decide(state, questions)).rejects.toThrow('HTTP 503')
    expect(record).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: 'response', status: 503, payload: 'provider unavailable' }))
  })

  it('records a failed readiness instead of activating stale state', async () => {
    const profile = await service.save({ baseURL: 'http://dasein.local', implementation: 'dasein', modelId: 'gemma-3-4b-it', name: '店內 Gemma', timeoutMs: 5000 })
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ answers: {} })))

    await expect(service.readiness(profile.id)).rejects.toThrow('readiness answer')
    const stored = await db.query.kioskSystemOneProfiles.findFirst()
    expect(stored).toMatchObject({ verifiedAt: null })
    expect(stored?.lastCheckError).toContain('readiness answer')
  })

  it('stops the failed decision round and probes readiness automatically before a later recovery', async () => {
    const profile = await service.save({ baseURL: 'http://dasein.local', implementation: 'dasein', modelId: 'gemma-3-4b-it', name: '店內 Gemma', timeoutMs: 5000 })
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 1 } } })))
    await service.readiness(profile.id)
    await service.activate(profile.id)

    fetchImpl.mockResolvedValueOnce(new Response('offline', { status: 503 }))
    await expect(service.decide('Customer speech: 我要蝦捲', { route: { criteria: { YES: 'yes' }, instructions: 'Choose.', type: 'choice' } })).rejects.toThrow('HTTP 503')
    await expect(db.query.kioskSystemOneProfiles.findFirst()).resolves.toMatchObject({ verifiedAt: null })
    expect(await service.isEnabled()).toBe(true)

    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 1 } } })))
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ answers: { route: { choice: 'YES' } } })))
    await expect(service.decide('Customer speech: 我要蝦捲', { route: { criteria: { YES: 'yes' }, instructions: 'Choose.', type: 'choice' } })).resolves.toEqual({
      answers: { route: { choice: 'YES' } },
    })
  })
})
