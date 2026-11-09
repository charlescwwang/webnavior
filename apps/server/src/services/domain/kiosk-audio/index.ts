import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'
import type { ConfigKVService } from '../../adapters/config-kv'

import { Buffer as NodeBuffer } from 'node:buffer'

import { useLogger } from '@guiiai/logg'

import { createBadRequestError, createServiceUnavailableError } from '../../../utils/error'
import { DEFAULT_WEBNAVIOR_TTS_VOICE } from '../../adapters/config-kv'

type AudioCapability = 'asr' | 'tts'
const UPSTREAM_BODY_SNIPPET_MAX = 256

interface KioskAudioLogger {
  withFields: (fields: Record<string, unknown>) => { warn: (message: string) => void }
}

interface KioskAudioGatewayOptions {
  configKV: ConfigKVService
  envelopeCrypto: EnvelopeCrypto
  fetchImpl?: typeof fetch
  logger?: KioskAudioLogger
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
  const logger = options.logger ?? useLogger('kiosk-audio').useGlobalConfig()

  async function transcribe(input: { audio: File, modelName: string }) {
    const config = await resolveCapability('asr', input.modelName)
    const body = new FormData()
    body.set('file', input.audio, input.audio.name || 'recording.webm')
    body.set('model', config.upstreamModel)
    // ASR vocabulary context, not an instruction to replace the spoken text.
    // OpenAI-compatible prompt: https://developers.openai.com/api/docs/guides/speech-to-text
    body.set('prompt', '餐廳點餐與結帳，付款方式包含 LINE Pay、街口支付。點餐份數常用語：一份、兩份、二份、三份、四份、五份、六份、七份、八份、九份、十份、二十份；一碗、兩碗。')
    const response = await forward(config, 'audio/transcriptions', { body, method: 'POST' })
    if (!response.ok) {
      const requestUrl = new URL(endpoint(config.baseURL, 'audio/transcriptions'))
      logger.withFields({
        modelName: input.modelName,
        responseBodySnippet: await readUpstreamBodySnippet(response),
        status: response.status,
        upstreamHost: requestUrl.host,
        upstreamPath: requestUrl.pathname,
      }).warn('Kiosk ASR upstream returned an unsuccessful response')
      throw createServiceUnavailableError('Kiosk ASR provider did not return a successful response', 'KIOSK_ASR_UPSTREAM_ERROR')
    }

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
        speed: ('speed' in config ? config.speed : undefined) ?? 1,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if (!response.ok) {
      const requestUrl = new URL(endpoint(config.baseURL, 'audio/speech'))
      logger.withFields({
        modelName: input.modelName,
        status: response.status,
        upstreamHost: requestUrl.host,
        upstreamPath: requestUrl.pathname,
        responseContentType: response.headers.get('Content-Type'),
      }).warn('Kiosk TTS upstream returned an unsuccessful response')
      throw createServiceUnavailableError('Kiosk TTS provider did not return a successful response', 'KIOSK_TTS_UPSTREAM_ERROR')
    }
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

/** Reads a small diagnostic snippet without buffering an arbitrary ASR error body. */
async function readUpstreamBodySnippet(response: Response): Promise<string | undefined> {
  if (response.body == null)
    return undefined

  const reader = response.body.getReader()
  try {
    const chunks: Uint8Array[] = []
    let total = 0
    while (total < UPSTREAM_BODY_SNIPPET_MAX) {
      const { done, value } = await reader.read()
      if (done)
        break
      chunks.push(value)
      total += value.length
    }
    reader.cancel().catch(() => {})
    if (chunks.length === 0)
      return undefined
    return NodeBuffer.concat(chunks.map(chunk => NodeBuffer.from(chunk)))
      .subarray(0, UPSTREAM_BODY_SNIPPET_MAX)
      .toString('utf8')
  }
  catch {
    reader.cancel().catch(() => {})
    return undefined
  }
}
