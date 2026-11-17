import type { FalconTranscription } from '@proj-airi/stage-shared/falcon-audio'
import type { SpeechRecognitionPolicy } from '@proj-airi/stage-shared/falcon-settings'

import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'
import type { ConfigKVService } from '../../adapters/config-kv'

import { Buffer as NodeBuffer } from 'node:buffer'

import { useLogger } from '@guiiai/logg'
import { validateFalconClip } from '@proj-airi/stage-shared/falcon-audio'

import { createBadRequestError, createServiceUnavailableError } from '../../../utils/error'
import { DEFAULT_WEBNAVIOR_TTS_VOICE } from '../../adapters/config-kv'
import { readFalconTranscript } from './falconResponse'

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
  recognitionPolicy: () => Promise<SpeechRecognitionPolicy>
  transcribeFalcon: (packet: ArrayBuffer, signal: AbortSignal) => Promise<FalconTranscription>
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

  async function recognitionPolicy(): Promise<SpeechRecognitionPolicy> {
    const config = await options.configKV.get('FALCON_CONNECTION_CONFIG')
    return { mode: config.mode, maxUtteranceSeconds: config.maxUtteranceSeconds, timeoutMs: config.timeoutMs }
  }

  async function transcribeFalcon(packet: ArrayBuffer, signal: AbortSignal) {
    // Resolve again for every utterance: a late upload cannot opt itself back
    // into Falcon after an administrator has switched the system to legacy.
    const config = await options.configKV.get('FALCON_CONNECTION_CONFIG')
    if (config.mode !== 'falcon')
      throw createBadRequestError('Recognition mode changed. Reload the kiosk.', 'KIOSK_RECOGNITION_MODE_CHANGED')
    try {
      validateFalconClip(packet, config.maxUtteranceSeconds)
    }
    catch {
      throw createBadRequestError('Invalid synchronized Falcon clip.', 'KIOSK_FALCON_INVALID_CLIP')
    }
    const key = config.keyCiphertext
      ? options.envelopeCrypto.decryptKey(config.keyCiphertext, { modelName: 'webnavior-falcon', keyEntryId: 'default' })
      : undefined
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
    try {
      const response = await fetchImpl(new URL(config.path, config.baseURL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Falcon-Precision': config.precision, ...(key ? { Authorization: `Bearer ${key.toString('utf8')}` } : {}) },
        body: packet,
        signal: requestSignal,
        redirect: 'error',
      })
      // SSE is parsed here as a reserved upstream interface. Only completed
      // text is returned to the device; previews never become customer input.
      return await readFalconTranscript(response, { signal: requestSignal, responseFormat: config.responseFormat })
    }
    catch (error) {
      if (signal.aborted)
        throw error
      throw createServiceUnavailableError('Falcon did not return a complete transcript.', 'KIOSK_FALCON_UPSTREAM_ERROR')
    }
    finally {
      key?.fill(0)
    }
  }

  async function transcribe(input: { audio: File, modelName: string }) {
    const config = await resolveCapability('asr', input.modelName)
    const body = new FormData()
    body.set('file', input.audio, input.audio.name || 'recording.webm')
    body.set('model', config.upstreamModel)
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

  return { speak, transcribe, recognitionPolicy, transcribeFalcon }
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
