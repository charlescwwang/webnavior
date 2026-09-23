import type { Database } from '../../../libs/db'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockDB } from '../../../libs/mock-db'
import { createServiceUnavailableError } from '../../../utils/error'
import { createKioskSpeechGuardRuntime } from './runtime'

import * as schema from '../../../schemas'

describe('kiosk Speech Guard runtime', () => {
  let db: Database

  beforeEach(async () => {
    db = await mockDB(schema)
    await db.insert(schema.webnaviorAiProviderProfiles).values({
      capability: 'embedding',
      baseURL: 'http://embedding.local/v1',
      id: 'embedding-profile',
      kind: 'ollama',
      modelId: 'embeddinggemma',
      name: '測試 Embedding',
    })
  })

  it('persists one baseline for the applied embedding profile and reuses it', async () => {
    const embed = vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0]))
    const runtime = createKioskSpeechGuardRuntime({
      db,
      embeddingGateway: { embed },
      embeddingRuntimeConfig: async () => ({ modelName: 'embeddinggemma', providerProfileId: 'embedding-profile' }),
    })

    await expect(runtime.initialize()).resolves.toMatchObject({
      baselineCount: 685,
      embeddingModelId: 'embeddinggemma',
      embeddingProfileId: 'embedding-profile',
    })
    expect(embed).toHaveBeenCalledTimes(22)
    await expect(runtime.getStatus()).resolves.toMatchObject({ baselineCount: 685, ready: true })
    await expect(runtime.classifyInitialSpeech('我想點一碗麵')).resolves.toMatchObject({ label: 'ORDER_INTENT' })

    await expect(runtime.initialize()).resolves.toMatchObject({ baselineCount: 685 })
    expect(embed).toHaveBeenCalledTimes(23)
  })

  it('reports a stale embedding runtime setting without blocking the management page', async () => {
    const runtime = createKioskSpeechGuardRuntime({
      db,
      embeddingGateway: { embed: async () => undefined },
      embeddingRuntimeConfig: async () => {
        throw createServiceUnavailableError('Service configuration is invalid', 'CONFIG_INVALID')
      },
    })

    await expect(runtime.getStatus()).resolves.toEqual({
      baselineCount: 0,
      configurationError: '目前 Embedding 設定尚未重新套用。',
      ready: false,
    })
  })
})
