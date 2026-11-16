/** Native Responses wire adapter; the gateway's public surface remains Chat Completions. */
type Json = Record<string, unknown>
const REPLAY_ORIGIN_TYPE = 'gateway.responses_origin'
function record(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}
function records(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(record) : []
}

/** Preserve opaque reasoning items on the assistant message across stateless tool rounds. */
export function buildResponsesRequest(body: Json, model: string, replayOrigin?: string): Json {
  const input: Json[] = []
  for (const message of records(body.messages)) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content ?? '' })
      continue
    }
    const storedOutput = records(message.responses_output)
    const origin = storedOutput.find(item => item.type === REPLAY_ORIGIN_TYPE)
    // The gateway marker travels through the existing opaque history array,
    // but never crosses an upstream API boundary. Encrypted reasoning and item
    // ids can only return to the same endpoint, model, and credential identity.
    const replay = replayOrigin === undefined || origin?.origin === replayOrigin
      ? storedOutput.filter(item => item.type !== REPLAY_ORIGIN_TYPE)
      : []
    if (message.role === 'assistant' && replay.length > 0) {
      input.push(...replay)
    }
    else if (message.content != null) {
      // Chat history is an easy input message; native output items are replayed above.
      const content = Array.isArray(message.content)
        ? records(message.content).map((part) => {
            if (part.type === 'text')
              return { type: 'input_text', text: part.text }
            if (part.type === 'image_url') {
              const image = record(part.image_url)
              return { type: 'input_image', image_url: image.url, detail: image.detail ?? 'auto' }
            }
            throw new Error(`Unsupported Responses message content: ${String(part.type)}`)
          })
        : message.content
      input.push({ role: message.role, content })
    }
    if (replay.length === 0) {
      for (const call of records(message.tool_calls)) {
        const fn = record(call.function)
        input.push({ type: 'function_call', call_id: call.id, name: fn.name, arguments: fn.arguments })
      }
    }
  }
  const result: Json = { model, input, store: false, include: ['reasoning.encrypted_content'], stream: body.stream === true }
  // Explicit whitelist: template/thinking, temperature, cache and Chat token controls never cross this boundary.
  const maxOutput = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens
  if (maxOutput !== undefined)
    result.max_output_tokens = maxOutput
  for (const key of ['parallel_tool_calls', 'reasoning', 'metadata', 'user']) {
    if (body[key] !== undefined)
      result[key] = body[key]
  }
  const format = record(body.response_format)
  if (format.type === 'json_schema')
    result.text = { format: { type: 'json_schema', ...record(format.json_schema) } }
  else if (format.type === 'json_object')
    result.text = { format: { type: 'json_object' } }
  if (Array.isArray(body.tools)) {
    result.tools = records(body.tools).map((tool) => {
      if (tool.type !== 'function')
        throw new Error('Only function tools are supported by the Responses gateway')
      const fn = record(tool.function)
      return { type: 'function', ...fn, strict: fn.strict ?? false }
    })
  }
  if (typeof body.tool_choice === 'string')
    result.tool_choice = body.tool_choice
  else if (body.tool_choice != null)
    result.tool_choice = { type: 'function', name: record(record(body.tool_choice).function).name }
  return result
}

function usage(value: unknown) {
  const raw = record(value)
  if (Object.keys(raw).length === 0)
    return undefined
  return { prompt_tokens: raw.input_tokens, completion_tokens: raw.output_tokens, total_tokens: raw.total_tokens, prompt_tokens_details: raw.input_tokens_details, completion_tokens_details: raw.output_tokens_details }
}
function outputMessage(response: Json, replayOrigin?: string) {
  const output = records(response.output)
  const content = output.filter(item => item.type === 'message').flatMap(item => records(item.content))
  const calls = response.status === 'completed' ? output.filter(item => item.type === 'function_call') : []
  return {
    role: 'assistant',
    content: content.filter(part => part.type === 'output_text').map(part => part.text).join('') || null,
    ...(content.some(part => part.type === 'refusal') ? { refusal: content.filter(part => part.type === 'refusal').map(part => part.refusal).join('') } : {}),
    ...(calls.length > 0 ? { tool_calls: calls.map(item => ({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } })) } : {}),
    // Replay the whole native output (including message item ids) in the original order.
    responses_output: replayOrigin === undefined ? output : [{ type: REPLAY_ORIGIN_TYPE, origin: replayOrigin }, ...output],
  }
}
function finishReason(response: Json) {
  if (response.status === 'incomplete')
    return record(response.incomplete_details).reason === 'max_output_tokens' ? 'length' : 'content_filter'
  return records(response.output).some(item => item.type === 'function_call') ? 'tool_calls' : 'stop'
}
function envelope(response: Json, stream: boolean) {
  return { id: response.id, object: stream ? 'chat.completion.chunk' : 'chat.completion', created: response.created_at, model: response.model }
}
function responseError(response: Json) {
  const error = record(response.error)
  return { error: { message: typeof error.message === 'string' ? error.message : `Responses upstream ended with ${String(response.status ?? 'invalid response')}`, type: 'upstream_error', code: error.code ?? 'responses_failed' } }
}

/** Read SSE across arbitrary byte/line boundaries; EOF is not successful completion. */
async function* events(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  for (;;) {
    const { value, done } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (line === '') {
        if (data.length > 0) {
          yield record(JSON.parse(data.join('\n')))
          data = []
        }
      }
      else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''))
      }
    }
    if (done)
      break
  }
}

/** Convert successful native HTTP responses; non-2xx must stay in the router's fallback policy. */
export async function translateResponsesResponse(response: Response, stream: boolean, signal?: AbortSignal, onClose?: () => void, replayOrigin?: string): Promise<Response> {
  if (!response.ok)
    return response
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const raw = record(await response.json())
    if (raw.status !== 'completed' && raw.status !== 'incomplete')
      return Response.json(responseError(raw), { status: 502 })
    if (!stream) {
      return Response.json({ ...envelope(raw, false), choices: [{ index: 0, message: outputMessage(raw, replayOrigin), finish_reason: finishReason(raw) }], usage: usage(raw.usage) })
    }
    // A JSON-only upstream may still serve a streaming caller through one complete event.
    const message = outputMessage(raw, replayOrigin)
    const delta = { ...message, ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call, index) => ({ ...call, index })) } : {}) }
    const chunk = { ...envelope(raw, true), choices: [{ index: 0, delta, finish_reason: finishReason(raw) }], usage: usage(raw.usage) }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  if (!response.body)
    throw new Error('Responses upstream has no stream body')
  const reader = response.body.getReader()
  const encoder = new TextEncoder()
  let stopped = false
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: Json) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
      const onAbort = () => {
        if (stopped)
          return
        stopped = true
        void reader.cancel(signal?.reason)
        controller.error(signal?.reason ?? new Error('Responses stream aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      let current: Json = {}
      let terminal = false
      let toolProgressSent = false
      try {
        if (signal?.aborted) {
          onAbort()
          return
        }
        for await (const event of events(reader)) {
          if (stopped)
            return
          if (event.type === 'response.created') {
            current = record(event.response)
          }
          else if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
            const key = event.type === 'response.output_text.delta' ? 'content' : 'refusal'
            send({ ...envelope(current, true), choices: [{ index: 0, delta: { [key]: event.delta }, finish_reason: null }] })
          }
          else if (event.type === 'response.function_call_arguments.delta' || (event.type === 'response.output_item.added' && record(event.item).type === 'function_call')) {
            if (!toolProgressSent) {
              // This is liveness only: no executable name, arguments, or private reasoning.
              send({ ...envelope(current, true), choices: [{ index: 0, delta: { responses_progress: true }, finish_reason: null }] })
              toolProgressSent = true
            }
          }
          else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
            current = record(event.response)
            const message = outputMessage(current, replayOrigin)
            // Text has already streamed. Calls are withheld until the response succeeds;
            // an item.done followed by failed/incomplete must never execute a partial plan.
            const { content: _content, refusal: _refusal, ...delta } = message
            const indexedDelta = { ...delta, ...(delta.tool_calls ? { tool_calls: delta.tool_calls.map((call, index) => ({ ...call, index })) } : {}) }
            send({ ...envelope(current, true), choices: [{ index: 0, delta: indexedDelta, finish_reason: finishReason(current) }], usage: usage(current.usage) })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            terminal = true
            break
          }
          else if (event.type === 'response.failed' || event.type === 'error') {
            send(responseError(event.type === 'error' ? { error: event } : record(event.response)))
            terminal = true
            break
          }
        }
        if (!terminal && !stopped)
          send(responseError({ status: 'truncated stream' }))
        if (!stopped)
          controller.close()
      }
      catch (error) {
        if (!stopped)
          controller.error(error)
      }
      finally {
        signal?.removeEventListener('abort', onAbort)
        onClose?.()
        await reader.cancel().catch(() => {})
      }
    },
    async cancel(reason) {
      stopped = true
      onClose?.()
      await reader.cancel(reason)
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}
