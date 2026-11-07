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
