import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { createAdminWebnaviorAiRoutes } from '.'
import { ApiError } from '../../../utils/error'

describe('admin Webnavior AI routes', () => {
  it('passes a Provider ID unchanged when verifying a saved profile', async () => {
    const verifyProfile = vi.fn(async () => ({ id: 'RB_zw84In0eWFofqtM-9K' }))
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('user', { id: 'admin-1', role: 'admin' } as HonoEnv['Variables']['user'])
        await next()
      })
      .route('/', createAdminWebnaviorAiRoutes({
        runtimeService: { applyBindings: async () => ({ appliedCapabilities: [] }), modelFor: async () => undefined },
        service: {
          createProfile: vi.fn(),
          deleteProfile: vi.fn(),
          listProfiles: vi.fn(),
          listSelections: vi.fn(),
          refreshProfileModels: vi.fn(),
          selectProfile: vi.fn(),
          testProviderConnection: vi.fn(),
          updateProfile: vi.fn(),
          verifyAndCreateProfile: vi.fn(),
          verifyAndUpdateProfile: vi.fn(),
          verifyProfile: verifyProfile as any,
        },
        systemOne: { isEnabled: async () => true, activate: vi.fn(), deactivate: vi.fn(), decide: vi.fn(), delete: vi.fn(), getPolicy: vi.fn(async () => ({ decisionInstruction: '', defaultDecisionInstruction: 'default', storeInstruction: '', updatedAt: null })), inspectRuntimeModel: vi.fn(), list: vi.fn(async () => []), routing: async () => 'direct' as const, maxActionCandidates: vi.fn(async () => 253 as const), readiness: vi.fn(), save: vi.fn(), savePolicy: vi.fn(), update: vi.fn() },
      }))

    const response = await app.request('/capabilities/chat/providers/RB_zw84In0eWFofqtM-9K/verify', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(verifyProfile).toHaveBeenCalledWith('chat', 'RB_zw84In0eWFofqtM-9K')
  })

  it.each(['llama-cpp', 'openai-responses'] as const)('uses verify-and-save before creating a %s Provider profile', async (kind) => {
    const verifyAndCreateProfile = vi.fn(async () => ({ id: 'new-profile' }))
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('user', { id: 'admin-1', role: 'admin' } as HonoEnv['Variables']['user'])
        await next()
      })
      .route('/', createAdminWebnaviorAiRoutes({
        runtimeService: { applyBindings: async () => ({ appliedCapabilities: [] }), modelFor: async () => undefined },
        service: {
          createProfile: vi.fn(),
          deleteProfile: vi.fn(),
          listProfiles: vi.fn(),
          listSelections: vi.fn(),
          refreshProfileModels: vi.fn(),
          selectProfile: vi.fn(),
          testProviderConnection: vi.fn(),
          updateProfile: vi.fn(),
          verifyAndCreateProfile: verifyAndCreateProfile as any,
          verifyAndUpdateProfile: vi.fn(),
          verifyProfile: vi.fn(),
        },
        systemOne: { isEnabled: async () => true, activate: vi.fn(), deactivate: vi.fn(), decide: vi.fn(), delete: vi.fn(), getPolicy: vi.fn(async () => ({ decisionInstruction: '', defaultDecisionInstruction: 'default', storeInstruction: '', updatedAt: null })), inspectRuntimeModel: vi.fn(), list: vi.fn(async () => []), routing: async () => 'direct' as const, maxActionCandidates: vi.fn(async () => 253 as const), readiness: vi.fn(), save: vi.fn(), savePolicy: vi.fn(), update: vi.fn() },
      }))

    const response = await app.request('/capabilities/chat/providers/verify-and-save', {
      body: JSON.stringify({ baseURL: 'https://models.example/v1', kind, modelId: 'gemma4:26b', name: '主要模型', timeoutMs: 60_000 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(201)
    expect(verifyAndCreateProfile).toHaveBeenCalledWith('chat', expect.objectContaining({ kind, modelId: 'gemma4:26b', timeoutMs: 60_000 }))
  })

  it.each(['vision', 'asr', 'tts'] as const)('rejects native Responses for %s at the admin boundary', async (capability) => {
    const verifyAndCreateProfile = vi.fn(async () => ({ id: 'new-profile' }))
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('user', { id: 'admin-1', role: 'admin' } as HonoEnv['Variables']['user'])
        await next()
      })
      .route('/', createAdminWebnaviorAiRoutes({
        runtimeService: { applyBindings: async () => ({ appliedCapabilities: [] }), modelFor: async () => undefined },
        service: {
          createProfile: vi.fn(),
          deleteProfile: vi.fn(),
          listProfiles: vi.fn(),
          listSelections: vi.fn(),
          refreshProfileModels: vi.fn(),
          selectProfile: vi.fn(),
          testProviderConnection: vi.fn(),
          updateProfile: vi.fn(),
          verifyAndCreateProfile: verifyAndCreateProfile as any,
          verifyAndUpdateProfile: vi.fn(),
          verifyProfile: vi.fn(),
        },
        systemOne: { isEnabled: async () => true, activate: vi.fn(), deactivate: vi.fn(), decide: vi.fn(), delete: vi.fn(), getPolicy: vi.fn(async () => ({ decisionInstruction: '', defaultDecisionInstruction: 'default', storeInstruction: '', updatedAt: null })), inspectRuntimeModel: vi.fn(), list: vi.fn(async () => []), routing: async () => 'direct' as const, maxActionCandidates: vi.fn(async () => 253 as const), readiness: vi.fn(), save: vi.fn(), savePolicy: vi.fn(), update: vi.fn() },
      }))

    app.onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'internal' }, 500))
    const response = await app.request(`/capabilities/${capability}/providers/verify-and-save`, {
      body: JSON.stringify({ baseURL: 'https://models.example/v1', kind: 'openai-responses', modelId: 'gemma4:26b', name: '主要模型', timeoutMs: 60_000 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(response.status).toBe(400)
    expect(verifyAndCreateProfile).not.toHaveBeenCalled()
  })

  it('routes System One profile edits and deletion to the domain service', async () => {
    const deactivate = vi.fn()
    const update = vi.fn()
    const savePolicy = vi.fn(async () => ({ decisionInstruction: '只選現有候選。', defaultDecisionInstruction: 'default', storeInstruction: '顧客說套餐時先開啟套餐分類。', updatedAt: new Date() }))
    const remove = vi.fn(async () => undefined)
    const inspectRuntimeModel = vi.fn(async () => ({ modelId: 'jev-latest' }))
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('user', { id: 'admin-1', role: 'admin' } as HonoEnv['Variables']['user'])
        await next()
      })
      .route('/', createAdminWebnaviorAiRoutes({
        runtimeService: { applyBindings: async () => ({ appliedCapabilities: [] }), modelFor: async () => undefined },
        service: {
          createProfile: vi.fn(),
          deleteProfile: vi.fn(),
          listProfiles: vi.fn(),
          listSelections: vi.fn(),
          refreshProfileModels: vi.fn(),
          selectProfile: vi.fn(),
          testProviderConnection: vi.fn(),
          updateProfile: vi.fn(),
          verifyAndCreateProfile: vi.fn(),
          verifyAndUpdateProfile: vi.fn(),
          verifyProfile: vi.fn(),
        },
        systemOne: { isEnabled: async () => true, activate: vi.fn(), deactivate, decide: vi.fn(), delete: remove, getPolicy: vi.fn(async () => ({ decisionInstruction: '', defaultDecisionInstruction: 'default', storeInstruction: '', updatedAt: null })), inspectRuntimeModel, list: vi.fn(async () => []), routing: async () => 'direct' as const, maxActionCandidates: vi.fn(async () => 253 as const), readiness: vi.fn(), save: vi.fn(), savePolicy, update },
      }))

    const updateResponse = await app.request('/system-one/profiles/system-one-1', {
      body: JSON.stringify({ baseURL: 'http://dasein.local', implementation: 'lookski', modelId: 'gemma-3-4b-it', name: '店內 Gemma', timeoutMs: 30_000 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    })
    const deleteResponse = await app.request('/system-one/profiles/system-one-1', { method: 'DELETE' })
    const deactivateResponse = await app.request('/system-one/active-profile/system-one-1', { method: 'DELETE' })
    const policyResponse = await app.request('/system-one/policy', {
      body: JSON.stringify({ decisionInstruction: '只選現有候選。', storeInstruction: '顧客說套餐時先開啟套餐分類。' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    })
    const modelsResponse = await app.request('/system-one/runtime-model:inspect', {
      body: JSON.stringify({ baseURL: 'https://system-one.example', implementation: 'dasein', timeoutMs: 5000 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(updateResponse.status).toBe(200)
    expect(update).toHaveBeenCalledWith('system-one-1', expect.objectContaining({ implementation: 'lookski', timeoutMs: 30_000 }))
    expect(deleteResponse.status).toBe(204)
    expect(remove).toHaveBeenCalledWith('system-one-1')
    expect(deactivateResponse.status).toBe(204)
    expect(deactivate).toHaveBeenCalledWith('system-one-1')
    expect(policyResponse.status).toBe(200)
    expect(savePolicy).toHaveBeenCalledWith({ decisionInstruction: '只選現有候選。', storeInstruction: '顧客說套餐時先開啟套餐分類。' })
    expect(modelsResponse.status).toBe(200)
    expect(inspectRuntimeModel).toHaveBeenCalledWith({ baseURL: 'https://system-one.example', implementation: 'dasein', timeoutMs: 5000 })

    const slmUpdate = await app.request('/system-one/profiles/system-one-1', {
      body: JSON.stringify({ baseURL: 'http://127.0.0.1:12434/engines/v1', implementation: 'slm', modelId: 'local-qwen', name: '店內 SLM', timeoutMs: 30_000 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    })
    expect(slmUpdate.status).toBe(200)
    expect(update).toHaveBeenCalledWith('system-one-1', expect.objectContaining({ implementation: 'slm', modelId: 'local-qwen' }))
    const slmModels = await app.request('/system-one/runtime-model:inspect', {
      body: JSON.stringify({ baseURL: 'http://127.0.0.1:12434/engines/v1', implementation: 'slm', timeoutMs: 5000, plaintextKey: 'private-inspection-key' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(slmModels.status).toBe(200)
    expect(inspectRuntimeModel).toHaveBeenCalledWith({ baseURL: 'http://127.0.0.1:12434/engines/v1', implementation: 'slm', timeoutMs: 5000, plaintextKey: 'private-inspection-key' })
    const decisionsUpdate = await app.request('/system-one/profiles/system-one-1', {
      body: JSON.stringify({ baseURL: 'https://api.openai.com/v1', implementation: 'openai-decisions', modelId: 'gpt-6-luna', name: 'OpenAI Decisions', timeoutMs: 5000, plaintextKey: 'synthetic-only' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    })
    expect(decisionsUpdate.status).toBe(200)
    expect(update).toHaveBeenCalledWith('system-one-1', expect.objectContaining({ implementation: 'openai-decisions', modelId: 'gpt-6-luna', plaintextKey: 'synthetic-only' }))
  })
})

it.each([0, 0.24, 4.01, '1.2'])('rejects invalid TTS synthesis speed %s before touching the provider', async (speed) => {
  const createProfile = vi.fn()
  const app = new Hono<HonoEnv>()
    .use('*', async (c, next) => {
      c.set('user', { id: 'admin-speed', role: 'admin' } as HonoEnv['Variables']['user'])
      await next()
    })
    .route('/', createAdminWebnaviorAiRoutes({
      runtimeService: { applyBindings: async () => ({ appliedCapabilities: [] }), modelFor: async () => undefined },
      service: {
        createProfile,
        deleteProfile: vi.fn(),
        listProfiles: vi.fn(),
        listSelections: vi.fn(),
        refreshProfileModels: vi.fn(),
        selectProfile: vi.fn(),
        testProviderConnection: vi.fn(),
        updateProfile: vi.fn(),
        verifyAndCreateProfile: vi.fn(),
        verifyAndUpdateProfile: vi.fn(),
        verifyProfile: vi.fn(),
      },
      systemOne: { isEnabled: async () => true, activate: vi.fn(), deactivate: vi.fn(), decide: vi.fn(), delete: vi.fn(), getPolicy: vi.fn(), inspectRuntimeModel: vi.fn(), list: vi.fn(), routing: async () => 'direct' as const, maxActionCandidates: vi.fn(), readiness: vi.fn(), save: vi.fn(), savePolicy: vi.fn(), update: vi.fn() },
    }))
  // Mount the same ApiError status mapping as the production application.
  app.onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'internal' }, 500))
  const response = await app.request('/capabilities/tts/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseURL: 'https://tts.example/v1', kind: 'openai-compatible', name: 'TTS', timeoutMs: 5000, speed }),
  })
  expect(response.status).toBe(400)
  expect(createProfile).not.toHaveBeenCalled()
})
