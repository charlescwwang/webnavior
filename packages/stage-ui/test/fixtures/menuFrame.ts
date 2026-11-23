import type { InteractionLifecycleMessage } from '@proj-airi/stage-shared/interaction-lifecycle'

import type { CheckoutSnapshot } from '../../../../apps/order-menu/src/domain/checkout-flow'

import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from '../../../../apps/order-menu/src/domain/checkout-flow'
import { menu } from '../../../../apps/order-menu/src/domain/order-machine'
import { connectInteractiveService } from '../../../../apps/order-menu/src/interactiveService'
import { createMenuToolRuntime } from '../../../../apps/order-menu/src/webmcp'

const origin = new URL(document.referrer).origin
const slow = new URL(window.location.href).searchParams.has('slow')
const hang = new URL(window.location.href).searchParams.has('hang')
const rejectAction = new URL(window.location.href).searchParams.has('reject-action')
let ready = !new URL(window.location.href).searchParams.has('phone')
let checkout: CheckoutSnapshot | undefined
let revision = 0
let payment: 'pending' | 'uncertain' | 'authorized' | undefined
function updateCheckout(next: CheckoutSnapshot) {
  checkout = next
  revision++
  return next
}
function assertCanRestart() {
  if (payment)
    throw new Error('Cannot restart while a payment is pending, authorized, or awaiting reconciliation.')
}
const runtime = createMenuToolRuntime({
  menu: Array.from({ length: 6 }, (_, index) => ({ ...menu[0]!, id: `dish-${index}`, name: index === 0 ? '水餃' : index === 1 ? '牛肉麵' : `便當${index}`, category: '便當', aliases: [], price: 80 + index * 10, optionGroups: index === 1 ? [{ id: 'spice', label: '辣度', required: true, values: [{ id: 'none', label: '不辣', priceDelta: 0 }, { id: 'hot', label: '辣', priceDelta: 0 }] }] : [] })),
  orderingReady: () => ready,
  onCustomerEntryRequested: () => ready = false,
  onCustomerEntrySkipped: () => ready = true,
  onCustomerPhoneProvided: () => ready = true,
  onAction: async (action) => {
    window.parent.postMessage({ source: 'menu-test-action', action }, origin)
    if (slow)
      await new Promise(resolve => setTimeout(resolve, 80))
    // Fault injection stays inside this disposable iframe: simulate a UI wait
    // that never completes, or a presentation failure before the cart write.
    if (hang)
      await new Promise<void>(() => {})
    if (rejectAction)
      throw new Error('Synthetic presentation failure')
  },
  onCartChange: () => {},
  onMenuSelection: () => {},
  onRecommendationsChange: () => {},
  onSessionReset: () => ready = true,
  checkout: {
    assertCanRestart,
    cancel: () => {
      assertCanRestart()
      checkout = undefined
      revision++
    },
    chooseInvoice: method => updateCheckout(chooseInvoiceMethod(checkout!, method)),
    confirmTaxId: () => updateCheckout(confirmTaxId(checkout!)),
    paymentMethods: ['linepay'],
    paymentStatus: () => payment === 'pending' || payment === 'uncertain' ? payment : undefined,
    revision: () => revision,
    requestTaxId: () => updateCheckout(requestTaxId(checkout!)),
    restart: () => {
      assertCanRestart()
      checkout = undefined
      revision++
    },
    selectPayment: async () => {
      payment = 'pending'
      revision++
      return { customerMessage: '等待模擬付款', status: 'selected' }
    },
    setTaxId: taxId => updateCheckout(setTaxIdDraft(checkout!, taxId)),
    skipMembership: () => updateCheckout(skipMembership(checkout!)),
    snapshot: () => checkout,
    start: () => updateCheckout(beginCheckout('collected')),
  },
  onOrderConfirmed: (order) => {
    window.parent.postMessage({
      source: 'airi-interaction-lifecycle',
      type: 'completed',
      orderResult: { environment: 'test', status: 'accepted', id: order.id, itemCount: order.cart.itemCount, total: order.cart.total, fulfillmentMode: order.cart.fulfillmentMode! },
    } satisfies InteractionLifecycleMessage, origin)
  },
})
// This fixture terminal is local only; no provider, payment API or POS is contacted.
window.addEventListener('message', async (event) => {
  if (event.source !== window.parent || event.origin !== origin || event.data?.source !== 'menu-test-terminal')
    return
  if (event.data.status === 'uncertain' || event.data.status === 'authorized') {
    payment = event.data.status
    revision++
    if (payment === 'authorized')
      await runtime.confirmPaidOrder('synthetic-payment')
  }
})
let disconnect: (() => void) | undefined
const connectionTimer = setTimeout(() => {
  disconnect = connectInteractiveService(runtime, origin)
}, new URL(window.location.href).searchParams.has('late') ? 900 : 0)
window.addEventListener('pagehide', () => {
  clearTimeout(connectionTimer)
  disconnect?.()
}, { once: true })
