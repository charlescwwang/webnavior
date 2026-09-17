import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'
import type { ConfigKVService } from '../../adapters/config-kv'

import { createServiceUnavailableError } from '../../../utils/error'

export interface KioskEmbeddingGateway {
  embed: (texts: readonly string[]) => Promise<readonly number[][] | undefined>
}

/**
 * Resolves one short-lived Server-side embedding request from dynamic ConfigKV.
 * An unavailable semantic provider is deliberately non-fatal: the later turn
 * policy must retain its conservative ASR/VAD fallback instead of blocking a
 * customer order because optional semantic enrichment is offline.
 */
export function createKioskEmbeddingGateway(options: {
  configKV: ConfigKVService
  envelopeCrypto: EnvelopeCrypto
  fetchImpl?: typeof fetch
}): KioskEmbeddingGateway {
  const fetchImpl = options.fetchImpl ?? fetch

  async function embed(texts: readonly string[]) {
    if (texts.length === 0)
      return []
    const config = await options.configKV.getOptional('WEBNAVIOR_EMBEDDING_CONFIG')
    if (!config)
      return undefined

    const key = config.keyCiphertext
      ? options.envelopeCrypto.decryptKey(config.keyCiphertext, { keyEntryId: 'default', modelName: 'webnavior-kiosk:embedding' })
      : undefined
    try {
      const response = await fetchImpl(new URL('embeddings', `${config.baseURL.replace(/\/$/, '')}/`), {
        body: JSON.stringify({ input: texts, model: config.modelName }),
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key.toString('utf8')}` } : {}),
        },
        method: 'POST',
        signal: AbortSignal.timeout(config.timeoutMs),
      })
      if (!response.ok)
        throw createServiceUnavailableError('Kiosk embedding provider did not return a successful response', 'KIOSK_EMBEDDING_UPSTREAM_ERROR')
      const payload: unknown = await response.json()
      if (!isEmbeddingResponse(payload, texts.length))
        throw createServiceUnavailableError('Kiosk embedding provider response is invalid', 'KIOSK_EMBEDDING_INVALID_RESPONSE')
      return payload.data.map(item => item.embedding)
    }
    finally {
      key?.fill(0)
    }
  }

  return { embed }
}

function isEmbeddingResponse(value: unknown, expectedCount: number): value is { data: Array<{ embedding: number[] }> } {
  if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data) || value.data.length !== expectedCount)
    return false
  return value.data.every(item => item && typeof item === 'object' && 'embedding' in item && Array.isArray(item.embedding) && item.embedding.every(value => typeof value === 'number' && Number.isFinite(value)))
}
