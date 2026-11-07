import { shallowRef, watch } from 'vue'

/**
 * Owns the unpaid payment-choice deadline and its visible remaining seconds.
 * Leaving selection (method chosen, payment locked, agent active or page gone)
 * cancels the deadline; returning to selection starts a fresh 60 seconds.
 * Browser time controls navigation only, never payment authorization.
 */
export function usePaymentSelectionCountdown(active: () => boolean, onExpire: () => void) {
  const remaining = shallowRef<number>()
  watch(active, (enabled, _, onCleanup) => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    onCleanup(() => {
      current = false
      if (timer)
        clearTimeout(timer)
    })
    remaining.value = undefined
    if (!enabled)
      return

    const deadline = Date.now() + 60_000
    const tick = () => {
      if (!current)
        return
      // Use the deadline rather than counting callbacks: hidden tabs throttle timers.
      remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000))
      if (remaining.value === 0) {
        current = false
        onExpire()
        return
      }
      timer = setTimeout(tick, 1_000)
    }
    tick()
  }, { immediate: true, flush: 'sync' })
  return remaining
}
