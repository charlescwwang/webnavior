import { Buffer } from 'node:buffer'

import Redis from 'ioredis'

import { encodeFalconClip } from '@proj-airi/stage-shared/falcon-audio'
import { defaultFalconSettings } from '@proj-airi/stage-shared/falcon-settings'
import { afterEach, expect, it, vi } from 'vitest'

import { createKioskAudioGateway } from '.'
import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'
import { createConfigKVService } from '../../adapters/config-kv'

const clients: Redis[] = []
afterEach(() => clients.splice(0).forEach(client => client.disconnect()))
async function setup(fetchImpl: typeof fetch) {
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
  await config.set('FALCON_CONNECTION_CONFIG', { ...defaultFalconSettings, mode: 'falcon', keyCiphertext: crypto.encryptKey('test-falcon-key', { modelName: 'webnavior-falcon', keyEntryId: 'default' }) })
  return { config, gateway: createKioskAudioGateway({ configKV: config, envelopeCrypto: crypto, fetchImpl }) }
}
const clip = () => encodeFalconClip(new Float32Array(16000), Array.from({ length: 25 }, () => new Uint8Array(9216)))

it('forwards the complete binary clip to the server-owned Falcon service and returns only final text', async () => {
  const fetchImpl = vi.fn(async () => Response.json({ text: '水餃一份', model: 'kitchen-asr-v0.4', inferenceMs: 493.9, asrMs: 300.2 }))
  const { config, gateway } = await setup(fetchImpl)
  const packet = clip()
  await expect(gateway.transcribeFalcon(packet, new AbortController().signal)).resolves.toEqual({ text: '水餃一份', timing: { inferenceMs: 493.9, asrMs: 300.2 } })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(fetchImpl).toHaveBeenCalledWith(new URL('http://192.168.8.64:8767/api/falcon/extract'), expect.objectContaining({
    method: 'POST',
    body: packet,
    redirect: 'error',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Falcon-Precision': 'fp32', 'Authorization': 'Bearer test-falcon-key' },
  }))
  await expect(gateway.recognitionPolicy()).resolves.toEqual({ mode: 'falcon', maxUtteranceSeconds: 15, timeoutMs: 60000 })
  await config.set('FALCON_CONNECTION_CONFIG', { ...defaultFalconSettings })
  await expect(gateway.transcribeFalcon(packet, new AbortController().signal)).rejects.toMatchObject({ errorCode: 'KIOSK_RECOGNITION_MODE_CHANGED' })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

it('rejects corrupt lengths, old engine flags and non-finite audio before contacting the service', async () => {
  const fetchImpl = vi.fn()
  const { gateway } = await setup(fetchImpl)
  const flagged = clip()
  new DataView(flagged).setUint32(0, 0x40000019, true)
  const nan = clip()
  new DataView(nan).setFloat32(4, Number.NaN, true)
  for (const packet of [new ArrayBuffer(1), clip().slice(0, 50), flagged, nan])
    await expect(gateway.transcribeFalcon(packet, new AbortController().signal)).rejects.toMatchObject({ errorCode: 'KIOSK_FALCON_INVALID_CLIP' })
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('rejects audio output and incomplete SSE instead of treating them as an executable transcript', async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('wav', { headers: { 'Content-Type': 'audio/wav' } })).mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"加一份"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
  const { gateway, config } = await setup(fetchImpl)
  await expect(gateway.transcribeFalcon(clip(), new AbortController().signal)).rejects.toMatchObject({ errorCode: 'KIOSK_FALCON_UPSTREAM_ERROR' })
  await config.set('FALCON_CONNECTION_CONFIG', { ...defaultFalconSettings, mode: 'falcon', responseFormat: 'chat-completions' })
  await expect(gateway.transcribeFalcon(clip(), new AbortController().signal)).rejects.toMatchObject({ errorCode: 'KIOSK_FALCON_UPSTREAM_ERROR' })
})

it.runIf(Boolean(process.env.FALCON_INTEGRATION_URL))('sends a synthetic three-second clip through the actual Falcon gateway', async () => {
  const { gateway, config } = await setup(fetch)
  await config.set('FALCON_CONNECTION_CONFIG', { ...defaultFalconSettings, mode: 'falcon', baseURL: process.env.FALCON_INTEGRATION_URL! })
  const packet = encodeFalconClip(new Float32Array(48000), Array.from({ length: 75 }, () => new Uint8Array(9216).fill(107)))
  await expect(gateway.transcribeFalcon(packet, AbortSignal.timeout(60000))).resolves.toMatchObject({ text: '' })
}, 65000)
