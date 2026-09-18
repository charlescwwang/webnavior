import type { Buffer } from 'node:buffer'

import type Redis from 'ioredis'

import type { Database } from '../../../libs/db'
import type * as schema from '../../../schemas'
import type { WebnaviorAiCapability, WebnaviorAiConnection } from '../../../schemas/webnavior-ai'
import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'
import type { ConfigKVService, LlmRouterConfig } from '../../adapters/config-kv'

import { createBadRequestError } from '../../../utils/error'

const RUNTIME_MODEL_NAMES = {
  asr: 'webnavior:asr',
  chat: 'webnavior/chat',
  tts: 'webnavior:tts',
  vision: 'webnavior/vision',
} as const

type KioskModelCapability = Exclude<WebnaviorAiCapability, 'embedding'>

export interface WebnaviorAiRuntimeService {
  applyBindings: () => Promise<{ appliedCapabilities: WebnaviorAiCapability[] }>
  modelFor: (capability: KioskModelCapability) => Promise<string | undefined>
}

/**
 * Compiles durable Webnavior capability bindings into the established gateway
 * configuration. This is a clean cutover: the control plane is the only AI
 * configuration source, and applying it replaces prior Webnavior runtime
 * selections instead of retaining a compatibility fallback.
 */
export function createWebnaviorAiRuntimeService(options: {
  configKV: ConfigKVService
  db: Database
  envelopeCrypto: EnvelopeCrypto
  redis: Redis
}): WebnaviorAiRuntimeService {
  async function modelFor(capability: KioskModelCapability) {
    const config = await options.configKV.getOptional('WEBNAVIOR_AI_RUNTIME_CONFIG')
    if (!config)
      return undefined
    return capability === 'chat'
      ? config.chatModel
      : capability === 'vision'
        ? config.visionModel
        : capability === 'asr'
          ? config.asrModel
          : config.ttsModel
  }

  async function applyBindings() {
    const bindings = await options.db.query.webnaviorAiCapabilityBindings.findMany({ with: { connection: true } })
    const byCapability = new Map(bindings.map(binding => [binding.capability, binding]))
    const plaintextKeys = new Map<string, Buffer | undefined>()

    try {
      for (const binding of bindings) {
        if (!binding.connection.discoveredModels.some(model => model.id === binding.modelId)) {
          throw createBadRequestError(
            `「${binding.connection.name}」的模型清單已變更，請重新讀取模型後再套用。`,
            'WEBNAVIOR_AI_MODEL_NOT_DISCOVERED',
          )
        }
        const ciphertext = binding.connection.apiKeyCiphertext
        plaintextKeys.set(binding.connection.id, ciphertext
          ? options.envelopeCrypto.decryptKey(ciphertext, { keyEntryId: 'default', modelName: connectionKeyLabel(binding.connection.id) })
          : undefined)
      }

      const llmModels: LlmRouterConfig['llm']['models'] = {}
      const chat = byCapability.get('chat')
      const vision = byCapability.get('vision')
      applyLlmBinding(llmModels, chat, RUNTIME_MODEL_NAMES.chat, plaintextKeys, options.envelopeCrypto)
      applyLlmBinding(llmModels, vision, RUNTIME_MODEL_NAMES.vision, plaintextKeys, options.envelopeCrypto)

      const asr = byCapability.get('asr')
      const tts = byCapability.get('tts')
      const embedding = byCapability.get('embedding')
      const runtimePolicy = {
        ...(chat ? { chatModel: RUNTIME_MODEL_NAMES.chat } : {}),
        ...(vision ? { visionModel: RUNTIME_MODEL_NAMES.vision } : {}),
        ...(asr ? { asrModel: RUNTIME_MODEL_NAMES.asr } : {}),
        ...(tts ? { ttsModel: RUNTIME_MODEL_NAMES.tts } : {}),
      }
      const nextRouter = {
        defaults: {
          fallbackHttpCodes: [401, 402, 403, 429, 500, 502, 503, 504],
          fullChainTimeoutMs: 60_000,
          perAttemptTimeoutMs: 30_000,
        },
        llm: { models: llmModels },
        tts: { models: {} },
      }
      const audioConfig = {
        ...(asr ? { asr: compiledAudioConfig(asr.connection, asr.modelId, plaintextKeys.get(asr.connection.id), 'asr', options.envelopeCrypto) } : {}),
        ...(tts ? { tts: compiledAudioConfig(tts.connection, tts.modelId, plaintextKeys.get(tts.connection.id), 'tts', options.envelopeCrypto, tts.voice ?? undefined) } : {}),
      }
      const embeddingConfig = embedding
        ? compiledEmbeddingConfig(embedding.connection, embedding.modelId, plaintextKeys.get(embedding.connection.id), options.envelopeCrypto)
        : undefined

      // Redis has no cross-key transaction. We fully assemble values before
      // writing so a validation error cannot leave a partially changed policy.
      await Promise.all([
        options.configKV.set('LLM_ROUTER_CONFIG', nextRouter),
        options.configKV.set('WEBNAVIOR_AI_RUNTIME_CONFIG', runtimePolicy),
        options.configKV.set('WEBNAVIOR_AUDIO_CONFIG', audioConfig),
        embeddingConfig
          ? options.configKV.set('WEBNAVIOR_EMBEDDING_CONFIG', embeddingConfig)
          : options.configKV.unset('WEBNAVIOR_EMBEDDING_CONFIG'),
      ])
      await Promise.all(['LLM_ROUTER_CONFIG', 'WEBNAVIOR_AI_RUNTIME_CONFIG', 'WEBNAVIOR_AUDIO_CONFIG', 'WEBNAVIOR_EMBEDDING_CONFIG']
        .map(async key => await options.redis.publish('configkv:invalidate', JSON.stringify({ key, publishedAt: Date.now(), version: Date.now() }))))
      return { appliedCapabilities: [...byCapability.keys()] }
    }
    finally {
      for (const key of plaintextKeys.values())
        key?.fill(0)
    }
  }

  return { applyBindings, modelFor }
}

function applyLlmBinding(
  models: LlmRouterConfig['llm']['models'],
  binding: (typeof schema.webnaviorAiCapabilityBindings.$inferSelect & { connection: WebnaviorAiConnection }) | undefined,
  runtimeModelName: typeof RUNTIME_MODEL_NAMES.chat | typeof RUNTIME_MODEL_NAMES.vision,
  plaintextKeys: Map<string, Buffer | undefined>,
  envelopeCrypto: EnvelopeCrypto,
) {
  if (!binding) {
    delete models[runtimeModelName]
    return
  }
  const key = plaintextKeys.get(binding.connection.id)
  models[runtimeModelName] = {
    fallbackTriggers: { httpCodes: [401, 402, 403, 429, 500, 502, 503, 504], onTimeout: true },
    upstreams: [{
      baseURL: binding.connection.baseURL,
      headerTemplate: key ? 'Bearer {KEY}' : '',
      keys: [{
        ciphertext: envelopeCrypto.encryptKey(key?.toString('utf8') ?? '', { keyEntryId: 'default', modelName: runtimeModelName }),
        id: 'default',
      }],
      overrideModel: binding.modelId,
      timeoutMs: binding.connection.timeoutMs,
    }],
  }
}

function compiledAudioConfig(connection: WebnaviorAiConnection, upstreamModel: string, key: Buffer | undefined, capability: 'asr' | 'tts', envelopeCrypto: EnvelopeCrypto, voice?: string) {
  return {
    baseURL: connection.baseURL,
    ...(key ? { keyCiphertext: envelopeCrypto.encryptKey(key.toString('utf8'), { keyEntryId: 'default', modelName: `webnavior-audio:${capability}` }) } : {}),
    modelName: RUNTIME_MODEL_NAMES[capability],
    upstreamModel,
    ...(capability === 'tts' ? { voice: voice ?? 'zh-TW-HsiaoChenNeural' } : {}),
  }
}

function compiledEmbeddingConfig(connection: WebnaviorAiConnection, modelName: string, key: Buffer | undefined, envelopeCrypto: EnvelopeCrypto) {
  return {
    baseURL: connection.baseURL,
    ...(key ? { keyCiphertext: envelopeCrypto.encryptKey(key.toString('utf8'), { keyEntryId: 'default', modelName: 'webnavior-kiosk:embedding' }) } : {}),
    modelName,
    provider: connection.kind,
    timeoutMs: connection.timeoutMs,
  }
}

function connectionKeyLabel(connectionId: string) {
  return `webnavior-ai:connection:${connectionId}`
}
