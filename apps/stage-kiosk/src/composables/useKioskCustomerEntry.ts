import type { createWebMcpAdapter } from '../services/webmcp-adapter'

import { onScopeDispose, readonly, shallowRef, watch } from 'vue'

type EntryBridge = Pick<ReturnType<typeof createWebMcpAdapter>, 'availability' | 'execute' | 'onExecution' | 'tools'>

/** Projects the active service's optional entry into host UI, without retaining phone data. */
export function useKioskCustomerEntry(bridge: EntryBridge) {
  const pending = shallowRef(false)
  const busy = shallowRef(false)
  const error = shallowRef<'failed' | 'invalid'>()
  let generation = 0
  let readRevision = 0
  let disposed = false
  let supported = false
  let startedGeneration: number | undefined

  async function refresh() {
    const owner = generation
    const revision = ++readRevision
    const tool = bridge.tools.value.find(tool => tool.name === 'kiosk_interaction_state')
    if (!supported || !tool || bridge.availability.value !== 'ready')
      return
    try {
      if (startedGeneration !== owner) {
        const start = bridge.tools.value.find(tool => tool.name === 'kiosk_customer_entry_start')!
        const result = await bridge.execute(start, {})
        if (disposed || owner !== generation || revision !== readRevision)
          return
        if (result && typeof result === 'object' && 'ok' in result && result.ok === false)
          throw new Error('Entry could not be started.')
        startedGeneration = owner
      }
      const snapshot = await bridge.execute(tool, {})
      if (disposed || owner !== generation || revision !== readRevision)
        return
      if (snapshot && typeof snapshot === 'object' && 'phase' in snapshot)
        pending.value = snapshot.phase === 'customer_entry'
    }
    catch {
      if (!disposed && owner === generation && revision === readRevision)
        error.value = 'failed'
    }
  }

  watch([bridge.tools, bridge.availability], () => {
    // Discovery replaces all handles, even for a same-origin iframe reload.
    // Old reads/writes must never reopen a different visitor's entry modal.
    generation++
    pending.value = false
    busy.value = false
    error.value = undefined
    supported = ['kiosk_customer_entry_start', 'kiosk_customer_phone', 'customer_skip_phone', 'kiosk_interaction_state'].every(name => bridge.tools.value.some(tool => tool.name === name))
    if (supported && bridge.availability.value === 'ready')
      void refresh()
  }, { immediate: true, flush: 'sync' })

  const unsubscribe = bridge.onExecution((execution) => {
    if (execution.phase === 'resolved' && ['kiosk_customer_phone', 'customer_skip_phone', 'kiosk_fast_path_execute'].includes(execution.tool.name))
      void refresh()
  })

  async function submit(phone?: string) {
    if (busy.value || !pending.value)
      return
    if (phone !== undefined && !/^09\d{8}$/.test(phone)) {
      error.value = 'invalid'
      return
    }
    const owner = generation
    busy.value = true
    error.value = undefined
    try {
      // Read before each touch write. A voice skip may already have completed
      // while this click waited; never replace the identity of an entered order.
      await refresh()
      if (owner !== generation || disposed || !pending.value)
        return
      const name = phone === undefined ? 'customer_skip_phone' : 'kiosk_customer_phone'
      const tool = bridge.tools.value.find(tool => tool.name === name)
      if (!tool)
        throw new Error('Entry capability is unavailable.')
      const result = await bridge.execute(tool, phone === undefined ? { confirmedByUser: true } : { phone })
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false)
        throw new Error('Entry was not accepted.')
      await refresh()
      if (owner === generation && pending.value)
        error.value = 'failed'
    }
    catch {
      // A lost receipt is not permission to replay a write. Re-read the phase;
      // leave retry/skip available only if the service still needs entry.
      await refresh()
      if (!disposed && owner === generation && pending.value)
        error.value = 'failed'
    }
    finally {
      if (owner === generation)
        busy.value = false
    }
  }

  onScopeDispose(() => {
    disposed = true
    generation++
    unsubscribe()
  })
  return { busy: readonly(busy), error: readonly(error), pending: readonly(pending), submit }
}
