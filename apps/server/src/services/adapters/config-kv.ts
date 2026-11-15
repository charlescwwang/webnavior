import type Redis from 'ioredis'
import type { InferOutput } from 'valibot'

import { errorMessageFrom } from '@moeru/std'
import { chatResponseModeSchema } from '@proj-airi/stage-shared/ai-provider'
import { any, array, boolean, check, integer, maxValue, minValue, nonEmpty, number, object, optional, parse, picklist, pipe, record, regex, string } from 'valibot'

import { createServiceUnavailableError } from '../../utils/error'
import { configRedisKey } from '../../utils/redis-keys'

/**
 * LLM/TTS router config tree. Single composite entry under configKV holds the
 * entire routing surface: per-model upstream list, per-upstream key array
 * (envelope-encrypted ciphertexts), fallback triggers, default timeouts.
 *
 * Schema enforces:
 * - key entry id must not contain `|` — the envelope-crypto AAD uses `|` as
 *   a reserved separator between `modelName` and `keyEntryId`.
 * - keys array is non-empty per upstream (an upstream with zero keys can
 *   never serve a request and is almost certainly an admin mistake).
 *
 * Defaults at this layer apply when the admin omits the `defaults` object;
 * the router service is responsible for surfacing CONFIG_NOT_SET when the
 * whole `LLM_ROUTER_CONFIG` entry is absent.
 */
export const fallbackTriggersSchema = optional(
  object({
    httpCodes: optional(array(number()), [401, 402, 403, 429, 500, 502, 503, 504]),
    onTimeout: optional(boolean(), true),
  }),
  { httpCodes: [401, 402, 403, 429, 500, 502, 503, 504], onTimeout: true },
)

export const keyEntrySchema = object({
  id: pipe(
    string(),
    nonEmpty('keys[].id must not be empty'),
    regex(/^[^|]+$/, 'keys[].id must not contain "|" (reserved AAD separator)'),
  ),
  ciphertext: pipe(string(), nonEmpty('keys[].ciphertext must not be empty')),
})

export const llmUpstreamSchema = object({
  /** Omitted selects the existing Chat Completions protocol. */
  apiFormat: optional(picklist(['openai-responses'])),
  /** Native non-reasoning benchmark policy; omitted preserves the caller/provider default. */
  reasoningEffort: optional(picklist(['none'])),
  /** Optional model-template policy; absence leaves the provider default unchanged. */
  enableThinking: optional(boolean()),
  /** A JSON-only provider can serve a streaming Kiosk through a final event. */
  responseMode: optional(chatResponseModeSchema),
  baseURL: pipe(string(), nonEmpty('llm.upstreams[].baseURL must not be empty')),
  /** llama.cpp extension; never sent to generic OpenAI-compatible upstreams. */
  cachePrompt: optional(boolean()),
  /** Ollama-only residency in seconds; -1 disables idle unloading, 0 releases the model. */
  ollamaKeepAlive: optional(pipe(number(), integer(), minValue(-1))),
  overrideModel: optional(string()),
  keys: pipe(array(keyEntrySchema), check(v => v.length >= 1, 'llm.upstreams[].keys must contain at least 1 entry')),
  headerTemplate: optional(string(), 'Bearer {KEY}'),
  timeoutMs: optional(number()),
})

export const llmModelSchema = object({
  upstreams: pipe(array(llmUpstreamSchema), check(v => v.length >= 1, 'llm.models[].upstreams must contain at least 1 entry')),
  fallbackTriggers: fallbackTriggersSchema,
})

const ttsProviderSchema = picklist(['azure', 'dashscope-cosyvoice', 'stepfun', 'volcengine'])
const asrProviderSchema = picklist(['aliyun-nls'])

/** Webnavior-only OpenAI-compatible audio endpoints. Kept separate from AIRI's adapter router. */
export const DEFAULT_WEBNAVIOR_TTS_VOICE = 'zh-TW-HsiaoChenNeural'

export const webnaviorAudioConfigSchema = optional(object({
  asr: optional(object({
    modelName: pipe(string(), nonEmpty('asr.modelName must not be empty')),
    upstreamModel: pipe(string(), nonEmpty('asr.upstreamModel must not be empty')),
    baseURL: pipe(string(), nonEmpty('asr.baseURL must not be empty')),
    keyCiphertext: optional(string()),
  })),
  tts: optional(object({
    modelName: pipe(string(), nonEmpty('tts.modelName must not be empty')),
    upstreamModel: pipe(string(), nonEmpty('tts.upstreamModel must not be empty')),
    baseURL: pipe(string(), nonEmpty('tts.baseURL must not be empty')),
    voice: optional(pipe(string(), nonEmpty('tts.voice must not be empty'))),
    speed: optional(pipe(number(), minValue(0.25), maxValue(4))),
    keyCiphertext: optional(string()),
  })),
}), {})

/**
 * Kiosk-only system defaults compiled from the Webnavior AI control plane.
 * A Site's explicit model override always wins; absence here preserves the
 * pre-control-plane router defaults as a complete fallback baseline.
 */
export const webnaviorAiRuntimeConfigSchema = optional(object({
  asrModel: optional(pipe(string(), nonEmpty('asrModel must not be empty'))),
  chatModel: optional(pipe(string(), nonEmpty('chatModel must not be empty'))),
  ttsModel: optional(pipe(string(), nonEmpty('ttsModel must not be empty'))),
  visionModel: optional(pipe(string(), nonEmpty('visionModel must not be empty'))),
}), {})

export const ttsUpstreamSchema = object({
  baseURL: pipe(string(), nonEmpty('tts.upstreams[].baseURL must not be empty')),
  keys: pipe(array(keyEntrySchema), check(v => v.length >= 1, 'tts.upstreams[].keys must contain at least 1 entry')),
  adapterParams: optional(record(string(), any()), {}),
  // Per-app_id concurrency cap for the pool load balancer. One upstream maps to
  // one app_id (Volcengine `adapterParams.appid`), capped by the provider at a
  // small number (e.g. 10). When set on any upstream of a model, the router
  // switches from fixed-order fallback to capacity-aware routing across pools.
  // Absent = unlimited: that model keeps the original fixed-order behavior and
  // makes zero Redis calls (no regression for existing single-app configs).
  maxConcurrency: optional(pipe(number(), check(v => v >= 1, 'tts.upstreams[].maxConcurrency must be >= 1 when set'))),
})

export const streamingTtsUpstreamSchema = object({
  baseURL: pipe(string(), nonEmpty('UNSPEECH_UPSTREAM.streaming.baseURL must not be empty')),
  keys: pipe(array(keyEntrySchema), check(v => v.length >= 1, 'UNSPEECH_UPSTREAM.streaming.keys must contain at least 1 entry')),
  adapterParams: optional(record(string(), any()), {}),
  models: optional(
    array(object({
      id: pipe(string(), nonEmpty('UNSPEECH_UPSTREAM.streaming.models[].id must not be empty')),
      name: optional(string()),
      description: optional(string()),
    })),
    [],
  ),
  defaultModel: optional(string()),
})

export const unspeechUpstreamSchema = object({
  restBaseURL: pipe(string(), nonEmpty('UNSPEECH_UPSTREAM.restBaseURL must not be empty')),
  streaming: optional(streamingTtsUpstreamSchema),
})

export const ttsModelSchema = object({
  provider: ttsProviderSchema,
  upstreams: pipe(array(ttsUpstreamSchema), check(v => v.length >= 1, 'tts.models[].upstreams must contain at least 1 entry')),
  fallbackTriggers: fallbackTriggersSchema,
})

export const asrUpstreamSchema = object({
  keys: pipe(array(keyEntrySchema), check(v => v.length >= 1, 'asr.upstreams[].keys must contain at least 1 entry')),
  adapterParams: optional(record(string(), any()), {}),
})

export const asrModelSchema = object({
  provider: asrProviderSchema,
  upstreams: pipe(array(asrUpstreamSchema), check(v => v.length >= 1, 'asr.models[].upstreams must contain at least 1 entry')),
})

export const llmRouterDefaultsSchema = optional(
  object({
    perAttemptTimeoutMs: optional(number(), 30000),
    fullChainTimeoutMs: optional(number(), 60000),
    fallbackHttpCodes: optional(array(number()), [401, 402, 403, 429, 500, 502, 503, 504]),
  }),
  { perAttemptTimeoutMs: 30000, fullChainTimeoutMs: 60000, fallbackHttpCodes: [401, 402, 403, 429, 500, 502, 503, 504] },
)

export const llmRouterConfigSchema = object({
  llm: object({
    models: record(string(), llmModelSchema),
  }),
  tts: object({
    models: record(string(), ttsModelSchema),
  }),
  asr: optional(object({
    models: record(string(), asrModelSchema),
  })),
  defaults: llmRouterDefaultsSchema,
})

export type LlmRouterConfig = InferOutput<typeof llmRouterConfigSchema>

/**
 * Config entry schemas are the single source of truth for:
 * - runtime validation
 * - default values
 * - Redis serialization/deserialization shape
 */
const ConfigEntrySchemas = {
  FLUX_PER_REQUEST: optional(number(), 5),
  INITIAL_USER_FLUX: optional(number(), 0),
  FLUX_PER_1K_TOKENS: optional(number(), 1),
  FLUX_PER_1K_CHARS_TTS: number(),
  // Debt-ledger TTL: residual TTS chars below 1 Flux are forgiven on expiry.
  // 24h gives users a long-enough window for accumulated dust to settle naturally.
  TTS_DEBT_TTL_SECONDS: optional(number(), 86400),
  AUTH_RATE_LIMIT_MAX: optional(number(), 20),
  AUTH_RATE_LIMIT_WINDOW_SEC: optional(number(), 60),
  // No default — absent means top-up is not available yet
  STRIPE_FLUX_PRODUCT_ID: optional(string()),
  // No default — absent lets Stripe auto-select payment methods via Dashboard config
  STRIPE_PAYMENT_METHODS: optional(array(string())),
  STRIPE_PAYMENT_METHOD_OPTIONS: optional(record(string(), any()), {}),
  // model id → (BCP-47 locale → recommended voice id). Outer key is either a
  // router TTS model id (LLM_ROUTER_CONFIG.tts.models key) for REST or a
  // streaming api_resource_id (e.g. `seed-tts-2.0`) for the streaming surface.
  // The two key spaces do not overlap. Consumed by the client to preselect a
  // voice matching UI locale per active model.
  DEFAULT_TTS_VOICES: optional(record(string(), record(string(), string())), {}),
  // Server-side alias resolution for `model: 'auto'` in /chat/completions and
  // /audio/speech. The modelName written here must exist as a key in
  // LLM_ROUTER_CONFIG.{llm,tts}.models — the router itself doesn't understand
  // `auto`, this layer translates before dispatch. No default: missing entry
  // surfaces CONFIG_NOT_SET (resolveWithDefault swallows ValiError) so a
  // misconfigured deploy fails the request instead of silently routing to an
  // empty modelName. Naked schema (not wrapped in optional) keeps the inferred
  // type tight (`string` rather than `string | undefined`) for call sites.
  DEFAULT_CHAT_MODEL: pipe(string(), nonEmpty('DEFAULT_CHAT_MODEL must not be empty')),
  DEFAULT_TTS_MODEL: pipe(string(), nonEmpty('DEFAULT_TTS_MODEL must not be empty')),
  // No default — the router throws CONFIG_NOT_SET when this entry is absent
  // so the admin endpoint (U9) is forced to populate it before traffic flows.
  LLM_ROUTER_CONFIG: optional(llmRouterConfigSchema),
  // Single unspeech deployment used for every TTS surface: REST audio/speech,
  // REST voices catalog, ws audio/speech/stream. `streaming` is optional —
  // operator may run REST-only without the ws upstream. `streaming.keys`
  // carry the upstream-provider API key (Volcengine X-Api-Key), not an
  // unspeech tenant token (unspeech itself is unauthenticated).
  UNSPEECH_UPSTREAM: optional(unspeechUpstreamSchema),
  // Webnavior's direct OpenAI-compatible speech integrations deliberately do
  // not share AIRI's unspeech adapter configuration.
  WEBNAVIOR_AUDIO_CONFIG: webnaviorAudioConfigSchema,
  WEBNAVIOR_AI_RUNTIME_CONFIG: webnaviorAiRuntimeConfigSchema,
} as const

type ConfigDefinitions = {
  [K in keyof typeof ConfigEntrySchemas]: InferOutput<(typeof ConfigEntrySchemas)[K]>
}

type ConfigKey = keyof ConfigDefinitions

function parseValue<K extends ConfigKey>(key: K, raw: string): ConfigDefinitions[K] {
  try {
    return parse(ConfigEntrySchemas[key], JSON.parse(raw)) as ConfigDefinitions[K]
  }
  catch (error) {
    throw createServiceUnavailableError(
      'Service configuration is invalid',
      'CONFIG_INVALID',
      {
        key,
        message: errorMessageFrom(error) ?? 'Unknown config parse error',
      },
    )
  }
}

function serializeValue<K extends ConfigKey>(key: K, value: ConfigDefinitions[K]): string {
  return JSON.stringify(parse(ConfigEntrySchemas[key], value))
}

/**
 * Resolve a config value: read from Redis, then apply valibot default if missing.
 * Returns `undefined` if both Redis and schema have no value (required key, not set).
 */
function resolveWithDefault<K extends ConfigKey>(key: K, raw: string | null): ConfigDefinitions[K] | undefined {
  if (raw !== null)
    return parseValue(key, raw)

  // Use the per-key schema with `undefined` to trigger the key default
  try {
    return parse(ConfigEntrySchemas[key], undefined) as ConfigDefinitions[K]
  }
  catch {
    return undefined
  }
}

export function createConfigKVService(redis: Redis) {
  return {
    async getOptional<K extends ConfigKey>(key: K): Promise<ConfigDefinitions[K] | null> {
      const raw = await redis.get(configRedisKey(key))
      const value = resolveWithDefault(key, raw)
      return value ?? null
    },

    async getOrThrow<K extends ConfigKey>(key: K): Promise<Exclude<ConfigDefinitions[K], undefined>> {
      const raw = await redis.get(configRedisKey(key))
      const value = resolveWithDefault(key, raw)
      if (value === undefined)
        throw createServiceUnavailableError('Service configuration is incomplete', 'CONFIG_NOT_SET')

      return value as Exclude<ConfigDefinitions[K], undefined>
    },

    async get<K extends ConfigKey>(key: K): Promise<Exclude<ConfigDefinitions[K], undefined>> {
      return this.getOrThrow(key)
    },

    async set<K extends ConfigKey>(key: K, value: ConfigDefinitions[K]): Promise<void> {
      const serialized = serializeValue(key, value)
      await redis.set(configRedisKey(key), serialized)
    },

    /** Removes an optional setting so runtime resolution falls back to its schema default. */
    async unset(key: ConfigKey): Promise<void> {
      await redis.del(configRedisKey(key))
    },
  }
}

export type ConfigKVService = ReturnType<typeof createConfigKVService>
