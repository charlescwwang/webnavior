import type { ConfigKVService } from '../../adapters/config-kv'
import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'

import { DEFAULT_WEBNAVIOR_TTS_VOICE } from '../../adapters/config-kv'
import { createBadRequestError, createServiceUnavailableError } from '../../../utils/error'

type AudioCapability = 'asr' | 'tts'

interface KioskAudioGatewayOptions {
  configKV: ConfigKVService
  envelopeCrypto: EnvelopeCrypto
  fetchImpl?: typeof fetch
}

export interface KioskAudioGateway {
  speak: (input: { locale: string, modelName: string, text: string }) => Promise<Response>
  transcribe: (input: { audio: File, modelName: string }) => Promise<string>
}

/**
 * Dispatches kiosk audio through the server's Webnavior audio configuration.
 *
 * Kiosks send only microphone bytes, text, and locale. The selected Site
 * policy is resolved by the device route; provider URL, upstream model, voice,
 * and credential remain in this server-side boundary.
 */
export function createKioskAudioGateway(options: KioskAudioGatewayOptions): KioskAudioGateway {
  const fetchImpl = options.fetchImpl ?? fetch

  async function transcribe(input: { audio: File, modelName: string }) {
    const config = await resolveCapability('asr', input.modelName)
    const body = new FormData()
    body.set('file', input.audio, input.audio.name || 'recording.webm')
    body.set('model', config.upstreamModel)
    const response = await forward(config, 'audio/transcriptions', { body, method: 'POST' })
    if (!response.ok)
      throw createServiceUnavailableError('Kiosk ASR provider did not return a successful response', 'KIOSK_ASR_UPSTREAM_ERROR')

    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || !('text' in payload) || typeof payload.text !== 'string')
      throw createServiceUnavailableError('Kiosk ASR provider response is invalid', 'KIOSK_ASR_INVALID_RESPONSE')
    return payload.text
  }

  async function speak(input: { locale: string, modelName: string, text: string }) {
    const config = await resolveCapability('tts', input.modelName)
    // This voice belongs to the Webnavior TTS connection, rather than the
    // general AIRI TTS catalog. Existing connections receive the same default
    // as newly saved ones until an administrator selects another voice.
    const voice = ('voice' in config ? config.voice : undefined) ?? DEFAULT_WEBNAVIOR_TTS_VOICE

    const response = await forward(config, 'audio/speech', {
      body: JSON.stringify({
        input: input.text,
        model: config.upstreamModel,
        voice,
        response_format: 'mp3',
        speed: 1.0,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if (!response.ok)
      throw createServiceUnavailableError('Kiosk TTS provider did not return a successful response', 'KIOSK_TTS_UPSTREAM_ERROR')
    return new Response(response.body, {
      headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'audio/mpeg' },
    })
  }

  async function resolveCapability(capability: AudioCapability, modelName: string) {
    const config = (await options.configKV.getOrThrow('WEBNAVIOR_AUDIO_CONFIG'))[capability]
    if (!config || config.modelName !== modelName)
      throw createServiceUnavailableError(`Kiosk ${capability.toUpperCase()} policy is not configured`, 'KIOSK_AUDIO_POLICY_NOT_CONFIGURED')
    return config
  }

  async function forward(
    config: { baseURL: string, keyCiphertext?: string },
    path: string,
    init: RequestInit,
  ) {
    const key = config.keyCiphertext
      ? options.envelopeCrypto.decryptKey(config.keyCiphertext, { keyEntryId: 'default', modelName: `webnavior-audio:${path.startsWith('audio/transcriptions') ? 'asr' : 'tts'}` })
      : undefined
    try {
      return await fetchImpl(endpoint(config.baseURL, path), {
        ...init,
        headers: {
          ...init.headers,
          ...(key ? { Authorization: `Bearer ${key.toString('utf8')}` } : {}),
        },
      })
    }
    finally {
      key?.fill(0)
    }
  }

  return { speak, transcribe }
}

function endpoint(baseURL: string, path: string) {
  try {
    return new URL(path, `${baseURL.replace(/\/$/, '')}/`).toString()
  }
  catch {
    throw createBadRequestError('Kiosk audio provider endpoint is invalid', 'KIOSK_AUDIO_ENDPOINT_INVALID')
  }
}
