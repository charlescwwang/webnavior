import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import Redis from 'ioredis'

import { expect, it } from 'vitest'

import { transcribeKioskUtterance } from '../../../stage-kiosk/src/services/kiosk-audio'
import { createKioskUtteranceQueue } from '../../../stage-kiosk/src/services/kioskUtteranceQueue'
import { createConfigKVService } from '../../src/services/adapters/config-kv'
import { createKioskAudioGateway } from '../../src/services/domain/kiosk-audio'
import { createEnvelopeCrypto } from '../../src/utils/envelope-crypto'

// Synthetic speech only: initial two dumplings, correction to three, one bento,
// and no checkout. No customer recording, visitor, cart or POS is accessed.
it.skipIf(process.env.KIOSK_AUDIO_REPLAY !== '1')('transcribes a synthetic long correction through configured ASR before releasing one whole utterance', async () => {
  const fixture = process.env.KIOSK_AUDIO_REPLAY_FIXTURE
  if (!fixture || !process.env.REDIS_URL || !process.env.LLM_ROUTER_MASTER_KEY)
    throw new Error('Set a synthetic PCM16 WAV fixture and load the local audio configuration environment.')
  const wav = await readFile(fixture)
  // The fixture producer supplies canonical 44-byte-header, 16kHz mono PCM16;
  // reject other encodings rather than interpreting compressed bytes as speech.
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
  expect(wav.readUInt16LE(20)).toBe(1)
  expect(wav.readUInt16LE(22)).toBe(1)
  expect(wav.readUInt32LE(24)).toBe(16_000)
  expect(wav.readUInt16LE(34)).toBe(16)
  expect(wav.toString('ascii', 36, 40)).toBe('data')
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44)
  const samples = Float32Array.from({ length: (wav.length - 44) / 2 }, (_, index) => wav.readInt16LE(44 + index * 2) / 32768)
  expect(samples.length).toBeGreaterThan(16_000 * 40)
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 })
  const handled: string[] = []
  const queue = createKioskUtteranceQueue({ process: async (utterance) => {
    handled.push(utterance.text)
  } })
  const reservation = queue.reserve('asr')
  if (reservation.kind !== 'ACCEPTED')
    throw new Error('Expected capture reservation.')
  try {
    const configKV = createConfigKVService(redis)
    const config = await configKV.getOrThrow('WEBNAVIOR_AUDIO_CONFIG')
    if (!config.asr)
      throw new Error('Configured ASR is missing.')
    const envelopeCrypto = createEnvelopeCrypto({ masterKey: Buffer.from(process.env.LLM_ROUTER_MASTER_KEY, 'base64') })
    const durations: number[] = []
    const result = await transcribeKioskUtterance(samples, {
      signal: reservation.signal,
      transcribe: async (recording, signal, chunk) => {
        expect(recording.size).toBeLessThan(1024 * 1024)
        const gateway = createKioskAudioGateway({ configKV, envelopeCrypto, fetchImpl: (input, init) => fetch(input, { ...init, signal }) })
        const started = performance.now()
        const text = await gateway.transcribe({ audio: new File([recording], 'recording.wav'), modelName: config.asr!.modelName })
        durations.push(Math.round(performance.now() - started))
        process.stdout.write(`[synthetic-asr-chunk] ${JSON.stringify({ index: chunk!.index, bytes: recording.size, durationMs: durations.at(-1), nonempty: !!text.trim() })}\n`)
        expect(handled).toEqual([])
        return { text }
      },
    })
    expect(durations.length).toBeGreaterThanOrEqual(3)
    expect(result.text).toMatch(/水[餃饺]/u)
    expect(result.text).toMatch(/[兩两二2]/u)
    expect(result.text).toMatch(/[三3]/u)
    const initialQuantityAt = result.text.search(/[兩两二2]/u)
    const correctionAt = result.text.search(/更正|改/u)
    expect(correctionAt).toBeGreaterThan(initialQuantityAt)
    const correctedQuantityAt = result.text.slice(correctionAt).search(/[三3]/u) + correctionAt
    expect(correctedQuantityAt).toBeGreaterThan(correctionAt)
    expect(result.text.search(/便[當当]/u)).toBeGreaterThan(correctedQuantityAt)
    expect(result.text).toMatch(/便[當当]/u)
    expect(result.text).toMatch(/不要[結结][帳账]/u)
    reservation.complete(result)
    await queue.idle()
    expect(handled).toEqual([result.text])
  }
  finally {
    queue.reset()
    await redis.quit()
  }
}, 60_000)
