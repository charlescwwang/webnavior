import { errorMessageFrom } from '@moeru/std'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { readonly, shallowRef } from 'vue'

export type AiCapability = 'chat' | 'vision' | 'asr' | 'tts' | 'embedding'
export type AiProviderKind = 'llama-cpp' | 'ollama' | 'openai-compatible'

export interface AiProviderProfile {
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
}

export interface AiCapabilitySelection {
  capability: AiCapability
  providerProfile: AiProviderProfile
  providerProfileId: string
}

export interface AiProviderProfileInput {
  baseURL: string
  clearApiKey?: boolean
  kind: AiProviderKind
  modelId?: string
  name: string
  plaintextKey?: string
  timeoutMs: number
  voice?: string
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
  speechGuard: SpeechGuardStatus
}

export interface SpeechGuardStatus {
  baselineCount: number
  configurationError?: string
  embeddingModelId?: string
  embeddingProfileId?: string
  ready: boolean
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
  const speechGuard = shallowRef<SpeechGuardStatus>({ baselineCount: 0, ready: false })
  const busy = shallowRef(false)
  const error = shallowRef<string>()

  async function refreshSnapshot() {
    const snapshot = await (await request()).json() as AiControlSnapshot
    profiles.value = snapshot.profiles
    selections.value = snapshot.selections
    speechGuard.value = snapshot.speechGuard
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

  async function initializeSpeechGuard() {
    return await run(async () => {
      await request('/speech-guard:initialize', { method: 'POST' })
      await refreshSnapshot()
    }, '無法建立語意防護基準。')
  }

  return {
    apply,
    busy: readonly(busy),
    createProfile,
    deleteProfile,
    discoverProviderModels,
    error: readonly(error),
    initializeSpeechGuard,
    load,
    profiles: readonly(profiles),
    refreshProfileModels,
    selectProfile,
    selections: readonly(selections),
    speechGuard: readonly(speechGuard),
    updateProfile,
    verifyAndSaveProvider,
    verifyProfile,
  }
}
