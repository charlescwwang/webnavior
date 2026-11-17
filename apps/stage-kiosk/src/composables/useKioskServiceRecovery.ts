import { useTimeoutFn } from '@vueuse/core'
import { onScopeDispose, readonly, shallowRef, watch } from 'vue'

/** Bounded reconnect/readback only. The callback must never replay a customer mutation. */
export function useKioskServiceRecovery(options: {
  blocked: () => boolean
  busy: () => boolean
  /** Reception and configured document identity; transient transport readiness is not an owner. */
  context: () => string
  recover: (isCurrent: () => boolean) => Promise<void>
}) {
  const delays = [500, 1500, 3000]
  const attempts = shallowRef(0)
  const exhausted = shallowRef(false)
  let generation = 0
  let disposed = false
  let running = false
  const timer = useTimeoutFn(async () => {
    if (disposed || !options.blocked() || options.busy() || running)
      return
    running = true
    const issued = generation
    const isCurrent = () => !disposed && issued === generation && options.blocked()
    attempts.value++
    try {
      await options.recover(isCurrent)
    }
    catch {
      // The recovery boundary reports diagnostics and preserves its block.
      // A rejected read consumes one attempt, never retries a cart operation.
    }
    finally {
      running = false
      schedule()
    }
  }, () => delays[attempts.value] ?? delays.at(-1)!, { immediate: false })

  function schedule() {
    timer.stop()
    if (disposed || !options.blocked() || options.busy() || running)
      return
    if (attempts.value >= delays.length) {
      exhausted.value = true
      return
    }
    timer.start()
  }

  watch([options.blocked, options.busy, options.context], ([blocked, _busy, context], previous) => {
    if (!blocked || context !== previous?.[2]) {
      // A late read from another reception/document cannot unlock the current
      // customer. In-flight IO may settle, but its callback loses authority.
      generation++
      attempts.value = 0
      exhausted.value = false
    }
    schedule()
  }, { immediate: true, flush: 'sync' })

  onScopeDispose(() => {
    disposed = true
    generation++
    timer.stop()
  })
  return { exhausted: readonly(exhausted) }
}
