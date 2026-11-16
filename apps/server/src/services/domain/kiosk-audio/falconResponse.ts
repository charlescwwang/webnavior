import type { InferOutput } from 'valibot'

import { array, literal, maxLength, minLength, nullish, object, optional, parse, pipe, string, unknown } from 'valibot'

const textLimit = 32_768
const bodyLimit = 1_048_576
const message = object({ content: optional(pipe(string(), maxLength(textLimit)), ''), tool_calls: optional(array(unknown())), refusal: nullish(string()) })
const choice = object({ index: optional(literal(0)), message, finish_reason: literal('stop') })
const completion = object({ choices: pipe(array(choice), minLength(1), maxLength(1)) })
const transcription = object({ text: pipe(string(), maxLength(textLimit)) })
const chunk = object({ choices: pipe(array(object({ index: optional(literal(0)), delta: message, finish_reason: nullish(literal('stop')) })), maxLength(1)) })

// Kept below the transport reader so JSON and SSE enforce the same single
// text-only choice policy; arbitrary tool/refusal content is never an ASR command.
function content(value: InferOutput<typeof message>) {
  if (value.tool_calls?.length || value.refusal)
    throw new Error('Falcon returned a tool call or refusal instead of a transcript.')
  return value.content
}

/**
 * Reads OpenAI Chat Completions text only. Deltas are display-only: the returned
 * string is available only after normal completion. Caller owns request/session
 * correlation and must supply its cancellation/timeout signal.
 */
export async function readFalconTranscript(response: Response, options: { signal?: AbortSignal, onDelta?: (delta: string) => void, responseFormat?: 'transcription-json' | 'chat-completions' } = {}): Promise<string> {
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error('Falcon transcription request failed.')
  }
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim()
  if (mime !== 'application/json' && mime !== 'text/event-stream') {
    await response.body.cancel()
    throw new Error('Falcon must return OpenAI JSON or SSE text, not audio.')
  }
  if (options.responseFormat === 'transcription-json' && mime !== 'application/json') {
    await response.body.cancel()
    throw new Error('The configured Falcon transcription response must be JSON.')
  }
  const reader = response.body.getReader()
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let buffer = ''
  let text = ''
  let stopped = false
  let done = false

  function event(raw: string) {
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
    if (!data)
      return
    if (data === '[DONE]') {
      if (!stopped)
        throw new Error('Falcon stream ended without a completed transcript.')
      done = true
      return
    }
    const rawPayload: unknown = JSON.parse(data)
    if (!rawPayload || typeof rawPayload !== 'object' || 'error' in rawPayload)
      throw new Error('Falcon stream returned an error.')
    const payload = parse(chunk, rawPayload)
    // OpenAI permits usage-only chunks with choices:[] before [DONE].
    if (!payload.choices.length)
      return
    if (stopped)
      throw new Error('Falcon returned content after its completion marker.')
    if (payload.choices.length !== 1)
      throw new Error('Falcon must return exactly one transcript choice.')
    const selected = payload.choices[0]!
    const delta = content(selected.delta)
    if (text.length + delta.length > textLimit)
      throw new Error('Falcon transcript exceeds the configured text limit.')
    text += delta
    if (delta)
      options.onDelta?.(delta)
    stopped = selected.finish_reason === 'stop'
  }

  try {
    options.signal?.throwIfAborted()
    while (!done) {
      const next = await reader.read()
      options.signal?.throwIfAborted()
      if (next.done) {
        buffer += decoder.decode()
        break
      }
      bytes += next.value.byteLength
      if (bytes > bodyLimit)
        throw new Error('Falcon response exceeds the configured body limit.')
      buffer += decoder.decode(next.value, { stream: true })
      if (mime === 'application/json')
        continue
      let separator: RegExpExecArray | null
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        event(buffer.slice(0, separator.index))
        buffer = buffer.slice(separator.index + separator[0].length)
        if (done)
          break
      }
      if (buffer.length > 65_536)
        throw new Error('Falcon SSE event exceeds the configured limit.')
    }
    if (mime === 'application/json') {
      if (options.responseFormat === 'transcription-json')
        return parse(transcription, JSON.parse(buffer)).text.trim()
      const payload = parse(completion, JSON.parse(buffer))
      return content(payload.choices[0]!.message).trim()
    }
    if (!done || !stopped)
      throw new Error('Falcon stream was interrupted before normal completion.')
    return text.trim()
  }
  finally {
    options.signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
