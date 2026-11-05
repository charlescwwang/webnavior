import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { createKioskAudioGateway } from '.'
import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'
import { createConfigKVService } from '../../adapters/config-kv'

describe('createKioskAudioGateway', () => {
  it('forwards the configured TTS voice and preserves binary audio responses', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(JSON.parse(String(init?.body))).toEqual({
        input: '你好，這是一段語音測試。',
        model: 'tts-1',
        voice: 'zh-TW-HsiaoChenNeural',
        response_format: 'mp3',
        speed: 1.0,
      })
      return new Response(new Uint8Array([0x49, 0x44, 0x33]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    })
    const configStore = new Map<string, string>()
    const configKV = createConfigKVService({
      get: vi.fn(async key => configStore.get(key) ?? null),
      set: vi.fn(async (key, value) => { configStore.set(key, value) }),
    } as any)
    await configKV.set('WEBNAVIOR_AUDIO_CONFIG', {
      tts: {
        modelName: 'openai-compatible/tts-1',
        upstreamModel: 'tts-1',
        baseURL: 'https://edge-tts.aikcitri.qzz.io/v1',
        voice: 'zh-TW-HsiaoChenNeural',
      },
    })
    const gateway = createKioskAudioGateway({
      configKV,
      envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32) }),
      fetchImpl,
    })

    const response = await gateway.speak({
      locale: 'zh-TW',
      modelName: 'openai-compatible/tts-1',
      text: '你好，這是一段語音測試。',
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://edge-tts.aikcitri.qzz.io/v1/audio/speech',
      expect.any(Object),
    )
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([0x49, 0x44, 0x33]).buffer)
  })

  // Report: this chat, 2026-11-04 — LINE Pay / 街口支付 recognition.
  it('supplies payment vocabulary to ASR without rewriting the returned transcript', async () => {
    const configStore = new Map<string, string>()
    const configKV = createConfigKVService({
      get: vi.fn(async key => configStore.get(key) ?? null),
      set: vi.fn(async (key, value) => { configStore.set(key, value) }),
    } as any)
    await configKV.set('WEBNAVIOR_AUDIO_CONFIG', {
      asr: { baseURL: 'https://asr.example.com/v1', modelName: 'openai-compatible/whisper-1', upstreamModel: 'whisper-1' },
    })
    const audio = new File(['audio'], 'payment.wav', { type: 'audio/wav' })
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData)
      const body = init?.body as FormData
      expect(body.get('prompt')).toContain('LINE Pay')
      expect(body.get('prompt')).toContain('街口支付')
      expect(body.get('model')).toBe('whisper-1')
      const uploaded = body.get('file')
      if (!(uploaded instanceof File))
        throw new Error('ASR upload must contain an audio file')
      expect(uploaded.name).toBe('payment.wav')
      expect(uploaded.type).toBe('audio/wav')
      await expect(uploaded.text()).resolves.toBe('audio')
      return Response.json({ text: '我想先看看付款方式' })
    })
    const gateway = createKioskAudioGateway({ configKV, envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32) }), fetchImpl })
    await expect(gateway.transcribe({ audio, modelName: 'openai-compatible/whisper-1' })).resolves.toBe('我想先看看付款方式')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('records a bounded ASR upstream failure without exposing its credential', async () => {
    const warn = vi.fn()
    const withFields = vi.fn(() => ({ warn }))
    const configStore = new Map<string, string>()
    const configKV = createConfigKVService({
      get: vi.fn(async key => configStore.get(key) ?? null),
      set: vi.fn(async (key, value) => { configStore.set(key, value) }),
    } as any)
    await configKV.set('WEBNAVIOR_AUDIO_CONFIG', {
      asr: {
        baseURL: 'https://asr.example.com/v1',
        keyCiphertext: createEnvelopeCrypto({ masterKey: Buffer.alloc(32) }).encryptKey('secret-asr-key', { keyEntryId: 'default', modelName: 'webnavior-audio:asr' }),
        modelName: 'openai-compatible/whisper-1',
        upstreamModel: 'whisper-1',
      },
    })
    const gateway = createKioskAudioGateway({
      configKV,
      envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32) }),
      fetchImpl: vi.fn(async () => new Response('unsupported media type', { status: 415 })),
      logger: { withFields },
    })

    await expect(gateway.transcribe({
      audio: new File(['audio'], 'microphone.wav', { type: 'audio/wav' }),
      modelName: 'openai-compatible/whisper-1',
    })).rejects.toMatchObject({ errorCode: 'KIOSK_ASR_UPSTREAM_ERROR', statusCode: 503 })

    expect(withFields).toHaveBeenCalledWith({
      modelName: 'openai-compatible/whisper-1',
      responseBodySnippet: 'unsupported media type',
      status: 415,
      upstreamHost: 'asr.example.com',
      upstreamPath: '/v1/audio/transcriptions',
    })
    expect(JSON.stringify(withFields.mock.calls)).not.toContain('secret-asr-key')
    expect(warn).toHaveBeenCalledWith('Kiosk ASR upstream returned an unsuccessful response')
  })
})
