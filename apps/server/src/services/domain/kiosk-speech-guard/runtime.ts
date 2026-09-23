import type { KioskSpeechGuardLabel, KioskSpeechPrototype } from '.'
import type { Database } from '../../../libs/db'
import type { KioskEmbeddingGateway } from '../kiosk-embedding'

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { and, desc, eq } from 'drizzle-orm'

import { classifySpeechCandidate } from '.'
import { ApiError, createBadRequestError } from '../../../utils/error'

import * as schema from '../../../schemas'

const datasetVersion = 'zh-tw-v2'
const batchSize = 32
// NOTICE: This is a system policy, not a shop-tuning setting. It prevents an
// arbitrary nearest prototype from overriding the conservative intent fallback.
const minimumSimilarity = 0.72

interface DatasetRow {
  id: string
  label: KioskSpeechGuardLabel
  requires_context: boolean
  text: string
}

export interface KioskSpeechGuardRuntime {
  classifyInitialSpeech: (text: string) => Promise<{ label: KioskSpeechGuardLabel, score: number } | undefined>
  getStatus: () => Promise<{ baselineCount: number, configurationError?: string, embeddingModelId?: string, embeddingProfileId?: string, ready: boolean }>
  initialize: () => Promise<{ baselineCount: number, embeddingModelId: string, embeddingProfileId: string }>
}

/**
 * Owns the persisted semantic baseline used before a new Kiosk conversation.
 * The interface deliberately exposes neither dataset text nor vectors: callers
 * only learn a safe label and confidence, while this module owns loading,
 * provider compatibility, batching, and in-process prototype caching.
 */
export function createKioskSpeechGuardRuntime(options: {
  db: Database
  embeddingGateway: KioskEmbeddingGateway
  embeddingRuntimeConfig: () => Promise<{ modelName: string, providerProfileId: string } | undefined>
}): KioskSpeechGuardRuntime {
  const cachedPrototypes = new Map<string, readonly KioskSpeechPrototype[]>()

  async function currentBaseline() {
    const config = await options.embeddingRuntimeConfig()
    if (!config)
      return undefined
    const baseline = await options.db.query.kioskSpeechGuardSets.findFirst({
      orderBy: [desc(schema.kioskSpeechGuardSets.createdAt)],
      where: and(
        eq(schema.kioskSpeechGuardSets.embeddingProfileId, config.providerProfileId),
        eq(schema.kioskSpeechGuardSets.embeddingModelId, config.modelName),
      ),
    })
    return baseline && { baseline, config }
  }

  async function loadPrototypes(setId: string) {
    const cached = cachedPrototypes.get(setId)
    if (cached)
      return cached
    const rows = await options.db.query.kioskSpeechGuardPrototypes.findMany({
      where: eq(schema.kioskSpeechGuardPrototypes.setId, setId),
    })
    const prototypes = rows.map(row => ({
      embedding: row.embedding,
      label: row.label as KioskSpeechGuardLabel,
      requiresContext: row.requiresContext,
    }))
    cachedPrototypes.set(setId, prototypes)
    return prototypes
  }

  async function getStatus() {
    let current: Awaited<ReturnType<typeof currentBaseline>>
    try {
      current = await currentBaseline()
    }
    catch (cause) {
      if (cause instanceof ApiError && cause.errorCode === 'CONFIG_INVALID') {
        // A prior release stored an embedding runtime shape without the active
        // profile id. This is recoverable through Apply, so listing Provider
        // Profiles must remain available instead of failing the entire page.
        return {
          baselineCount: 0,
          configurationError: '目前 Embedding 設定尚未重新套用。',
          ready: false,
        }
      }
      throw cause
    }
    if (!current)
      return { baselineCount: 0, ready: false }
    const prototypes = await loadPrototypes(current.baseline.id)
    return {
      baselineCount: prototypes.length,
      embeddingModelId: current.config.modelName,
      embeddingProfileId: current.config.providerProfileId,
      ready: prototypes.length > 0,
    }
  }

  async function initialize() {
    const config = await options.embeddingRuntimeConfig()
    if (!config) {
      throw createBadRequestError(
        '請先啟用並套用已驗證的 Embedding Provider，再建立語意防護基準。',
        'KIOSK_SPEECH_GUARD_EMBEDDING_NOT_APPLIED',
      )
    }
    const rows = await readDataset()
    const sourceHash = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
    const existing = await options.db.query.kioskSpeechGuardSets.findFirst({
      where: and(
        eq(schema.kioskSpeechGuardSets.embeddingProfileId, config.providerProfileId),
        eq(schema.kioskSpeechGuardSets.embeddingModelId, config.modelName),
        eq(schema.kioskSpeechGuardSets.sourceHash, sourceHash),
      ),
    })
    if (existing) {
      const prototypes = await loadPrototypes(existing.id)
      if (prototypes.length === rows.length) {
        return {
          baselineCount: prototypes.length,
          embeddingModelId: config.modelName,
          embeddingProfileId: config.providerProfileId,
        }
      }
    }

    const embeddings = await embedRows(options.embeddingGateway, rows)
    const baseline = await options.db.transaction(async (tx) => {
      await tx.delete(schema.kioskSpeechGuardSets).where(and(
        eq(schema.kioskSpeechGuardSets.embeddingProfileId, config.providerProfileId),
        eq(schema.kioskSpeechGuardSets.embeddingModelId, config.modelName),
      ))
      const [created] = await tx.insert(schema.kioskSpeechGuardSets).values({
        embeddingModelId: config.modelName,
        embeddingProfileId: config.providerProfileId,
        sourceHash,
        sourceVersion: datasetVersion,
      }).returning()
      await tx.insert(schema.kioskSpeechGuardPrototypes).values(rows.map((row, index) => ({
        embedding: embeddings[index],
        label: row.label,
        requiresContext: row.requires_context,
        setId: created.id,
        sourceId: row.id,
      })))
      return created
    })
    cachedPrototypes.delete(baseline.id)
    return {
      baselineCount: rows.length,
      embeddingModelId: config.modelName,
      embeddingProfileId: config.providerProfileId,
    }
  }

  async function classifyInitialSpeech(text: string) {
    const current = await currentBaseline()
    if (!current)
      return undefined
    const [candidateEmbedding] = await options.embeddingGateway.embed([text]) ?? []
    if (!candidateEmbedding)
      return undefined
    const prototypes = await loadPrototypes(current.baseline.id)
    if (prototypes.length === 0)
      return undefined
    const classified = classifySpeechCandidate({
      candidateEmbedding,
      hasMatchingDialogueContext: false,
      prototypes,
    })
    if (classified.score === undefined || classified.score < minimumSimilarity)
      return undefined
    return classified
  }

  return { classifyInitialSpeech, getStatus, initialize }
}

async function readDataset() {
  const source = new URL('../../../../../../docs/kiosk_speech_guard_zh_tw/prototype_examples.jsonl', import.meta.url)
  return (await readFile(source, 'utf8')).trim().split('\n').map((line) => {
    const row = JSON.parse(line) as DatasetRow
    if (!row.id || !row.text || !row.label || typeof row.requires_context !== 'boolean')
      throw new Error('Kiosk speech guard dataset contains an invalid prototype.')
    return row
  })
}

async function embedRows(embeddingGateway: KioskEmbeddingGateway, rows: readonly DatasetRow[]) {
  const vectors: number[][] = []
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const embedded = await embeddingGateway.embed(batch.map(row => row.text))
    if (!embedded || embedded.length !== batch.length)
      throw createBadRequestError('Embedding Provider 無法建立完整的語意防護基準。', 'KIOSK_SPEECH_GUARD_EMBEDDING_FAILED')
    vectors.push(...embedded)
  }
  return vectors
}
