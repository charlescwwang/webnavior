import { describe, expect, it, vi } from 'vitest'

import { verifyProviderProfile } from './verify-provider-profile'

const profile = { baseURL: 'https://models.example/v1', capability: 'chat' as const, kind: 'openai-compatible' as const, modelId: 'chat' }
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
