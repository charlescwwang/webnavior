import type { WebnaviorAiCapability, WebnaviorAiConnectionKind } from '../../../schemas/webnavior-ai'

import { createBadGatewayError, createGatewayTimeoutError, createServiceUnavailableError } from '../../../utils/error'

const transparentPixelDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzWQAAAABJRU5ErkJggg=='

export interface ProviderProfileVerificationInput {
  baseURL: string
  capability: WebnaviorAiCapability
  kind: WebnaviorAiConnectionKind
  enableThinking?: boolean
  modelId: string
  plaintextKey?: string
  voice?: string
}

/**
 * Performs the smallest provider operation that proves the selected model can
 * serve its assigned Kiosk capability. Catalog discovery alone is insufficient
 * because a listed model may not implement speech or vision.
 */
export async function verifyProviderProfile(input: ProviderProfileVerificationInput, fetchImpl: typeof fetch) {
  const baseURL = input.baseURL.replace(/\/+$/u, '')
  const headers = {
    'Content-Type': 'application/json',
    ...(input.plaintextKey ? { Authorization: `Bearer ${input.plaintextKey}` } : {}),
  }

  if (input.capability === 'asr') {
    const form = new FormData()
    form.set('file', new Blob([silentWav()], { type: 'audio/wav' }), 'verification.wav')
    form.set('model', input.modelId)
    const response = await request(`${baseURL}/audio/transcriptions`, {
      body: form,
      headers: input.plaintextKey ? { Authorization: `Bearer ${input.plaintextKey}` } : undefined,
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    }, fetchImpl)
    const payload = await response.json().catch(() => null)
    if (!payload || typeof payload !== 'object' || typeof (payload as { text?: unknown }).text !== 'string')
      throw createBadGatewayError('ASR Provider 未回傳可辨識的文字結果。')
    return
  }

  if (input.capability === 'tts') {
    const response = await request(`${baseURL}/audio/speech`, {
      body: JSON.stringify({ input: '連線測試。', model: input.modelId, response_format: 'mp3', voice: input.voice ?? 'zh-TW-HsiaoChenNeural' }),
      headers,
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    }, fetchImpl)
    if ((await response.arrayBuffer()).byteLength === 0)
      throw createBadGatewayError('TTS Provider 未回傳可播放的語音資料。')
    return
  }

  const content = input.capability === 'vision'
    ? [{ type: 'text', text: 'Reply with OK.' }, { type: 'image_url', image_url: { url: transparentPixelDataUrl } }]
    : 'Reply with OK.'
  const response = await request(`${baseURL}/chat/completions`, {
    body: JSON.stringify({ max_tokens: 4, messages: [{ content, role: 'user' }], model: input.modelId, ...(input.capability === 'chat' && input.kind === 'openai-compatible'
      ? { chat_template_kwargs: { enable_thinking: input.enableThinking ?? false } }
      : {}) }),
    headers,
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  }, fetchImpl)
  const payload = await response.json().catch(() => null) as { choices?: unknown } | null
  if (!Array.isArray(payload?.choices) || payload.choices.length === 0)
    throw createBadGatewayError(input.capability === 'vision' ? 'VLM Provider 未回傳視覺測試結果。' : 'LLM Provider 未回傳文字測試結果。')
}

async function request(url: string, init: RequestInit, fetchImpl: typeof fetch) {
  let response: Response
  try {
    response = await fetchImpl(url, init)
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError')
      throw createGatewayTimeoutError('Provider 驗證逾時，請確認服務位址與網路。')
    throw createServiceUnavailableError('無法連線至 Provider，請確認服務位址、網路與 API Key。', 'WEBNAVIOR_AI_PROVIDER_VERIFICATION_UNAVAILABLE')
  }
  if (!response.ok)
    throw createBadGatewayError(`Provider 驗證失敗（上游回應 ${response.status}）。`, { upstreamStatus: response.status })
  return response
}

function silentWav() {
  const bytes = new Uint8Array(44 + 320)
  const view = new DataView(bytes.buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 356, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true)
  view.setUint32(28, 32_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, 320, true)
  return bytes
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index++)
    view.setUint8(offset + index, text.charCodeAt(index))
}
