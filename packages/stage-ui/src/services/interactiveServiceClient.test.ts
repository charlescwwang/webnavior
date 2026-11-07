import type { ServiceConnection } from '@proj-airi/stage-shared/interactive-service'

import { describe, expect, it, vi } from 'vitest'

import { createInteractiveServiceClient } from './interactiveServiceClient'

function connection(documentId = 'document') {
  const lifetime = new AbortController()
  const peer: ServiceConnection = {
    signal: lifetime.signal,
    discover: vi.fn(async request => ({ ...request, documentId, toolsRevision: 1, tools: [{ name: 'cart_get', description: '', inputSchema: { type: 'object' } }] })),
    execute: vi.fn(async request => ({ connectionId: request.connectionId, documentId, operationId: request.operationId, result: { ok: true } })),
    inspect: vi.fn(async request => ({ connectionId: request.connectionId, documentId: request.documentId, pendingCount: 0, operations: request.operationIds.map(operationId => ({ operationId, status: 'settled' })) })),
    dispose: vi.fn(reason => lifetime.abort(reason)),
  }
  return peer
}

describe('interactive service transport ownership', () => {
  it('uses native transport with the same descriptor revocation as an iframe', async () => {
    const client = createInteractiveServiceClient()
    const first = connection()
    client.activateTransport('https://service.example/menu', () => first)
    await client.waitUntilReady()
    const tool = client.tools.value[0]
    expect(await client.execute(tool, {})).toEqual({ ok: true })
    const second = connection('new-document')
    client.activateTransport('https://service.example/menu', () => second)
    await client.waitUntilReady()
    expect(first.signal.aborted).toBe(true)
    await expect(client.execute(tool, {})).rejects.toThrow('工具已失效')
    expect(second.execute).not.toHaveBeenCalled()
    expect(client.getDocumentId()).toBe('new-document')
  })

  it('inspects a lost receipt without executing it again and refuses a different document', async () => {
    const first = connection()
    first.execute = vi.fn(async () => {
      throw new Error('lost receipt')
    })
    const second = connection('replacement')
    const connect = vi.fn().mockReturnValueOnce(first).mockReturnValue(second)
    const client = createInteractiveServiceClient()
    client.activateTransport('https://service.example/menu', connect)
    await client.waitUntilReady()
    await expect(client.execute(client.tools.value[0], {})).rejects.toThrow('lost receipt')
    await expect(client.recover()).rejects.toThrow('菜單頁面已更換')
    expect(first.execute).toHaveBeenCalledTimes(1)
    expect(second.execute).not.toHaveBeenCalled()
    expect(client.availability.value).toBe('unavailable')
  })

  it('resumes only after every accepted operation is settled in the original document', async () => {
    const first = connection()
    first.execute = vi.fn(async () => {
      throw new Error('lost receipt')
    })
    const second = connection()
    const client = createInteractiveServiceClient()
    client.activateTransport('https://service.example/menu', vi.fn().mockReturnValueOnce(first).mockReturnValue(second))
    await client.waitUntilReady()
    await expect(client.execute(client.tools.value[0], {})).rejects.toThrow()
    await client.recover()
    expect(second.inspect).toHaveBeenCalledTimes(1)
    expect(second.execute).not.toHaveBeenCalled()
    expect(client.availability.value).toBe('ready')
  })
})
