import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import { pbOrderReceptionSchema } from '@proj-airi/stage-shared/pb-checkout'
import { safeParse } from 'valibot'
import { watch } from 'vue'

/** Observe PB's read-only detail page after the payment provider returns control. */
export function usePaidOrderCompletion(client: ReturnType<typeof createInteractiveServiceClient>, complete: () => void) {
  watch([client.tools, () => client.getDocumentId()], ([tools, documentId], _, onCleanup) => {
    const reader = tools.find(tool => tool.name === 'browser_state_get')
    if (!documentId || !reader || !tools.some(tool => tool.name === 'browser_reception_reset')
      || tools.some(tool => ['browser_cart_get', 'browser_payment_open'].includes(tool.name))) {
      return
    }

    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => {
      current = false
      clearTimeout(timer)
    })

    const check = async () => {
      const raw = await client.execute(reader, { includeCatalog: false }).catch(() => undefined)
      if (!current || client.getDocumentId() !== documentId || !client.tools.value.includes(reader))
        return
      const result = safeParse(pbOrderReceptionSchema, raw)
      if (!result.success || result.output.documentId !== documentId || result.output.page !== 'order-result')
        return
      const { order, restart } = result.output
      if (order.paymentStatus === 'paid' && restart === 'allowed')
        complete()
      else if (order.paymentStatus !== 'cancelled')
        timer = setTimeout(check, 5000)
    }
    void check()
  }, { immediate: true })
}
