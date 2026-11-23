import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { beginBrowserCartTask, executeBrowserReply, readBrowserOrderingFacts } from './browserCartTask'

const releases: Array<() => void> = []
afterEach(() => releases.splice(0).forEach(release => release()))

function setup() {
  const cart = { version: 'visible-cart', lines: [{ ref: 'line', name: '蛋花湯', quantity: 1 }] }
  const context: ServiceTool = { name: 'browser_cart_get', origin: 'https://app.esgpb.com', description: '', inputSchema: { type: 'object' } }
  const review = { ...context, name: 'browser_cart_review' }
  const execute = vi.fn<(tool: ServiceTool, input: Record<string, unknown>) => Promise<unknown>>(async () => ({ ok: true, source: 'browser', page: 'menu', cart, products: [] }))
  const informationUnavailable = vi.fn(() => '目前沒有這項資訊。')
  const checkoutGuidance = vi.fn((empty: boolean) => empty ? '購物車目前沒有餐點。' : '請核對目前購物車。')
  let current = true
  releases.push(beginBrowserCartTask('看購物車', { isCurrent: () => current, decide: async () => ({ choice: 'ALLOW', provider: 'main' }), informationUnavailable, checkoutGuidance }))
  return { client: { tools: readonly(shallowRef([context, review])), execute }, context, review, execute, cart, informationUnavailable, retire: () => current = false }
}

// Report: this chat, Nov20 — a local reception ID cannot identify the real operator.
it('reads the existing nonempty cart without a staff ownership handoff', async () => {
  const { client, cart } = setup()
  const facts = await readBrowserOrderingFacts(client)
  expect(facts).toMatchObject({ cart })
  expect(facts).not.toHaveProperty('customerBoundary')
})

it('does not read the cart just to allow a generic information reply', async () => {
  const { client, execute, informationUnavailable } = setup()
  expect(await executeBrowserReply(client, 'information-unavailable')).toMatchObject({ customerMessage: '目前沒有這項資訊。', effect: 'none' })
  expect(informationUnavailable).toHaveBeenCalledOnce()
  expect(execute).not.toHaveBeenCalled()
})

it('opens the visible cart directly for checkout guidance without an ownership preflight', async () => {
  const { client, execute, review } = setup()
  expect(await executeBrowserReply(client, 'checkout-guidance')).toMatchObject({ ok: true, customerMessage: '請核對目前購物車。', effect: 'none' })
  expect(execute).toHaveBeenCalledExactlyOnceWith(review, {})
})

it('still discards a late review after its request is cancelled', async () => {
  const { client, execute, retire, cart } = setup()
  execute.mockImplementation(async () => {
    retire()
    return { ok: true, source: 'browser', page: 'menu', cart }
  })
  expect(await executeBrowserReply(client, 'checkout-guidance')).toMatchObject({ ok: false, status: 'rejected', effect: 'none' })
})

it('still preserves sign-in refusal instead of treating it as an empty cart', async () => {
  const { client, execute } = setup()
  execute.mockResolvedValue({ ok: false, source: 'browser', code: 'sign-in-required', status: 'rejected', effect: 'none', error: 'PB requires manual sign-in.' })
  await expect(readBrowserOrderingFacts(client)).rejects.toThrow('購物車資料讀取未完成')
})
