import { expect, it, vi } from 'vitest'

import { useWebnaviorAiControl } from './useWebnaviorAiControl'

// Report: this chat, Nov16 — fallback must persist through the same selection API
// while ordinary primary switches preserve the configured fallback.
it('sends an explicit fallback ID, preserves omitted fallback, and sends null when disabled', async () => {
  const writes: Array<{ path: string, body: unknown }> = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (init?.method === 'PUT') {
      writes.push({ path, body: JSON.parse(String(init.body)) })
      return Response.json({})
    }
    return Response.json({
      profiles: [],
      selections: [],
      systemOnePolicy: { decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null },
      systemOneProfiles: [],
    })
  })
  try {
    const control = useWebnaviorAiControl()
    await control.selectProfile('chat', 'qwen', 'openai')
    await control.selectProfile('chat', 'other-primary')
    await control.selectProfile('chat', 'qwen', null)
    expect(writes).toEqual([
      { path: '/api/admin/webnavior-ai/capabilities/chat/active-provider', body: { providerProfileId: 'qwen', fallbackProviderProfileId: 'openai' } },
      { path: '/api/admin/webnavior-ai/capabilities/chat/active-provider', body: { providerProfileId: 'other-primary' } },
      { path: '/api/admin/webnavior-ai/capabilities/chat/active-provider', body: { providerProfileId: 'qwen', fallbackProviderProfileId: null } },
    ])
    expect(control.busy.value).toBe(false)
    expect(control.error.value).toBeUndefined()
  }
  finally { fetch.mockRestore() }
})
