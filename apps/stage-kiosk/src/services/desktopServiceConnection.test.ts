import { desktopServiceRequestSchema } from '@proj-airi/stage-shared/kiosk-desktop'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { connectDesktop } from './desktopServiceConnection'

it('accepts the surface ready binding without leaking its URL into strict native RPC', async () => {
  const invokeService = vi.fn(async (input: unknown) => parse(desktopServiceRequestSchema, input))
  // ScenarioSurface passes its ready event, whose URL belongs to placement, not RPC ownership.
  const placement = { serviceId: 'service', documentKey: 'doc', url: 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu' }
  const connection = connectDesktop({ invokeService }, placement)
  const request = { version: 1 as const, connectionId: 'connection', challenge: 'challenge' }
  await expect(connection.discover(request, new AbortController().signal)).resolves.toEqual({ serviceId: 'service', documentKey: 'doc', command: { kind: 'discover', request } })
})

it('forwards only typed envelopes scoped to its native service document', async () => {
  const invokeService = vi.fn(async () => ({ version: 1 }))
  const connection = connectDesktop({ invokeService }, { serviceId: 'service', documentKey: 'doc' })
  const request = { version: 1 as const, connectionId: 'connection', challenge: 'challenge' }
  expect(await connection.discover(request, new AbortController().signal)).toEqual({ version: 1 })
  expect(invokeService).toHaveBeenCalledExactlyOnceWith({ serviceId: 'service', documentKey: 'doc', command: { kind: 'discover', request } })
})

it('cancels the local wait without retrying an accepted native operation', async () => {
  let settle!: (value: unknown) => void
  const invokeService = vi.fn(() => new Promise(resolve => settle = resolve))
  const connection = connectDesktop({ invokeService }, { serviceId: 'service', documentKey: 'doc' })
  const signal = new AbortController()
  const waiting = connection.execute({ connectionId: 'connection', documentId: 'document', operationId: 'operation', toolsRevision: 1, name: 'browser_cart_get', input: {} }, signal.signal)
  signal.abort(new Error('wait ended'))
  await expect(waiting).rejects.toThrow('wait ended')
  settle({ ok: true })
  expect(invokeService).toHaveBeenCalledTimes(1)
  connection.dispose(new Error('document replaced'))
  expect(() => connection.discover({ version: 1, connectionId: 'new', challenge: 'new' }, new AbortController().signal)).toThrow('document replaced')
  expect(invokeService).toHaveBeenCalledTimes(1)
})

// Report: this chat; PB Start changed documents and disposal rejected its valid receipt.
it.each(['browser_start_ordering', 'browser_order_submit'])('lets an already issued %s acknowledgement settle after navigation disposes its connection', async (name) => {
  const result = Promise.withResolvers<unknown>()
  const invokeService = vi.fn(() => result.promise)
  const connection = connectDesktop({ invokeService }, { serviceId: 'pb', documentKey: 'pb:1' })
  const pending = connection.execute({ connectionId: 'connection', documentId: 'table', operationId: 'entry', toolsRevision: 1, name, input: name === 'browser_start_ordering' ? { name: 'B3 吧檯' } : { confirmationToken: 'one-use' } }, new AbortController().signal)
  connection.dispose(new Error('document replaced'))
  const acknowledgement = name === 'browser_start_ordering'
    ? { code: 'table-entry-starting', selectedTable: 'B3 吧檯' }
    : { ok: true, source: 'browser', code: 'order-submission-starting', effect: 'pending', confirmationToken: 'one-use', customerMessage: '已按下送出訂單。' }
  result.resolve({ result: acknowledgement })
  await expect(pending).resolves.toEqual({ result: acknowledgement })
  expect(invokeService).toHaveBeenCalledOnce()
  expect(() => connection.discover({ version: 1, connectionId: 'new', challenge: 'new' }, new AbortController().signal)).toThrow('document replaced')
})

it.each(['browser_start_ordering', 'browser_order_submit'])('still cancels a %s wait when the caller cancels its customer turn', async (name) => {
  const result = Promise.withResolvers<unknown>()
  const connection = connectDesktop({ invokeService: () => result.promise }, { serviceId: 'pb', documentKey: 'pb:1' })
  const controller = new AbortController()
  const pending = connection.execute({ connectionId: 'connection', documentId: 'table', operationId: 'entry', toolsRevision: 1, name, input: name === 'browser_start_ordering' ? { name: 'B3 吧檯' } : { confirmationToken: 'one-use' } }, controller.signal)
  controller.abort(new Error('customer cancelled'))
  await expect(pending).rejects.toThrow('customer cancelled')
  result.resolve({})
})
