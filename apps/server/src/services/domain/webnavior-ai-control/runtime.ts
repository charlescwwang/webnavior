import type { Buffer } from 'node:buffer'

import type Redis from 'ioredis'

import type { Database } from '../../../libs/db'
import type { WebnaviorAiCapability, WebnaviorAiProviderProfile } from '../../../schemas/webnavior-ai'
import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'
import type { ConfigKVService, LlmRouterConfig } from '../../adapters/config-kv'

import { createBadRequestError } from '../../../utils/error'
import { validateProviderProfile } from './profilePolicy'

const RUNTIME_MODEL_NAMES = {
  asr: 'webnavior:asr',
  chat: 'webnavior/chat',
  tts: 'webnavior:tts',
  vision: 'webnavior/vision',
} as const

export interface WebnaviorAiRuntimeService {
  applyBindings: () => Promise<{ appliedCapabilities: WebnaviorAiCapability[] }>
  modelFor: (capability: WebnaviorAiCapability) => Promise<string | undefined>
}

/**
 * Compiles the active, capability-scoped Provider profiles into the established
 * gateway configuration. Chat keeps the explicitly selected primary and backup
 * in order; applying replaces prior runtime settings without implicit sources.
 */
export function createWebnaviorAiRuntimeService(options: {
  configKV: ConfigKVService
  db: Database
  envelopeCrypto: EnvelopeCrypto
  redis: Redis
}): WebnaviorAiRuntimeService {
  async function modelFor(capability: WebnaviorAiCapability) {
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
    const selections = await options.db.query.webnaviorAiCapabilitySelections.findMany({ with: { providerProfile: true, fallbackProviderProfile: true } })
    const byCapability = new Map(selections.map(selection => [selection.capability, selection.providerProfile]))
    const chatFallback = selections.find(selection => selection.capability === 'chat')?.fallbackProviderProfile ?? undefined
    if (chatFallback && chatFallback.capability !== 'chat')
      throw createBadRequestError('備援來源必須屬於對話能力，請重新選擇。', 'WEBNAVIOR_AI_FALLBACK_CAPABILITY_INVALID')
    const profiles = new Map([...byCapability.values(), ...(chatFallback ? [chatFallback] : [])].map(profile => [profile.id, profile]))
    const plaintextKeys = new Map<string, Buffer | undefined>()

    try {
      for (const profile of profiles.values()) {
        validateProviderProfile(profile.capability, profile)
        if (!profile.verifiedAt || !profile.modelId || !profile.discoveredModels.some(model => model.id === profile.modelId)) {
          throw createBadRequestError(
            `「${profile.name}」尚未通過目前模型的驗證，請重新讀取、驗證後再套用。`,
            'WEBNAVIOR_AI_PROVIDER_PROFILE_NOT_VERIFIED',
          )
        }
        const ciphertext = profile.apiKeyCiphertext
        plaintextKeys.set(profile.id, ciphertext
          ? options.envelopeCrypto.decryptKey(ciphertext, { keyEntryId: 'default', modelName: profileKeyLabel(profile.id) })
          : undefined)
      }

      const llmModels: LlmRouterConfig['llm']['models'] = {}
      const chat = byCapability.get('chat')
      const vision = byCapability.get('vision')
      applyLlmProfile(llmModels, chat ? [chat, ...(chatFallback ? [chatFallback] : [])] : [], RUNTIME_MODEL_NAMES.chat, plaintextKeys, options.envelopeCrypto)
      applyLlmProfile(llmModels, vision ? [vision] : [], RUNTIME_MODEL_NAMES.vision, plaintextKeys, options.envelopeCrypto)

      const asr = byCapability.get('asr')
      const tts = byCapability.get('tts')
      const runtimePolicy = {
        ...(chat ? { chatModel: RUNTIME_MODEL_NAMES.chat } : {}),
        ...(vision ? { visionModel: RUNTIME_MODEL_NAMES.vision } : {}),
        ...(asr ? { asrModel: RUNTIME_MODEL_NAMES.asr } : {}),
        ...(tts ? { ttsModel: RUNTIME_MODEL_NAMES.tts } : {}),
      }
      const nextRouter = {
        defaults: {
          fallbackHttpCodes: [401, 402, 403, 429, 500, 502, 503, 504],
          // A primary timeout must leave the backup its own configured budget.
          // Existing single-source chains retain their sixty-second ceiling.
          fullChainTimeoutMs: Math.max(60_000, ...Object.values(llmModels).map(model => model.upstreams.reduce((total, upstream) => total + (upstream.timeoutMs ?? 30_000), 0))),
          perAttemptTimeoutMs: 30_000,
        },
        llm: { models: llmModels },
        tts: { models: {} },
      }
      const audioConfig = {
        ...(asr ? { asr: compiledAudioConfig(asr, plaintextKeys.get(asr.id), 'asr', options.envelopeCrypto) } : {}),
        ...(tts ? { tts: compiledAudioConfig(tts, plaintextKeys.get(tts.id), 'tts', options.envelopeCrypto) } : {}),
      }
      // Redis has no cross-key transaction. We fully assemble values before
      // writing so a validation error cannot leave a partially changed policy.
      await Promise.all([
        options.configKV.set('LLM_ROUTER_CONFIG', nextRouter),
        options.configKV.set('WEBNAVIOR_AI_RUNTIME_CONFIG', runtimePolicy),
        options.configKV.set('WEBNAVIOR_AUDIO_CONFIG', audioConfig),
      ])
      await Promise.all(['LLM_ROUTER_CONFIG', 'WEBNAVIOR_AI_RUNTIME_CONFIG', 'WEBNAVIOR_AUDIO_CONFIG']
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

function applyLlmProfile(
  models: LlmRouterConfig['llm']['models'],
  profiles: WebnaviorAiProviderProfile[],
  runtimeModelName: typeof RUNTIME_MODEL_NAMES.chat | typeof RUNTIME_MODEL_NAMES.vision,
  plaintextKeys: Map<string, Buffer | undefined>,
  envelopeCrypto: EnvelopeCrypto,
) {
  if (profiles.length === 0) {
    delete models[runtimeModelName]
    return
  }
  models[runtimeModelName] = {
    fallbackTriggers: { httpCodes: [401, 402, 403, 429, 500, 502, 503, 504], onTimeout: true },
    upstreams: profiles.map((profile) => {
      const key = plaintextKeys.get(profile.id)
      // A saved profile revision changes opaque continuation ownership after
      // credential/account edits; an old account's reasoning cannot be replayed
      // against a replacement account at the same endpoint and model.
      const keyEntryId = `${profile.id}:${profile.updatedAt.getTime()}`
      return {
        baseURL: profile.baseURL,
        cachePrompt: profile.kind === 'llama-cpp',
        ...(profile.capability === 'chat' && profile.kind === 'openai-compatible' ? { enableThinking: profile.enableThinking, responseMode: profile.responseMode } : {}),
        ...(profile.kind === 'openai-responses' ? { apiFormat: 'openai-responses' as const, responseMode: profile.responseMode } : {}),
        ...(profile.kind === 'ollama' ? { ollamaKeepAlive: -1 } : {}),
        headerTemplate: key ? 'Bearer {KEY}' : '',
        keys: [{
          ciphertext: envelopeCrypto.encryptKey(key?.toString('utf8') ?? '', { keyEntryId, modelName: runtimeModelName }),
          id: keyEntryId,
        }],
        overrideModel: profile.modelId!,
        timeoutMs: profile.timeoutMs,
      }
    }),
  }
}

function compiledAudioConfig(profile: WebnaviorAiProviderProfile, key: Buffer | undefined, capability: 'asr' | 'tts', envelopeCrypto: EnvelopeCrypto) {
  return {
    baseURL: profile.baseURL,
    ...(key ? { keyCiphertext: envelopeCrypto.encryptKey(key.toString('utf8'), { keyEntryId: 'default', modelName: `webnavior-audio:${capability}` }) } : {}),
    modelName: RUNTIME_MODEL_NAMES[capability],
    upstreamModel: profile.modelId!,
    ...(capability === 'tts' ? { voice: profile.voice ?? 'zh-TW-HsiaoChenNeural', ...(profile.kind === 'openai-compatible' ? { speed: profile.speed ?? 1 } : {}) } : {}),
  }
}

function profileKeyLabel(profileId: string) {
  return `webnavior-ai:provider-profile:${profileId}`
}
