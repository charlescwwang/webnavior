import type { PaymentMethod } from '../pos-bridge'

import QRCode from 'qrcode'

import { errorMessageFrom } from '@moeru/std'
import { shallowRef, watch } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

/** Display identity for one unpaid simulation; the QR never contains a payment URL. */
export interface SimulationSelection {
  method: PaymentMethod
  total: string
}

/**
 * Prepares a test-only QR and completes once after five visible countdown ticks.
 * Call start after mount, inside a Vue scope. Replacing/clearing the selection
 * or disposing that scope cancels its QR work and timer. Completion requests
 * the existing simulator; it does not establish payment authorization itself.
 */
export function usePaymentSimulation(selection: () => SimulationSelection | undefined, onComplete: () => void) {
  const enabled = shallowRef(false)
  const qr = shallowRef('')
  const error = shallowRef<string>()
  const remaining = shallowRef(5)

  watch([enabled, selection], async ([running, payment], _, onCleanup) => {
    // Each method/amount selection owns its QR promise and countdown. Late
    // results from a replaced selection cannot restart its timer or complete it.
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => {
      current = false
      if (timer)
        clearTimeout(timer)
    })
    qr.value = ''
    error.value = undefined
    remaining.value = 5
    if (!running || !payment)
      return

    try {
      const image = await QRCode.toDataURL(JSON.stringify({ simulation: 'AIRI TEST ONLY - NO REAL PAYMENT', method: payment.method, total: payment.total }), { width: 240, margin: 4, errorCorrectionLevel: 'M' })
      if (!current)
        return
      qr.value = image
      // Begin only after the QR is ready. Never auto-retry after completion;
      // payment status/error changes disable selection at the owning screen.
      const tick = () => {
        if (!current)
          return
        remaining.value -= 1
        if (remaining.value === 0) {
          current = false
          onComplete()
          return
        }
        timer = setTimeout(tick, 1_000)
      }
      timer = setTimeout(tick, 1_000)
    }
    catch (cause) {
      if (current)
        error.value = errorMessageFrom(cause) ?? orderingMessages['zh-Hant'].payment.qrError
    }
  }, { immediate: true, flush: 'sync' })

  return {
    qr,
    error,
    remaining,
    start: () => { enabled.value = true },
  }
}
