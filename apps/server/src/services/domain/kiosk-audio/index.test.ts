import { describe, expect, it, vi } from 'vitest'

import { createKioskAudioGateway } from '.'
import { createConfigKVService } from '../../adapters/config-kv'
import { createEnvelopeCrypto } from '../../../utils/envelope-crypto'

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
})
