import { describe, expect, it } from 'vitest'

import { buildResponsesRequest, translateResponsesResponse } from '../responses'

const output = [
  { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' },
  { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_cart', arguments: '{}', status: 'completed' },
]
function completed(overrides: Record<string, unknown> = {}) {
  return { id: 'resp_1', model: 'native', created_at: 10, status: 'completed', output, usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 }, ...overrides }
}
function safeEvent(event: Record<string, unknown>) {
  return `data: ${JSON.stringify(event)}\n\n`
}
function sse(events: Record<string, unknown>[]) {
  return new Response(events.map(e => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

describe('native Responses gateway', () => {
  it('converts legacy assistant calls, image inputs and explicit structured output', () => {
    const request = buildResponsesRequest({ messages: [
      { role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image_url', image_url: { url: 'https://image.example/food.png' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'checking' }], tool_calls: [{ id: 'legacy_1', function: { name: 'read_cart', arguments: '{}' } }] },
    ], max_output_tokens: 300, max_tokens: 1, response_format: { type: 'json_schema', json_schema: { name: 'receipt', schema: { type: 'object' }, strict: true } } }, 'native')
    expect(request.max_output_tokens).toBe(300)
    expect(request.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'see' }, { type: 'input_image', image_url: 'https://image.example/food.png', detail: 'auto' }] },
      { role: 'assistant', content: [{ type: 'input_text', text: 'checking' }] },
      { type: 'function_call', call_id: 'legacy_1', name: 'read_cart', arguments: '{}' },
    ])
    expect(request.text).toEqual({ format: { type: 'json_schema', name: 'receipt', schema: { type: 'object' }, strict: true } })
  })

  it('indexes parallel tool calls and emits terminal usage exactly once', async () => {
    const second = { ...output[1], call_id: 'call_2' }
    const response = await translateResponsesResponse(sse([{ type: 'response.completed', response: completed({ output: [...output, second] }) }]), true)
    const text = await response.text()
    const final = JSON.parse(text.split('\n')[0]!.slice(6))
    expect(final.choices[0].delta.tool_calls.map((call: { index: number }) => call.index)).toEqual([0, 1])
    expect(final.usage.total_tokens).toBe(16)
    expect(text.match(/\[DONE\]/g)).toHaveLength(1)
  })

  it('does not emit tools from incomplete streaming output', async () => {
    const response = await translateResponsesResponse(sse([{ type: 'response.incomplete', response: completed({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) }]), true)
    const text = await response.text()
    const final = JSON.parse(text.split('\n')[0]!.slice(6))
    expect(final.choices[0].finish_reason).toBe('length')
    expect(final.choices[0].delta.tool_calls).toBeUndefined()
  })

  it('converts messages, tools and stateless reasoning without leaking chat-only parameters', () => {
    const request = buildResponsesRequest({ stream: true, temperature: 0.1, max_tokens: 90, chat_template_kwargs: { enable_thinking: true }, messages: [
      { role: 'system', content: 'serve' },
      { role: 'user', content: 'cart' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_cart', arguments: '{}' } }], responses_output: output },
      { role: 'tool', tool_call_id: 'call_1', content: '{"total":130}' },
    ], tools: [{ type: 'function', function: { name: 'read_cart', parameters: { type: 'object', properties: {} } } }], tool_choice: { type: 'function', function: { name: 'read_cart' } } }, 'native')
    expect(request.store).toBe(false)
    expect(request.max_output_tokens).toBe(90)
    expect(request.temperature).toBeUndefined()
    expect(request.max_tokens).toBeUndefined()
    expect(request.chat_template_kwargs).toBeUndefined()
    expect(request.input).toEqual([{ role: 'system', content: 'serve' }, { role: 'user', content: 'cart' }, ...output, { type: 'function_call_output', call_id: 'call_1', output: '{"total":130}' }])
    expect(request.tools).toEqual([{ type: 'function', name: 'read_cart', parameters: { type: 'object', properties: {} }, strict: false }])
    expect(request.tool_choice).toEqual({ type: 'function', name: 'read_cart' })
    expect(request.include).toEqual(['reasoning.encrypted_content'])
  })

  it('converts native JSON calls and usage and preserves reasoning for the next round', async () => {
    const response = await translateResponsesResponse(Response.json(completed()), false)
    const data = await response.json()
    expect(data).toHaveProperty('choices.0.finish_reason', 'tool_calls')
    expect(data).toHaveProperty('choices.0.message.tool_calls.0', { id: 'call_1', type: 'function', function: { name: 'read_cart', arguments: '{}' } })
    expect(data).toHaveProperty('choices.0.message.responses_output', output)
    expect(data).toHaveProperty('usage', { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 })
  })

  it('streams text before completion but only publishes complete function arguments', async () => {
    const response = await translateResponsesResponse(sse([
      { type: 'response.created', response: { id: 'resp_1', model: 'native', created_at: 10 } },
      { type: 'response.output_text.delta', delta: '你好' },
      { type: 'response.function_call_arguments.delta', delta: '{"x":' },
      { type: 'response.output_item.done', item: output[1] },
      { type: 'response.completed', response: completed() },
    ]), true)
    const text = await response.text()
    expect(text).toContain('你好')
    expect(text).not.toContain('{\\"x\\":')
    expect(text).toContain('"tool_calls"')
    expect(text).toContain('"responses_output"')
    expect(text).toContain('[DONE]')
  })

  it.each(['failed', 'incomplete'])('does not report %s output as completed tool calls', async (status) => {
    const response = await translateResponsesResponse(Response.json(completed({ status, error: { message: 'stopped' }, incomplete_details: { reason: 'max_output_tokens' } })), false)
    const data = await response.json()
    if (status === 'failed') {
      expect(response.status).toBe(502)
      expect(data).toHaveProperty('error.message', 'stopped')
    }
    else {
      expect(data).toHaveProperty('choices.0.finish_reason', 'length')
      expect(data).not.toHaveProperty('choices.0.message.tool_calls')
    }
  })

  it('fails closed on truncated streaming output, without DONE or executable calls', async () => {
    const response = await translateResponsesResponse(sse([{ type: 'response.function_call_arguments.delta', delta: '{}' }]), true)
    const text = await response.text()
    expect(text).toContain('"error"')
    expect(text).not.toContain('[DONE]')
    expect(text).not.toContain('"tool_calls"')
  })
})

describe('responses streaming lifecycle', () => {
  it('publishes one safe progress marker before a pure tool response completes', async () => {
    const encoder = new TextEncoder()
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined
    const source = new ReadableStream<Uint8Array>({ start(controller) {
      upstream = controller
    } })
    const response = await translateResponsesResponse(new Response(source, { headers: { 'content-type': 'text/event-stream' } }), true)
    const reader = response.body!.getReader()
    upstream!.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.function_call_arguments.delta', delta: '{"secret":' })}\n\n`))
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('"responses_progress":true')
    expect(first).not.toContain('secret')
    expect(first).not.toContain('"tool_calls"')
    upstream!.enqueue(encoder.encode(safeEvent({ type: 'response.output_item.added', item: output[1] }) + safeEvent({ type: 'response.completed', response: completed() })))
    upstream!.close()
    let rest = ''
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done)
        break
      rest += new TextDecoder().decode(chunk.value)
    }
    expect(rest).not.toContain('"responses_progress":true')
    expect(rest).toContain('"tool_calls"')
  })

  it('delivers a split UTF-8 text delta before the upstream terminal event', async () => {
    const encoder = new TextEncoder()
    let upstream: ReadableStreamDefaultController<Uint8Array> | undefined
    const source = new ReadableStream<Uint8Array>({ start(controller) {
      upstream = controller
    } })
    const response = await translateResponsesResponse(new Response(source, { headers: { 'content-type': 'text/event-stream' } }), true)
    const reader = response.body!.getReader()
    const bytes = encoder.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '水餃' })}\r\n\r\n`)
    upstream!.enqueue(bytes.slice(0, bytes.length - 6))
    upstream!.enqueue(bytes.slice(bytes.length - 6))
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('水餃')
    upstream!.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.completed', response: completed({ output: [] }) })}\n\n`))
    upstream!.close()
    await reader.cancel()
  })

  it('cancels upstream and errors the reader on caller abort', async () => {
    let cancelled = false
    let released = false
    const source = new ReadableStream<Uint8Array>({ cancel() {
      cancelled = true
    } })
    const abort = new AbortController()
    const response = await translateResponsesResponse(new Response(source, { headers: { 'content-type': 'text/event-stream' } }), true, abort.signal, () => {
      released = true
    })
    const reading = response.body!.getReader().read()
    abort.abort(new Error('caller gone'))
    await expect(reading).rejects.toThrow('caller gone')
    expect(cancelled).toBe(true)
    await Promise.resolve()
    expect(released).toBe(true)
  })

  it.each(['response.failed', 'error'])('forwards %s without successful completion', async (type) => {
    const response = await translateResponsesResponse(sse([{ type, message: 'provider failed', response: { status: 'failed', error: { message: 'provider failed' } } }]), true)
    const text = await response.text()
    expect(text).toContain('provider failed')
    expect(text).not.toContain('[DONE]')
  })
})
