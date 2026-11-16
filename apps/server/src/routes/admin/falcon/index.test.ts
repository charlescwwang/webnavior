import type { HonoEnv } from '../../../types/hono'

import { Buffer } from 'node:buffer'

import Redis from 'ioredis'

import { defaultFalconSettings, falconSettingsSnapshotSchema } from '@proj-airi/stage-shared/falcon-settings'
import { Hono } from 'hono'
import { parse } from 'valibot'
import { afterEach, expect, it, vi } from 'vitest'

import { createAdminFalconRoutes } from '.'
import { createConfigKVService } from '../../../services/adapters/config-kv'
import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'
import { ApiError } from '../../../utils/error'

const clients: Redis[] = []
afterEach(() => clients.splice(0).forEach(client => client.disconnect()))

function setup(role = 'admin') {
  const redis = new Redis({ lazyConnect: true })
  clients.push(redis)
  const values = new Map<string, string>()
  vi.spyOn(redis, 'get').mockImplementation(async key => values.get(String(key)) ?? null)
  vi.spyOn(redis, 'set').mockImplementation(async (key, value) => {
    values.set(String(key), String(value))
    return 'OK'
  })
  const config = createConfigKVService(redis)
  const crypto = createEnvelopeCrypto({ masterKey: Buffer.alloc(32) })
  const app = new Hono<HonoEnv>()
    .use('*', async (c, next) => {
      c.set('user', { id: 'falcon-settings-test', role } as HonoEnv['Variables']['user'])
      await next()
    })
    .route('/', createAdminFalconRoutes(config, crypto))
  app.onError((error, c) => error instanceof ApiError ? c.json({ error: error.errorCode }, error.statusCode) : c.json({ error: 'internal' }, 500))
  const save = (body: object) => app.request('/', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { app, save, config, crypto, values }
}

it('loads editable defaults without enabling Falcon or changing ASR configuration', async () => {
  const { app, save, config } = setup()
  await config.set('WEBNAVIOR_AUDIO_CONFIG', { asr: { modelName: 'asr', upstreamModel: 'existing', baseURL: 'https://asr.test/v1' } })
  expect(await (await app.request('/')).json()).toEqual({ settings: defaultFalconSettings, hasApiKey: false, ready: false, responseStatus: 'pending' })
  expect((await save({ ...defaultFalconSettings, timeoutMs: 90_000 })).status).toBe(200)
  expect((await config.get('FALCON_CONNECTION_CONFIG')).timeoutMs).toBe(90_000)
  expect((await config.get('WEBNAVIOR_AUDIO_CONFIG')).asr?.upstreamModel).toBe('existing')
})

it('encrypts the key, keeps a blank key unchanged and supports explicit removal', async () => {
  const { app, save, config, crypto, values } = setup()
  const response = await save({ ...defaultFalconSettings, plaintextKey: 'test-only-key' })
  expect(response.status).toBe(200)
  expect(JSON.stringify(await response.json())).not.toContain('test-only-key')
  const stored = await config.get('FALCON_CONNECTION_CONFIG')
  expect(stored.keyCiphertext).toBeTruthy()
  expect([...values.values()].join()).not.toContain('test-only-key')
  const decrypted = crypto.decryptKey(stored.keyCiphertext!, { modelName: 'webnavior-falcon', keyEntryId: 'default' })
  expect(decrypted.toString()).toBe('test-only-key')
  decrypted.fill(0)
  await save({ ...defaultFalconSettings, plaintextKey: '' })
  expect((await config.get('FALCON_CONNECTION_CONFIG')).keyCiphertext).toBe(stored.keyCiphertext)
  await save({ ...defaultFalconSettings, clearApiKey: true })
  expect(parse(falconSettingsSnapshotSchema, await (await app.request('/')).json()).hasApiKey).toBe(false)
})

it('rejects activation, invalid URLs, unsupported precision and excessive limits before writing', async () => {
  const { save, values } = setup()
  for (const invalid of [
    { mode: 'falcon' },
    { baseURL: 'file:///etc/passwd' },
    { baseURL: 'http://user:password@192.168.8.64:8768' },
    { path: '//other.test/extract' },
    { engine: 'pytorch', precision: 'int8' },
    { timeoutMs: 180001 },
    { maxUtteranceSeconds: 31 },
    { plaintextKey: 'x', clearApiKey: true },
  ]) {
    expect((await save({ ...defaultFalconSettings, ...invalid })).status).toBe(400)
  }
  expect(values.size).toBe(0)
})

it('denies non-administrators access to both settings and credentials', async () => {
  const { app, save, values } = setup('user')
  expect((await app.request('/')).status).toBe(403)
  expect((await save(defaultFalconSettings)).status).toBe(403)
  expect(values.size).toBe(0)
})
