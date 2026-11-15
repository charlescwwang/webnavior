import type { ChatResponseMode } from '@proj-airi/stage-shared/ai-provider'

import { errorMessageFrom } from '@moeru/std'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { readonly, shallowRef } from 'vue'

export type AiCapability = 'chat' | 'vision' | 'asr' | 'tts'
export type AiProviderKind = 'llama-cpp' | 'ollama' | 'openai-compatible' | 'openai-responses'
export type SystemOneImplementation = 'dasein' | 'lookski' | 'slm' | 'openai-decisions'

export interface AiProviderProfile {
  responseMode: ChatResponseMode
  enableThinking: boolean
  baseURL: string
  capability: AiCapability
  discoveredModels: ReadonlyArray<{ id: string }>
  hasApiKey: boolean
  id: string
  kind: AiProviderKind
  lastCheckError: string | null
  lastVerificationError: string | null
  modelId: string | null
  name: string
  timeoutMs: number
  verifiedAt: string | null
  voice: string | null
  speed: number | null
}

export interface AiCapabilitySelection {
  capability: AiCapability
  providerProfile: AiProviderProfile
  providerProfileId: string
}

export interface AiProviderProfileInput {
  responseMode?: ChatResponseMode
  enableThinking?: boolean
  baseURL: string
  clearApiKey?: boolean
  kind: AiProviderKind
  modelId?: string
  name: string
  plaintextKey?: string
  timeoutMs: number
  voice?: string
  speed?: number
}

/** Result of the optional Provider model-catalog probe. */
export interface AiModelCatalogProbe {
  catalogAvailable: boolean
  catalogMessage?: string
  models: ReadonlyArray<{ id: string }>
}

interface AiControlSnapshot {
  profiles: AiProviderProfile[]
  selections: AiCapabilitySelection[]
  systemOnePolicy: SystemOnePolicy
  systemOneProfiles: SystemOneProfile[]
}

export interface SystemOneProfile {
  baseURL: string
  hasApiKey: boolean
  id: string
  implementation: SystemOneImplementation
  isActive: boolean
  lastCheckError: string | null
  lastCheckedAt: string | null
  modelId: string
  name: string
  timeoutMs: number
  verifiedAt: string | null
}

export interface SystemOneProfileInput {
  baseURL: string
  clearApiKey?: boolean
  implementation: SystemOneImplementation
  modelId: string
  name: string
  plaintextKey?: string
  timeoutMs: number
}

/** Model currently loaded by the configured local System One implementation. */
export interface SystemOneRuntimeModel {
  modelId: string
  modelIds?: string[]
}

/** System One's editable semantic prompt and optional store-specific addition. */
export interface SystemOnePolicy {
  /** Empty when the Server's built-in prompt is active. */
  decisionInstruction: string
  defaultDecisionInstruction: string
  storeInstruction: string
  updatedAt: string | null
}

export interface SystemOnePolicyInput {
  decisionInstruction: string
  storeInstruction: string
}

function endpoint(path = '') {
  const normalizedPath = path.replace(/^\/+/, '')
  return new URL(`/api/admin/webnavior-ai${normalizedPath ? `/${normalizedPath}` : ''}`, SERVER_URL).toString()
}

async function request(path = '', init?: RequestInit) {
  const response = await authedFetch(endpoint(path), init)
  if (!response.ok) {
    const body = await response.text()
    const payload = parseErrorPayload(body)
    if (payload?.error === 'NOT_FOUND')
      throw new Error('找不到 Kiosk AI 設定服務。請確認 API Server 已更新並重新啟動。')
    throw new Error(payload?.message || body || `請求失敗（${response.status}）。`)
  }
  return response
}

function parseErrorPayload(body: string): { error?: string, message?: string } | undefined {
  try {
    const value: unknown = JSON.parse(body)
    if (!value || typeof value !== 'object')
      return undefined
    const { error, message } = value as { error?: unknown, message?: unknown }
    return {
      ...(typeof error === 'string' ? { error } : {}),
      ...(typeof message === 'string' ? { message } : {}),
    }
  }
  catch {
    return undefined
  }
}

/** State and actions for capability-scoped Webnavior AI Provider settings. */
export function useWebnaviorAiControl() {
  const profiles = shallowRef<AiProviderProfile[]>([])
  const selections = shallowRef<AiCapabilitySelection[]>([])
  const systemOnePolicy = shallowRef<SystemOnePolicy>({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null })
  const systemOneProfiles = shallowRef<SystemOneProfile[]>([])
  const busy = shallowRef(false)
  const error = shallowRef<string>()

  async function refreshSnapshot() {
    const snapshot = await (await request()).json() as AiControlSnapshot
    profiles.value = snapshot.profiles
    selections.value = snapshot.selections
    systemOnePolicy.value = snapshot.systemOnePolicy
    systemOneProfiles.value = snapshot.systemOneProfiles
  }

  async function run<T>(operation: () => Promise<T>, fallbackMessage: string) {
    busy.value = true
    error.value = undefined
    try {
      return await operation()
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? fallbackMessage
      throw cause
    }
    finally {
      busy.value = false
    }
  }

  async function load() {
    try {
      await run(refreshSnapshot, '無法讀取 AI Provider 設定。')
    }
    catch {
      // The route view presents this state both in context and as a Toast.
    }
  }

  async function createProfile(capability: AiCapability, input: AiProviderProfileInput) {
    return await run(async () => {
      await request(`/capabilities/${capability}/providers`, { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' }, method: 'POST' })
      await refreshSnapshot()
    }, '無法建立 AI Provider。')
  }

  async function updateProfile(capability: AiCapability, profileId: string, input: AiProviderProfileInput) {
    return await run(async () => {
      await request(`/capabilities/${capability}/providers/${encodeURIComponent(profileId)}`, { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' }, method: 'PATCH' })
      await refreshSnapshot()
    }, '無法更新 AI Provider。')
  }

  async function refreshProfileModels(capability: AiCapability, profileId: string) {
    return await run(async () => {
      await request(`/capabilities/${capability}/providers/${encodeURIComponent(profileId)}/models:refresh`, { method: 'POST' })
      await refreshSnapshot()
    }, '無法讀取模型清單。')
  }

  async function discoverProviderModels(capability: AiCapability, input: AiProviderProfileInput, profileId?: string) {
    return await run(async () => {
      const path = profileId
        ? `/capabilities/${capability}/providers/${encodeURIComponent(profileId)}/models:discover`
        : `/capabilities/${capability}/providers/models:discover`
      return await (await request(path, {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })).json() as AiModelCatalogProbe
    }, '無法連線至模型服務。')
  }

  async function verifyAndSaveProvider(capability: AiCapability, input: AiProviderProfileInput, profileId?: string) {
    return await run(async () => {
      const path = profileId
        ? `/capabilities/${capability}/providers/${encodeURIComponent(profileId)}/verify-and-save`
        : `/capabilities/${capability}/providers/verify-and-save`
      await request(path, {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      await refreshSnapshot()
    }, 'Provider 驗證失敗，設定尚未儲存。')
  }

  async function verifyProfile(capability: AiCapability, profileId: string) {
    return await run(async () => {
      await request(`/capabilities/${capability}/providers/${encodeURIComponent(profileId)}/verify`, { method: 'POST' })
      await refreshSnapshot()
    }, '無法驗證 AI Provider。')
  }

  async function deleteProfile(capability: AiCapability, profileId: string) {
    return await run(async () => {
      await request(`/capabilities/${capability}/providers/${encodeURIComponent(profileId)}`, { method: 'DELETE' })
      await refreshSnapshot()
    }, '無法移除 AI Provider。')
  }

  async function selectProfile(capability: AiCapability, providerProfileId: string) {
    return await run(async () => {
      await request(`/capabilities/${capability}/active-provider`, {
        body: JSON.stringify({ providerProfileId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PUT',
      })
      await refreshSnapshot()
    }, '無法切換啟用的 AI Provider。')
  }

  async function apply() {
    return await run(async () => {
      return await (await request('/apply', { method: 'POST' })).json() as { appliedCapabilities: AiCapability[] }
    }, '無法套用 AI 設定。')
  }

  async function saveSystemOneProfile(input: SystemOneProfileInput) {
    return await run(async () => {
      await request('/system-one/profiles', { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' }, method: 'POST' })
      await refreshSnapshot()
    }, '無法儲存 System One 設定。')
  }

  async function inspectSystemOneRuntimeModel(input: Pick<SystemOneProfileInput, 'baseURL' | 'implementation' | 'timeoutMs' | 'plaintextKey'>) {
    return await run(async () => {
      return await (await request('/system-one/runtime-model:inspect', {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })).json() as SystemOneRuntimeModel
    }, '無法讀取 System One 目前載入的模型。')
  }

  async function saveSystemOnePolicy(input: SystemOnePolicyInput) {
    return await run(async () => {
      await request('/system-one/policy', { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' }, method: 'PUT' })
      await refreshSnapshot()
    }, '無法儲存 System One 點餐規則。')
  }

  async function updateSystemOneProfile(profileId: string, input: SystemOneProfileInput) {
    return await run(async () => {
      await request(`/system-one/profiles/${encodeURIComponent(profileId)}`, { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' }, method: 'PATCH' })
      await refreshSnapshot()
    }, '無法更新 System One 設定。')
  }

  async function deleteSystemOneProfile(profileId: string) {
    return await run(async () => {
      await request(`/system-one/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' })
      await refreshSnapshot()
    }, '無法移除 System One profile。')
  }

  async function checkSystemOneReadiness(profileId: string) {
    return await run(async () => {
      await request(`/system-one/profiles/${encodeURIComponent(profileId)}/readiness`, { method: 'POST' })
      await refreshSnapshot()
    }, 'System One readiness 檢查失敗。')
  }

  async function activateSystemOneProfile(profileId: string) {
    return await run(async () => {
      await request(`/system-one/active-profile/${encodeURIComponent(profileId)}`, { method: 'PUT' })
      await refreshSnapshot()
    }, '無法啟用 System One profile。')
  }

  async function deactivateSystemOneProfile(profileId: string) {
    return await run(async () => {
      await request(`/system-one/active-profile/${encodeURIComponent(profileId)}`, { method: 'DELETE' })
      await refreshSnapshot()
    }, '無法停用 System One Fast Path。')
  }

  return {
    apply,
    activateSystemOneProfile,
    busy: readonly(busy),
    checkSystemOneReadiness,
    createProfile,
    deleteSystemOneProfile,
    deactivateSystemOneProfile,
    deleteProfile,
    inspectSystemOneRuntimeModel,
    discoverProviderModels,
    error: readonly(error),
    load,
    profiles: readonly(profiles),
    refreshProfileModels,
    selectProfile,
    selections: readonly(selections),
    saveSystemOneProfile,
    saveSystemOnePolicy,
    systemOnePolicy: readonly(systemOnePolicy),
    systemOneProfiles: readonly(systemOneProfiles),
    updateSystemOneProfile,
    updateProfile,
    verifyAndSaveProvider,
    verifyProfile,
  }
}
