import type { ServiceConnection } from '@proj-airi/stage-shared/interactive-service'

import { describe, expect, it, vi } from 'vitest'

import { createInteractiveServiceClient } from './interactiveServiceClient'

function connection(documentId = 'document') {
  const lifetime = new AbortController()
  const peer: ServiceConnection = {
    signal: lifetime.signal,
    discover: vi.fn(async request => ({ ...request, documentId, toolsRevision: 1, tools: [{ name: 'cart_get', description: '', inputSchema: { type: 'object' } }] })),
    execute: vi.fn(async request => ({ connectionId: request.connectionId, documentId, operationId: request.operationId, result: { ok: true } })),
    inspect: vi.fn<ServiceConnection['inspect']>(async request => ({ connectionId: request.connectionId, documentId: request.documentId, pendingCount: 0, operations: request.operationIds.map(operationId => ({ operationId, status: 'settled' })) })),
    dispose: vi.fn(reason => lifetime.abort(reason)),
  }
  return peer
}

describe('interactive service transport ownership', () => {
  it('retires cart tools after a same-document submission acknowledgement without treating it as payment', async () => {
    const first = connection('cart')
    first.discover = vi.fn(async request => ({ ...request, documentId: 'cart', toolsRevision: 1, tools: [{ name: 'browser_order_submit', description: '', inputSchema: { type: 'object' } }] }))
    first.execute = vi.fn(async request => ({ connectionId: request.connectionId, documentId: request.documentId, operationId: request.operationId, result: { ok: true, source: 'browser', code: 'order-submission-starting', effect: 'pending', confirmationToken: 'once', customerMessage: '已按下送出訂單。' } }))
    const client = createInteractiveServiceClient()
    client.activateTransport('http://127.0.0.1:5188/order/store/1kgJeql/internal_use/menu/select-table', () => first)
    await client.waitUntilReady()
    const stale = client.tools.value[0]
    const resolvedBinding = vi.fn()
    client.onExecution((event) => {
      if (event.phase === 'resolved')
        resolvedBinding(client.getDocumentId())
    })
    await expect(client.execute(stale, { confirmationToken: 'once' })).resolves.toMatchObject({ effect: 'pending' })
    expect(resolvedBinding).toHaveBeenCalledWith('cart')
    expect(client.tools.value).toEqual([])
    expect(client.getDocumentId()).toBeUndefined()
    expect(client.availability.value).toBe('idle')
    expect(client.editorRetired.value).toBe(true)
    await expect(client.execute(stale, { confirmationToken: 'once' })).rejects.toThrow()
    expect(first.execute).toHaveBeenCalledOnce()
    client.activateTransport('http://127.0.0.1:5188/order/store/1kgJeql/internal_use/menu/select-table', () => connection('next-reception'))
    await client.waitUntilReady()
    expect(client.editorRetired.value).toBe(false)
  })

  // Report: this chat, Nov15: local submission changed URL before its dispatch receipt settled.
  it.each(['matching', 'replacement', 'token', 'connectionId', 'documentId', 'operationId', 'service', 'cart-write'] as const)('settles only the original submission acknowledgement after navigation: %s', async (variant) => {
    const receipt = Promise.withResolvers<void>()
    const first = connection('cart')
    const name = variant === 'cart-write' ? 'browser_cart_add' : 'browser_order_submit'
    first.discover = vi.fn(async request => ({ ...request, documentId: 'cart', toolsRevision: 1, tools: [{ name, description: '', inputSchema: { type: 'object' } }] }))
    first.execute = vi.fn(async (request) => {
      await receipt.promise
      return { connectionId: request.connectionId, documentId: request.documentId, operationId: request.operationId, ...(['connectionId', 'documentId', 'operationId'].includes(variant) ? { [variant]: 'other-operation' } : {}), result: { ok: true, source: 'browser', code: 'order-submission-starting', effect: 'pending', confirmationToken: variant === 'token' ? 'different' : 'once', customerMessage: '已按下送出訂單。' } }
    })
    const client = createInteractiveServiceClient()
    client.activateTransport('http://127.0.0.1:5188/order/store/1kgJeql/internal_use/menu/select-table', () => first)
    await client.waitUntilReady()
    const stale = client.tools.value[0]
    const pending = client.execute(stale, { confirmationToken: 'once' })
    const assertion = variant === 'matching' || variant === 'replacement' ? expect(pending).resolves.toMatchObject({ code: 'order-submission-starting', effect: 'pending' }) : expect(pending).rejects.toThrow()
    client.beginNavigation()
    if (variant === 'service' || variant === 'replacement') {
      const origin = variant === 'service' ? 'https://app.esgpb.com' : 'http://127.0.0.1:5188'
      client.activateTransport(`${origin}/order/store/1kgJeql/internal_use/menu/select-table`, () => connection('replacement'))
      await client.waitUntilReady()
    }
    receipt.resolve()
    await assertion
    expect(first.execute).toHaveBeenCalledOnce()
    await expect(client.execute(stale, {})).rejects.toThrow()
    if (variant === 'replacement') {
      expect(client.getDocumentId()).toBe('replacement')
      expect(client.tools.value).toHaveLength(1)
      expect(client.editorRetired.value).toBe(false)
    }
  })

  // Report: this chat, 2026-11-14 — a retired reception must not resume on a new ready event.
  it('cancels a menu-ready wait when its reception retires', async () => {
    const client = createInteractiveServiceClient()
    const url = 'https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table'
    client.activateTransport(url, () => connection('table'))
    await client.waitUntilReady()
    client.beginNavigation()
    const turn = new AbortController()
    const wait = client.waitUntilReady(turn.signal)
    const rejection = expect(wait).rejects.toThrow('Retired reception')
    turn.abort(new Error('Retired reception'))
    await rejection
    client.activateTransport(url, () => connection('next-reception-menu'))
    await client.waitUntilReady()
    expect(client.getDocumentId()).toBe('next-reception-menu')
  })

  // Report: this chat, 2026-11-14 — Start receipt preceded the new menu document.
  it('waits for replacement discovery after navigation rather than the retired ready promise', async () => {
    const client = createInteractiveServiceClient()
    const url = 'https://app-205-rd.esgpb.com/order/store/1kAMNok/internal_use/menu/select-table'
    client.activateTransport(url, () => connection('table'))
    await client.waitUntilReady()
    client.beginNavigation()
    const settled = vi.fn()
    const pending = client.waitUntilReady().then(settled)
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    client.activateTransport(url, () => connection('menu'))
    await pending
    expect(client.getDocumentId()).toBe('menu')
    expect(settled).toHaveBeenCalledOnce()
  })

  it('acknowledges entry while the new document is still loading without restoring old tools', async () => {
    const receipt = Promise.withResolvers<void>()
    const first = connection('table')
    first.discover = vi.fn(async request => ({ ...request, documentId: 'table', toolsRevision: 1, tools: [{ name: 'browser_start_ordering', description: '', inputSchema: { type: 'object' } }] }))
    first.execute = vi.fn(async (request) => {
      await receipt.promise
      return { connectionId: request.connectionId, documentId: request.documentId, operationId: request.operationId, result: { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable: 'B3 吧檯', customerMessage: '正在進入菜單。' } }
    })
    const client = createInteractiveServiceClient()
    client.activateTransport('https://app-205-rd.esgpb.com/order/store/1kAMNok/internal_use/menu/select-table', () => first)
    await client.waitUntilReady()
    const old = client.tools.value[0]
    const pending = client.execute(old, { name: 'B3 吧檯' })
    client.beginNavigation()
    expect(client.tools.value).toEqual([])
    expect(client.getDocumentId()).toBeUndefined()
    receipt.resolve()
    await expect(pending).resolves.toMatchObject({ code: 'table-entry-starting' })
    expect(client.availability.value).toBe('loading')
    await expect(client.execute(old, {})).rejects.toThrow('尚未連線')
    expect(first.execute).toHaveBeenCalledOnce()
  })

  // Report: this chat; successful table→menu navigation was reported as a failed Start.
  it.each([
    ['browser_start_ordering', 'B3 吧檯', true],
    ['browser_start_ordering', 'A1 桌', false],
    ['browser_cart_add', 'B3 吧檯', false],
  ] as const)('accepts only the correlated menu-entry receipt after rebind: %s / %s', async (name, selectedTable, accepted) => {
    const receipt = Promise.withResolvers<void>()
    const client = createInteractiveServiceClient()
    const url = 'https://app-205-rd.esgpb.com/order/store/1kAMNok/internal_use/menu/select-table'
    const first = connection('table')
    first.discover = vi.fn(async request => ({ ...request, documentId: 'table', toolsRevision: 1, tools: [{ name, description: '', inputSchema: { type: 'object' } }] }))
    first.execute = vi.fn(async (request) => {
      await receipt.promise
      return { connectionId: request.connectionId, documentId: request.documentId, operationId: request.operationId, result: { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable, customerMessage: '正在進入菜單。' } }
    })
    client.activateTransport(url, () => first)
    await client.waitUntilReady()
    const stale = client.tools.value[0]
    const pending = client.execute(stale, { name: 'B3 吧檯' })
    client.activate(undefined)
    const second = connection('menu')
    client.activateTransport(url, () => second)
    await client.waitUntilReady()
    const assertion = accepted ? expect(pending).resolves.toMatchObject({ code: 'table-entry-starting' }) : expect(pending).rejects.toThrow('目前頁面')
    receipt.resolve()
    await assertion
    expect(client.getDocumentId()).toBe('menu')
    expect(first.execute).toHaveBeenCalledOnce()
    expect(second.execute).not.toHaveBeenCalled()
    await expect(client.execute(stale, {})).rejects.toThrow('工具已失效')
  })

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
