import type { ServiceConnection } from '@proj-airi/stage-shared/interactive-service'

import { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'
import { expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { usePaidOrderCompletion } from './usePaidOrderCompletion'

it.each([
  ['paid', 'allowed', [], 1],
  ['paid', 'operation-pending', [], 0],
  ['cancelled', 'allowed', [], 0],
  ['unknown', 'payment-unknown', [], 0],
  ['pending', 'payment-pending', ['browser_payment_open'], 0],
  ['paid', 'allowed', ['browser_cart_get'], 0],
] as const)('observes %s / %s on a document with extra controls %j', async (paymentStatus, restart, extra, expected) => {
  const scope = effectScope()
  const client = createInteractiveServiceClient()
  const complete = vi.fn()
  const execute = vi.fn<ServiceConnection['execute']>(async request => ({
    connectionId: request.connectionId,
    documentId: request.documentId,
    operationId: request.operationId,
    result: { ok: true, source: 'browser', documentId: 'test-doc', page: 'order-result', restart, order: {
      paymentStatus,
      reference: 'test-order',
      status: 50,
      total: 50,
      paymentMethods: [],
      invoice: {},
    } },
  }))
  try {
    scope.run(() => usePaidOrderCompletion(client, complete))
    client.activateTransport('https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table', () => ({
      discover: async request => ({ ...request, documentId: 'test-doc', toolsRevision: 1, tools: ['browser_state_get', 'browser_reception_reset', ...extra].map(name => ({ name, description: '', inputSchema: { type: 'object' } })) }),
      execute,
      signal: new AbortController().signal,
      dispose: vi.fn(),
      inspect: vi.fn(),
    }))
    await client.waitUntilReady()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(execute).toHaveBeenCalledTimes(extra.length ? 0 : 1)
    expect(complete).toHaveBeenCalledTimes(expected)
  }
  finally {
    scope.stop()
    client.activate()
  }
})
