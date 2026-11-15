import type { ChatResponseMode } from '@proj-airi/stage-shared/ai-provider'

import type { WebnaviorAiCapability, WebnaviorAiConnectionKind } from '../../../schemas/webnavior-ai'

import { createBadGatewayError, createGatewayTimeoutError, createServiceUnavailableError } from '../../../utils/error'
import { validateProviderProfile } from './profilePolicy'

const transparentPixelDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzWQAAAABJRU5ErkJggg=='

export interface ProviderProfileVerificationInput {
  baseURL: string
  capability: WebnaviorAiCapability
  kind: WebnaviorAiConnectionKind
  enableThinking?: boolean
  responseMode?: ChatResponseMode
  modelId: string
  timeoutMs: number
  plaintextKey?: string
  voice?: string
  speed?: number
}

/**
 * Performs the smallest provider operation that proves the selected model can
 * serve its assigned Kiosk capability. Catalog discovery alone is insufficient
 * because a listed model may not implement speech or vision.
 */
export async function verifyProviderProfile(input: ProviderProfileVerificationInput, fetchImpl: typeof fetch) {
  validateProviderProfile(input.capability, input)
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
      body: JSON.stringify({ input: '連線測試。', model: input.modelId, response_format: 'mp3', voice: input.voice ?? 'zh-TW-HsiaoChenNeural', ...(input.speed !== undefined ? { speed: input.speed } : {}) }),
      headers,
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    }, fetchImpl)
    if ((await response.arrayBuffer()).byteLength === 0)
      throw createBadGatewayError('TTS Provider 未回傳可播放的語音資料。')
    return
  }

  if (input.kind === 'openai-responses') {
    const stream = input.responseMode === 'sse'
    // Reasoning consumes the same output budget as visible text. Keep enough
    // room for a short answer without imposing model-specific effort settings.
    const response = await request(`${baseURL}/responses`, {
      body: JSON.stringify({ model: input.modelId, input: 'Reply with OK.', store: false, max_output_tokens: 2048, stream }),
      headers,
      method: 'POST',
      signal: AbortSignal.timeout(input.timeoutMs),
    }, fetchImpl)
    if (!stream) {
      const payload: unknown = await response.json().catch(() => null)
      if (!completedResponse(payload))
        throw createBadGatewayError('OpenAI Responses 未回傳完整的文字測試結果。')
      return
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream'))
      throw createBadGatewayError('此 Provider 未回傳 SSE，請確認支援串流或改選 JSON。')
    // Deltas and HTTP 200 do not prove completion. Responses has its own terminal
    // events; a Chat Completions [DONE] marker cannot verify this protocol.
    let completed = false
    for (const event of (await response.text()).split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data)
        continue
      let payload: { type?: string, response?: unknown }
      try {
        payload = JSON.parse(data)
      }
      catch {
        throw createBadGatewayError('OpenAI Responses 回傳無效 SSE 資料。')
      }
      if (!payload || ['error', 'response.failed', 'response.incomplete'].includes(payload.type ?? ''))
        throw createBadGatewayError('OpenAI Responses 串流測試未成功完成。')
      if (payload.type === 'response.completed') {
        if (!completedResponse(payload.response))
          throw createBadGatewayError('OpenAI Responses 未回傳完整的文字測試結果。')
        completed = true
      }
    }
    if (!completed)
      throw createBadGatewayError('OpenAI Responses 未回傳完整的 SSE 測試結果。')
    return
  }

  const content = input.capability === 'vision'
    ? [{ type: 'text', text: 'Reply with OK.' }, { type: 'image_url', image_url: { url: transparentPixelDataUrl } }]
    : 'Reply with OK.'
  const verifySse = input.capability === 'chat' && input.kind === 'openai-compatible' && input.responseMode === 'sse'
  const response = await request(`${baseURL}/chat/completions`, {
    body: JSON.stringify({ max_tokens: 4, messages: [{ content, role: 'user' }], model: input.modelId, ...(verifySse ? { stream: true } : {}), ...(input.capability === 'chat' && input.kind === 'openai-compatible'
      ? { chat_template_kwargs: { enable_thinking: input.enableThinking ?? false } }
      : {}) }),
    headers,
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  }, fetchImpl)
  if (verifySse) {
    if (!response.headers.get('content-type')?.includes('text/event-stream'))
      throw createBadGatewayError('此 Provider 未回傳 SSE，請確認支援串流或改選 JSON。')
    // The four-token probe is deliberately consumed to completion. A 200 SSE
    // header alone cannot verify a provider that fails midway or emits no choices.
    const events = (await response.text()).split(/\r?\n\r?\n/)
    let receivedChoice = false
    let completed = false
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data)
        continue
      if (data === '[DONE]') {
        completed = true
        break
      }
      let payload: { choices?: Array<{ delta?: unknown, finish_reason?: unknown }>, error?: unknown }
      try {
        payload = JSON.parse(data)
      }
      catch {
        throw createBadGatewayError('LLM Provider 回傳無效 SSE 資料。')
      }
      if (!payload || payload.error)
        throw createBadGatewayError('LLM Provider 串流測試失敗。')
      if (Array.isArray(payload.choices)) {
        receivedChoice ||= payload.choices.some(choice => choice.delta && typeof choice.delta === 'object')
        completed ||= payload.choices.some(choice => typeof choice.finish_reason === 'string')
      }
    }
    if (!receivedChoice || !completed)
      throw createBadGatewayError('LLM Provider 未回傳完整的 SSE 測試結果。')
    return
  }
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

/** Require a terminal response and usable assistant text, including after reasoning-only output. */
function completedResponse(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('status' in value) || value.status !== 'completed' || !('output' in value) || !Array.isArray(value.output))
    return false
  return value.output.some(item => item?.type === 'message' && Array.isArray(item.content)
    && item.content.some((part: { type?: unknown, text?: unknown }) => part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim().length > 0))
}
