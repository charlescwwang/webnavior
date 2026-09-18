import type { Database } from '../../../libs/db'
import type { WebnaviorAiCapability, WebnaviorAiConnectionKind } from '../../../schemas/webnavior-ai'
import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'

import { errorMessageFrom } from '@moeru/std'
import { asc, eq } from 'drizzle-orm'

import { createBadRequestError, createConflictError, createNotFoundError } from '../../../utils/error'
import { discoverModels } from './discover-models'

import * as schema from '../../../schemas'

const CONNECTION_KEY_ENTRY_ID = 'default'

export interface AiConnectionInput {
  baseURL: string
  kind: WebnaviorAiConnectionKind
  name: string
  plaintextKey?: string
  timeoutMs: number
}

export interface AiCapabilityBindingInput {
  capability: WebnaviorAiCapability
  connectionId: string
  modelId: string
  voice?: string
}

/** A browser-safe connection record. It deliberately excludes ciphertext. */
export interface ManagedAiConnection extends Omit<schema.WebnaviorAiConnection, 'apiKeyCiphertext'> {
  hasApiKey: boolean
}

/** One binding with its resolved display source for management rendering. */
export interface ManagedAiCapabilityBinding extends schema.WebnaviorAiCapabilityBinding {
  connection: Pick<ManagedAiConnection, 'id' | 'kind' | 'name'>
}

/**
 * Owns Webnavior's provider connections and capability choices.
 *
 * Provider credentials are encrypted under a connection-specific AAD label;
 * callers can discover and bind models but never receive stored ciphertext.
 * The runtime compiler is intentionally a separate concern: this service owns
 * durable operator intent, while the compiler projects it into existing AIRI
 * gateway configuration.
 */
export interface WebnaviorAiControlService {
  createConnection: (input: AiConnectionInput) => Promise<ManagedAiConnection>
  deleteConnection: (connectionId: string) => Promise<void>
  listBindings: () => Promise<ManagedAiCapabilityBinding[]>
  listConnections: () => Promise<ManagedAiConnection[]>
  refreshConnectionModels: (connectionId: string) => Promise<ManagedAiConnection>
  saveBinding: (input: AiCapabilityBindingInput) => Promise<ManagedAiCapabilityBinding>
  updateConnection: (connectionId: string, input: AiConnectionInput & { clearApiKey?: boolean }) => Promise<ManagedAiConnection>
}

export function createWebnaviorAiControlService(options: {
  db: Database
  envelopeCrypto: EnvelopeCrypto
  fetchImpl?: typeof fetch
}): WebnaviorAiControlService {
  const fetchImpl = options.fetchImpl ?? fetch

  async function findConnection(connectionId: string) {
    const connection = await options.db.query.webnaviorAiConnections.findFirst({
      where: eq(schema.webnaviorAiConnections.id, connectionId),
    })
    if (!connection)
      throw createNotFoundError('找不到 AI 服務連線。', 'WEBNAVIOR_AI_CONNECTION_NOT_FOUND')
    return connection
  }

  async function createConnection(input: AiConnectionInput) {
    const [connection] = await options.db.insert(schema.webnaviorAiConnections).values({
      baseURL: input.baseURL,
      kind: input.kind,
      name: input.name,
      timeoutMs: input.timeoutMs,
    }).returning()

    if (input.plaintextKey?.trim()) {
      const apiKeyCiphertext = options.envelopeCrypto.encryptKey(input.plaintextKey, {
        keyEntryId: CONNECTION_KEY_ENTRY_ID,
        modelName: connectionKeyLabel(connection.id),
      })
      const [updated] = await options.db.update(schema.webnaviorAiConnections)
        .set({ apiKeyCiphertext })
        .where(eq(schema.webnaviorAiConnections.id, connection.id))
        .returning()
      return toManagedConnection(updated)
    }
    return toManagedConnection(connection)
  }

  async function updateConnection(connectionId: string, input: AiConnectionInput & { clearApiKey?: boolean }) {
    const current = await findConnection(connectionId)
    if (input.clearApiKey && input.plaintextKey?.trim())
      throw createBadRequestError('不能同時清除與設定 API Key。', 'WEBNAVIOR_AI_CONNECTION_KEY_CONFLICT')

    const apiKeyCiphertext = input.clearApiKey
      ? null
      : input.plaintextKey?.trim()
        ? options.envelopeCrypto.encryptKey(input.plaintextKey, {
            keyEntryId: CONNECTION_KEY_ENTRY_ID,
            modelName: connectionKeyLabel(current.id),
          })
        : current.apiKeyCiphertext
    const sourceChanged = current.baseURL !== input.baseURL || current.kind !== input.kind
    const [updated] = await options.db.update(schema.webnaviorAiConnections).set({
      apiKeyCiphertext,
      baseURL: input.baseURL,
      // A catalog belongs to one upstream endpoint. Requiring a fresh read
      // prevents an old model id from being silently sent to a new service.
      ...(sourceChanged
        ? { discoveredAt: null, discoveredModels: [], lastCheckedAt: null, lastCheckError: null }
        : {}),
      kind: input.kind,
      name: input.name,
      timeoutMs: input.timeoutMs,
    }).where(eq(schema.webnaviorAiConnections.id, connectionId)).returning()
    return toManagedConnection(updated)
  }

  async function listConnections() {
    return (await options.db.query.webnaviorAiConnections.findMany({
      orderBy: [asc(schema.webnaviorAiConnections.name)],
    })).map(toManagedConnection)
  }

  async function refreshConnectionModels(connectionId: string) {
    const connection = await findConnection(connectionId)
    const key = connection.apiKeyCiphertext
      ? options.envelopeCrypto.decryptKey(connection.apiKeyCiphertext, {
          keyEntryId: CONNECTION_KEY_ENTRY_ID,
          modelName: connectionKeyLabel(connection.id),
        })
      : undefined
    try {
      const discoveredModels = await discoverModels({
        baseURL: connection.baseURL,
        ...(key ? { plaintextKey: key.toString('utf8') } : {}),
      }, fetchImpl)
      const [updated] = await options.db.update(schema.webnaviorAiConnections).set({
        discoveredAt: new Date(),
        discoveredModels,
        lastCheckedAt: new Date(),
        lastCheckError: null,
      }).where(eq(schema.webnaviorAiConnections.id, connection.id)).returning()
      return toManagedConnection(updated)
    }
    catch (cause) {
      const [updated] = await options.db.update(schema.webnaviorAiConnections).set({
        lastCheckedAt: new Date(),
        lastCheckError: errorMessageFrom(cause) ?? '無法讀取模型清單。',
      }).where(eq(schema.webnaviorAiConnections.id, connection.id)).returning()
      // Keep the last verified catalog visible, then surface the original
      // request failure so the operator can correct connectivity or access.
      void updated
      throw cause
    }
    finally {
      key?.fill(0)
    }
  }

  async function saveBinding(input: AiCapabilityBindingInput) {
    const connection = await findConnection(input.connectionId)
    if (!connection.discoveredModels.some(model => model.id === input.modelId)) {
      throw createBadRequestError('請先成功讀取此服務的模型清單，再選擇要使用的模型。', 'WEBNAVIOR_AI_MODEL_NOT_DISCOVERED')
    }
    if (input.capability !== 'tts' && input.voice) {
      throw createBadRequestError('只有語音輸出可以設定 voice。', 'WEBNAVIOR_AI_VOICE_CAPABILITY_MISMATCH')
    }

    const [binding] = await options.db.insert(schema.webnaviorAiCapabilityBindings).values({
      capability: input.capability,
      connectionId: input.connectionId,
      modelId: input.modelId,
      voice: input.capability === 'tts' ? input.voice : null,
    }).onConflictDoUpdate({
      target: schema.webnaviorAiCapabilityBindings.capability,
      set: {
        connectionId: input.connectionId,
        modelId: input.modelId,
        voice: input.capability === 'tts' ? input.voice : null,
        updatedAt: new Date(),
      },
    }).returning()
    return { ...binding, connection: bindingConnection(connection) }
  }

  async function listBindings() {
    const bindings = await options.db.query.webnaviorAiCapabilityBindings.findMany({
      with: { connection: true },
      orderBy: [asc(schema.webnaviorAiCapabilityBindings.capability)],
    })
    return bindings.map(binding => ({
      ...binding,
      connection: bindingConnection(binding.connection),
    }))
  }

  async function deleteConnection(connectionId: string) {
    await findConnection(connectionId)
    const binding = await options.db.query.webnaviorAiCapabilityBindings.findFirst({
      where: eq(schema.webnaviorAiCapabilityBindings.connectionId, connectionId),
    })
    if (binding) {
      throw createConflictError('此服務仍被能力設定使用；請先改用其他服務。', 'WEBNAVIOR_AI_CONNECTION_IN_USE')
    }
    await options.db.delete(schema.webnaviorAiConnections).where(eq(schema.webnaviorAiConnections.id, connectionId))
  }

  return { createConnection, deleteConnection, listBindings, listConnections, refreshConnectionModels, saveBinding, updateConnection }
}

function connectionKeyLabel(connectionId: string) {
  return `webnavior-ai:connection:${connectionId}`
}

function toManagedConnection(connection: schema.WebnaviorAiConnection): ManagedAiConnection {
  const { apiKeyCiphertext, ...safeConnection } = connection
  return { ...safeConnection, hasApiKey: Boolean(apiKeyCiphertext) }
}

function bindingConnection(connection: schema.WebnaviorAiConnection) {
  return { id: connection.id, kind: connection.kind, name: connection.name }
}
