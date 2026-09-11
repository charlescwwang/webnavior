import { describe, expect, it, vi } from 'vitest'

import { generateSpeech } from '@xsai/generate-speech'
import type { GenerateSpeechOptions } from '@xsai/generate-speech'

import { buildOpenAICompatibleProvider, normalizeOpenAICompatibleSpeechBaseUrl } from './openai-compatible-builder'

describe('buildOpenAICompatibleProvider', () => {
  /**
   * @example
   * provider.transcription('FunAudioLLM/SenseVoiceSmall', { language: 'zh' })
   */
  it('preserves transcription extra options for OpenAI-compatible ASR providers', async () => {
    const metadata = buildOpenAICompatibleProvider({
      id: 'test-openai-compatible-transcription',
      name: 'Test Transcription',
      nameKey: 'test.transcription.title',
      description: 'Test transcription provider',
      descriptionKey: 'test.transcription.description',
      icon: 'i-lobe-icons:openai',
      category: 'transcription',
      creator: () => ({
        transcription: (model: string) => ({
          baseURL: 'https://example.com/v1/',
          model,
        }),
      }),
    })

    const provider = await metadata.createProvider({})

    expect('transcription' in provider).toBe(true)
    expect((provider as any).transcription('FunAudioLLM/SenseVoiceSmall', { language: 'zh' })).toEqual({
      baseURL: 'https://example.com/v1/',
      language: 'zh',
      model: 'FunAudioLLM/SenseVoiceSmall',
    })
  })
})

describe('OpenAI-compatible speech adapter', () => {
  function createSpeechMetadata() {
    return buildOpenAICompatibleProvider({
      id: 'openai-compatible-audio-speech',
      name: 'Test Speech',
      nameKey: 'test.speech.title',
      description: 'Test OpenAI-compatible speech provider',
      descriptionKey: 'test.speech.description',
      icon: 'i-lobe-icons:openai',
      category: 'speech',
      normalizeBaseUrl: normalizeOpenAICompatibleSpeechBaseUrl,
      creator: (apiKey, baseURL) => ({
        speech: (model: string) => ({ apiKey, baseURL, model }),
      }),
    })
  }

  it.each([
    ['https://edge-tts.example.com', 'https://edge-tts.example.com/v1/'],
    ['https://edge-tts.example.com/v1/', 'https://edge-tts.example.com/v1/'],
  ])('normalizes %s to the versioned speech base URL', (input, expected) => {
    expect(normalizeOpenAICompatibleSpeechBaseUrl(input)).toBe(expected)
  })

  it('allows an anonymous compatible TTS endpoint to be configured', async () => {
    const metadata = createSpeechMetadata()

    await expect(metadata.validators.validateProviderConfig({
      apiKey: '',
      baseUrl: 'https://edge-tts.example.com',
    })).resolves.toMatchObject({ valid: true })
  })

  it('sends anonymous OpenAI-compatible speech as binary without an Authorization header', async () => {
    const metadata = createSpeechMetadata()
    const provider = await metadata.createProvider({
      apiKey: '   ',
      baseUrl: 'https://edge-tts.example.com',
    }) as { speech: (model: string, options?: Record<string, unknown>) => GenerateSpeechOptions }
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }))
    vi.stubGlobal('fetch', fetch)

    try {
      const audio = await generateSpeech({
        ...provider.speech('tts-1'),
        input: '你好，這是一段語音測試。',
        voice: 'zh-TW-HsiaoChenNeural',
      })

      expect(audio).toEqual(new Uint8Array([1, 2, 3]).buffer)
      const [url, request] = fetch.mock.calls[0]!
      expect(url.toString()).toBe('https://edge-tts.example.com/v1/audio/speech')
      expect(request?.method).toBe('POST')
      expect(new Headers(request?.headers).has('Authorization')).toBe(false)
      const requestBody = request?.body
      expect(typeof requestBody).toBe('string')
      expect(JSON.parse(requestBody as string)).toEqual({
        input: '你好，這是一段語音測試。',
        model: 'tts-1',
        response_format: 'mp3',
        speed: 1.0,
        voice: 'zh-TW-HsiaoChenNeural',
      })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the supplied bearer token for authenticated OpenAI-compatible speech', async () => {
    const metadata = createSpeechMetadata()
    const provider = await metadata.createProvider({
      apiKey: 'test-key',
      baseUrl: 'https://edge-tts.example.com/v1/',
    }) as { speech: (model: string) => GenerateSpeechOptions }
    const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(new Uint8Array([1]), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    try {
      await generateSpeech({ ...provider.speech('tts-1'), input: 'test', voice: 'voice' })
      const [, request] = fetch.mock.calls[0]!
      expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer test-key')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
