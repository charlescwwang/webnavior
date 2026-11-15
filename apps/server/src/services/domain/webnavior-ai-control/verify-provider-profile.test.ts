import { describe, expect, it, vi } from 'vitest'

import { verifyProviderProfile } from './verify-provider-profile'

const profile = { baseURL: 'https://models.example/v1', capability: 'chat' as const, kind: 'openai-compatible' as const, modelId: 'chat', timeoutMs: 60_000 }
const completion = 'data: {"choices":[{"delta":{"content":"OK"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n'

describe('openAI-compatible response mode verification', () => {
  it.each(['auto', 'json'] as const)('retains a JSON capability probe for %s', async (responseMode) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: 'OK' } }] }))
    await verifyProviderProfile({ ...profile, responseMode }, fetchImpl)
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.stream).not.toBe(true)
    expect(body.model).toBe('chat')
  })

  it('verifies a real SSE completion when SSE is selected', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(completion, { headers: { 'Content-Type': 'text/event-stream' } }))
    await verifyProviderProfile({ ...profile, responseMode: 'sse' }, fetchImpl)
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).stream).toBe(true)
  })

  it('rejects a JSON response when the operator explicitly selected SSE', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: 'OK' } }] }))
    await expect(verifyProviderProfile({ ...profile, responseMode: 'sse' }, fetchImpl)).rejects.toThrow()
  })

  it.each([
    'data: [DONE]\n\n',
    'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
    'data: {"error":{"message":"model failed"}}\n\ndata: [DONE]\n\n',
  ])('rejects incomplete or failed SSE capability probes: %s', async (body) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
    await expect(verifyProviderProfile({ ...profile, responseMode: 'sse' }, fetchImpl)).rejects.toThrow()
  })
})

describe('native Responses profile verification', () => {
  const native = { ...profile, kind: 'openai-responses' as const }
  const result = { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }] }
  it.each(['auto', 'json', 'sse'] as const)('verifies completed Responses in %s mode without Chat Completions parameters', async (responseMode) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => responseMode === 'sse'
      ? new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: result })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      : Response.json(result))
    await verifyProviderProfile({ ...native, responseMode }, fetchImpl)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://models.example/v1/responses')
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.store).toBe(false)
    expect(body.max_output_tokens).toBe(2048)
    expect(body.input).toBe('Reply with OK.')
    expect(body.stream).toBe(responseMode === 'sse')
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('messages')
    expect(body).not.toHaveProperty('chat_template_kwargs')
  })
  it.each([1000, 60_000])('uses the configured %s ms native verification timeout', async (timeoutMs) => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      await verifyProviderProfile({ ...native, timeoutMs }, async () => Response.json(result))
      expect(timeout).toHaveBeenLastCalledWith(timeoutMs)
    }
    finally {
      timeout.mockRestore()
    }
  })
  it.each(['incomplete', 'failed', 'in_progress'])('rejects a %s JSON response', async (status) => {
    await expect(verifyProviderProfile(native, async () => Response.json({ ...result, status }))).rejects.toThrow()
  })
  it.each([
    'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
    'data: {"type":"response.failed","response":{"status":"failed"}}\n\n',
    'data: [DONE]\n\n',
    'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
  ])('rejects non-completed or empty Responses streams: %s', async (body) => {
    await expect(verifyProviderProfile({ ...native, responseMode: 'sse' }, async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))).rejects.toThrow()
  })
})
