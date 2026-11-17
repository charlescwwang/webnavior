import type { KioskCustomerSessionState } from '@proj-airi/stage-ui/composables/use-kiosk-customer-session'

import { readonly, shallowRef, watch } from 'vue'

/** Freshness identity for one cart check, including reception lifecycle transitions. */
export interface CartPreparationContext {
  documentId: string
  serviceUrl: string
  receptionState: KioskCustomerSessionState
}

/** Owns preparation waits and explicit read-only retries; retired reads cannot hide the current page. */
export function useKioskCartPreparation(options: {
  context: () => CartPreparationContext | undefined
  prepare: (context: CartPreparationContext, isCurrent: () => boolean) => Promise<unknown>
  onFailure?: (cause: unknown, context: CartPreparationContext) => void
}) {
  const pending = shallowRef(false)
  const failed = shallowRef(false)
  const attempt = shallowRef(0)
  let task: Promise<boolean> = Promise.resolve(false)

  watch([options.context, attempt], ([context], _previous, onCleanup) => {
    let current = true
    onCleanup(() => {
      current = false
      pending.value = false
    })
    failed.value = false
    if (!context) {
      task = Promise.resolve(false)
      return
    }
    pending.value = true
    task = (async () => {
      try {
        await options.prepare(context, () => current)
        return current
      }
      catch (cause) {
        if (current) {
          failed.value = true
          options.onFailure?.(cause, context)
        }
        return false
      }
      finally {
        if (current)
          pending.value = false
      }
    })()
  }, { immediate: true, flush: 'sync' })

  return {
    pending: readonly(pending),
    failed: readonly(failed),
    /** Retries only preparation IO; the caller must first verify that accepted operations settled. */
    retry: () => {
      attempt.value++
      return task
    },
    resetFailure: () => { failed.value = false },
  }
}
