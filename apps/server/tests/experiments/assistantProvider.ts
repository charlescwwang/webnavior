import type { Reservation } from './requestBudget'

import process from 'node:process'

import { Buffer } from 'node:buffer'

import Redis from 'ioredis'

import { eq } from 'drizzle-orm'

import { createDrizzle } from '../../src/libs/db'
import { webnaviorAiProviderProfiles } from '../../src/schemas/webnavior-ai'
import { createConfigKVService } from '../../src/services/adapters/config-kv'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'
import { admissionDelay } from './requestBudget'

/** Read-only credential access and paced, no-retry dispatch for synthetic tests. */
export async function openProvider(record: (entry: Record<string, unknown>) => void) {
  if (process.env.ASSISTANT_COMPARISON_LIVE !== '1' || process.env.ASSISTANT_COMPARISON_MODEL !== 'models/gemma-4-26b-a4b-it')
    throw new Error('Explicit synthetic-test opt-in and Gemma model selection required')
  if (!process.env.REDIS_URL || !process.env.LLM_ROUTER_MASTER_KEY)
    throw new Error('Server environment required; credentials are never recorded')
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 4000, retryStrategy: () => null })
  redis.on('error', () => {})
  let key: Buffer | undefined
  try {
    await redis.connect()
    const config = createConfigKVService(redis)
    const runtime = await config.getOptional('WEBNAVIOR_AI_RUNTIME_CONFIG')
    const router = await config.getOptional('LLM_ROUTER_CONFIG')
    const upstreams = runtime?.chatModel ? router?.llm.models[runtime.chatModel]?.upstreams : undefined
    const crypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY, 'base64'), ...(process.env.LLM_ROUTER_MASTER_KEY_PREVIOUS ? { previousMasterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY_PREVIOUS, 'base64') } : {}) })
    let endpoint: URL
    let authorization: string
    // An explicit stored test profile is independent of active production
    // binding. Never auto-search profiles or apply bindings to obtain a key.
    const profileId = process.env.ASSISTANT_COMPARISON_PROFILE_ID
    if (profileId) {
      if (!process.env.DATABASE_URL)
        throw new Error('Database environment required for explicit test profile')
      const { db, pool } = createDrizzle({ DATABASE_URL: process.env.DATABASE_URL, DB_POOL_MAX: 1, DB_POOL_IDLE_TIMEOUT_MS: 1000, DB_POOL_CONNECTION_TIMEOUT_MS: 4000, DB_POOL_KEEPALIVE_INITIAL_DELAY_MS: 1000 })
      try {
        const profile = await db.query.webnaviorAiProviderProfiles.findFirst({ where: eq(webnaviorAiProviderProfiles.id, profileId) })
        if (!profile || profile.capability !== 'chat' || profile.modelId !== process.env.ASSISTANT_COMPARISON_MODEL || !profile.apiKeyCiphertext)
          throw new Error('Explicit test profile must be the selected keyed Gemma chat profile')
        endpoint = new URL(`${profile.baseURL.replace(/\/$/, '')}/chat/completions`)
        if (endpoint.hostname !== 'generativelanguage.googleapis.com')
          throw new Error('Only the approved Google compatibility endpoint is allowed')
        key = crypto.decryptKey(profile.apiKeyCiphertext, { modelName: `webnavior-ai:provider-profile:${profile.id}`, keyEntryId: 'default' })
        authorization = `Bearer ${key.toString('utf8')}`
      }
      finally { await pool.end() }
    }
    else {
      if (upstreams?.length !== 1 || upstreams[0]!.keys.length !== 1)
        throw new Error('Exactly one configured chat upstream/key required')
      const upstream = upstreams[0]!
      endpoint = new URL(`${upstream.baseURL.replace(/\/$/, '')}/chat/completions`)
      if (endpoint.hostname !== 'generativelanguage.googleapis.com')
        throw new Error('Only the approved Google compatibility endpoint is allowed')
      key = crypto.decryptKey(upstream.keys[0]!.ciphertext, { modelName: runtime!.chatModel!, keyEntryId: upstream.keys[0]!.id })
      authorization = (upstream.headerTemplate ?? 'Bearer {KEY}').replace('{KEY}', key.toString('utf8'))
    }
    const model = process.env.ASSISTANT_COMPARISON_MODEL
    const history: Reservation[] = []
    let stopped = false
    const admit = async (tokens: number) => {
      let delay = admissionDelay(history, tokens, Date.now())
      let waited = 0
      if (delay)
        console.info(JSON.stringify({ quotaWait_ms: delay }))
      while (delay) {
        const chunk = Math.min(delay, 10_000)
        await new Promise<void>(resolve => setTimeout(resolve, chunk))
        waited += chunk
        delay = admissionDelay(history, tokens, Date.now())
      }
      history.push({ at: Date.now(), inputTokens: tokens })
      return waited
    }
    record({ type: 'provider', model, configuredProductionModel: upstreams?.[0]?.overrideModel, runtimeAlias: runtime?.chatModel, explicitTestProfile: Boolean(profileId), productionWrites: false, quota: { rpm: 24, reservedTokensPerMinute: 12800, perRunRequests: 11520 }, tokenMethod: 'Count serialized complete OpenAI envelope as text; add512 conversion headroom and max_tokens output reservation. Check actual prompt usage; stop if underestimated. Not native tool token equivalence or a global quota ledger.' })
    return {
      close: () => {
        key?.fill(0)
        redis.disconnect()
      },
      complete: async (input: Record<string, unknown>, tag: string) => {
        if (stopped)
          throw new Error('Provider stopped; no retries or quota bypass')
        const body = { ...input, model, stream: false, temperature: 0, max_tokens: 1536 }
        let wait_ms = await admit(0)
        const countStart = performance.now()
        const counted = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:countTokens`, { method: 'POST', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key!.toString('utf8') }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: JSON.stringify(body) }] }] }) })
        if (!counted.ok) {
          stopped = true
          await counted.body?.cancel()
          record({ type: 'provider-error', tag, stage: 'count', status: counted.status })
          throw new Error(`Token preflight HTTP${counted.status}; stopped`)
        }
        const count = await counted.json() as { totalTokens?: number }
        if (!Number.isInteger(count.totalTokens) || !count.totalTokens)
          throw new Error('Missing reliable token count')
        const count_ms = performance.now() - countStart
        const inputReservation = count.totalTokens + 512
        wait_ms += await admit(inputReservation + body.max_tokens)
        const start = performance.now()
        try {
          const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'Content-Type': 'application/json', 'Authorization': authorization }, body: JSON.stringify(body) })
          if (!response.ok) {
            await response.body?.cancel()
            throw new Error(`Generation HTTP${response.status}; stopped`)
          }
          const data = await response.json() as { usage?: { prompt_tokens?: number }, choices?: unknown[] }
          if ((data.usage?.prompt_tokens ?? 0) > inputReservation) {
            stopped = true
            throw new Error('Input reservation underestimated; stopped')
          }
          record({ type: 'generation', tag, body, data, latency_ms: performance.now() - start, count_ms, wait_ms, countedTokens: count.totalTokens, reservedTokens: inputReservation + body.max_tokens })
          return Response.json(data)
        }
        catch (error) {
          stopped = true
          record({ type: 'provider-error', tag, stage: 'generation', latency_ms: performance.now() - start })
          throw error
        }
      },
    }
  }
  catch (error) {
    key?.fill(0)
    redis.disconnect()
    throw error
  }
}
