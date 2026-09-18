import { errorMessageFrom } from '@moeru/std'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { readonly, shallowRef } from 'vue'

export type AiCapability = 'chat' | 'vision' | 'asr' | 'tts' | 'embedding'
export type AiConnectionKind = 'ollama' | 'openai-compatible'

export interface AiConnection {
  baseURL: string
  discoveredModels: ReadonlyArray<{ id: string }>
  hasApiKey: boolean
  id: string
  kind: AiConnectionKind
  lastCheckError: string | null
  name: string
  timeoutMs: number
}

export interface AiBinding {
  capability: AiCapability
  connection: Pick<AiConnection, 'id' | 'kind' | 'name'>
  connectionId: string
  modelId: string
  voice: string | null
}

interface AiControlSnapshot {
  bindings: AiBinding[]
  connections: AiConnection[]
}

function endpoint(path = '') {
  return new URL(`/api/admin/webnavior-ai${path}`, SERVER_URL).toString()
}

async function request(path: string, init?: RequestInit) {
  const response = await authedFetch(endpoint(path), init)
  if (!response.ok)
    throw new Error(await response.text() || `Request failed: ${response.status}`)
  return response
}

/** State and actions for the Webnavior-only AI control plane. */
export function useWebnaviorAiControl() {
  const bindings = shallowRef<AiBinding[]>([])
  const connections = shallowRef<AiConnection[]>([])
  const busy = shallowRef(false)
  const error = shallowRef<string>()

  async function refreshSnapshot() {
    const snapshot = await (await request('/')).json() as AiControlSnapshot
    bindings.value = snapshot.bindings
    connections.value = snapshot.connections
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
      await run(refreshSnapshot, '無法讀取 AI 服務設定。')
    }
    catch {
      // The shared error state is rendered by the settings page.
    }
  }

  async function createConnection(input: { baseURL: string, kind: AiConnectionKind, name: string, plaintextKey?: string, timeoutMs: number }) {
    return await run(async () => {
      await request('/connections', { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' }, method: 'POST' })
      await refreshSnapshot()
    }, '無法建立 AI 服務連線。')
  }

  async function updateConnection(connectionId: string, input: { baseURL: string, clearApiKey?: boolean, kind: AiConnectionKind, name: string, plaintextKey?: string, timeoutMs: number }) {
    return await run(async () => {
      await request(`/connections/${encodeURIComponent(connectionId)}`, { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' }, method: 'PATCH' })
      await refreshSnapshot()
    }, '無法更新 AI 服務連線。')
  }

  async function refreshModels(connectionId: string) {
    return await run(async () => {
      await request(`/connections/${encodeURIComponent(connectionId)}/models:refresh`, { method: 'POST' })
      await refreshSnapshot()
    }, '無法讀取模型清單。')
  }

  async function deleteConnection(connectionId: string) {
    return await run(async () => {
      await request(`/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' })
      await refreshSnapshot()
    }, '無法移除正在使用的服務連線。')
  }

  async function saveBinding(input: { capability: AiCapability, connectionId: string, modelId: string, voice?: string }) {
    return await run(async () => {
      await request(`/bindings/${input.capability}`, { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' }, method: 'PUT' })
      await refreshSnapshot()
    }, '無法儲存能力模型。')
  }

  async function apply() {
    return await run(async () => {
      return await (await request('/apply', { method: 'POST' })).json() as { appliedCapabilities: AiCapability[] }
    }, '無法套用 AI 設定。')
  }

  return {
    apply,
    bindings: readonly(bindings),
    busy: readonly(busy),
    connections: readonly(connections),
    createConnection,
    deleteConnection,
    error: readonly(error),
    load,
    refreshModels,
    saveBinding,
    updateConnection,
  }
}
