import process from 'node:process'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import { errorMessageFrom } from '@moeru/std'

import { createRedis } from '../libs/redis'
import { createConfigKVService } from '../services/adapters/config-kv'
import { createKioskEmbeddingGateway } from '../services/domain/kiosk-embedding'
import { evaluateSpeechGuard } from '../services/domain/kiosk-speech-guard'
import { createEnvelopeCrypto } from '../utils/envelope-crypto'

const batchSize = 32

interface DatasetRow {
  id: string
  label: 'ORDER_INTENT' | 'AGENT_RESPONSE' | 'KIOSK_COMMAND' | 'BACKGROUND_CONVERSATION' | 'AMBIGUOUS'
  requires_context: boolean
  text: string
}

interface ReferenceRow {
  id: string
  text_only_expected_label: DatasetRow['label']
}

async function main() {
  const redisUrl = process.env.REDIS_URL
  const masterKey = process.env.LLM_ROUTER_MASTER_KEY
  if (!redisUrl || !masterKey)
    throw new Error('REDIS_URL and LLM_ROUTER_MASTER_KEY are required.')

  const redis = createRedis(redisUrl)
  await redis.connect()
  try {
    const configKV = createConfigKVService(redis)
    if (!await configKV.getOptional('WEBNAVIOR_EMBEDDING_CONFIG'))
      throw new Error('WEBNAVIOR_EMBEDDING_CONFIG is not configured in Redis.')
    const embeddingGateway = createKioskEmbeddingGateway({
      configKV,
      envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.from(masterKey, 'base64') }),
    })
    const [prototypes, hardTest, references] = await Promise.all([
      readJsonl<DatasetRow>('prototype_examples.jsonl'),
      readJsonl<DatasetRow>('hard_test.jsonl'),
      readJsonl<ReferenceRow>('hard_test_reference_views.jsonl'),
    ])
    const referenceById = new Map(references.map(reference => [reference.id, reference]))
    const [prototypeEmbeddings, hardTestEmbeddings] = await Promise.all([
      embedInBatches(embeddingGateway.embed, prototypes.map(row => row.text), 'prototype'),
      embedInBatches(embeddingGateway.embed, hardTest.map(row => row.text), 'hard test'),
    ])
    const report = evaluateSpeechGuard({
      prototypes: prototypes.map((row, index) => ({
        embedding: prototypeEmbeddings[index],
        label: row.label,
        requiresContext: row.requires_context,
      })),
      rows: hardTest.map((row, index) => ({
        embedding: hardTestEmbeddings[index],
        expectedLabel: referenceById.get(row.id)?.text_only_expected_label ?? 'AMBIGUOUS',
        hasMatchingDialogueContext: false,
      })),
    })
    process.stdout.write(`${JSON.stringify({ evaluationView: 'text_only', ...report }, null, 2)}\n`)
  }
  finally {
    await redis.quit()
  }
}

async function readJsonl<T>(name: string) {
  const file = new URL(`../../../../docs/kiosk_speech_guard_zh_tw/${name}`, import.meta.url)
  return (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as T)
}

async function embedInBatches(embed: (texts: readonly string[]) => Promise<readonly number[][] | undefined>, texts: readonly string[], label: string) {
  const vectors: number[][] = []
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize)
    const embedded = await embed(batch)
    if (!embedded || embedded.length !== batch.length)
      throw new Error(`Embedding provider did not return ${label} batch ${start / batchSize + 1}.`)
    vectors.push(...embedded)
    process.stderr.write(`Embedded ${Math.min(start + batch.length, texts.length)}/${texts.length} ${label} rows.\n`)
  }
  return vectors
}

main().catch((error) => {
  process.stderr.write(`Kiosk speech guard evaluation failed: ${errorMessageFrom(error) ?? 'unknown error'}\n`)
  process.exitCode = 1
})
