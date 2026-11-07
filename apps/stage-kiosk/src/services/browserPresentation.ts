import type { ProductPresentation } from '@proj-airi/stage-shared/product-presentation'
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import { productPresentationSchema } from '@proj-airi/stage-shared/product-presentation'
import { array, looseObject, number, optional, safeParse, string } from 'valibot'
import { shallowRef, watch } from 'vue'

/** Owns ephemeral, document-bound product evidence and segment-level speech cues. */
export function createBrowserPresentation(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'onExecution' | 'execute' | 'tools' | 'availability'>) {
  const current = shallowRef<ProductPresentation>()
  let epoch = 0
  let expiry: ReturnType<typeof setTimeout> | undefined
  let products: ProductPresentation['products'] = []
  let sequence = 0
  let latestFacts = 0
  let latestCue = 0
  const pending = new Map<string, { epoch: number, sequence: number }>()
  function clear() {
    epoch++
    clearTimeout(expiry)
    current.value = undefined
  }
  const stop = client.onExecution((event) => {
    if (event.phase === 'called') {
      pending.set(event.operationId, { epoch, sequence: ++sequence })
      return
    }
    const owner = pending.get(event.operationId)
    pending.delete(event.operationId)
    if (event.phase !== 'resolved' || owner?.epoch !== epoch || !event.result || typeof event.result !== 'object')
      return
    const result = event.result as Record<string, unknown>
    if (result.ok !== true || result.source !== 'browser')
      return
    const facts = safeParse(array(looseObject({ ref: string(), name: string(), price: optional(number()) })), result.products)
    if (facts.success && owner.sequence >= latestFacts) {
      latestFacts = owner.sequence
      const fresh = facts.output.map(({ ref, name, price }) => ({ ref, name, ...(price === undefined ? {} : { price }) }))
      products = event.tool.name === 'browser_cart_get' ? fresh : [...products.filter(product => !fresh.some(next => next.ref === product.ref)), ...fresh]
    }
    const presentation = safeParse(productPresentationSchema, result.presentation)
    // Reads and speech cues may finish in reverse order within one turn.
    // Only this document's newest issued visual result can replace its cue.
    if (!presentation.success || owner.sequence < latestCue)
      return
    latestCue = owner.sequence
    if (presentation.output.products.length && owner.sequence >= latestFacts) {
      latestFacts = owner.sequence
      const fresh = presentation.output.products
      products = [...products.filter(product => !fresh.some(next => next.ref === product.ref)), ...fresh]
    }
    clearTimeout(expiry)
    current.value = presentation.output.products.length ? presentation.output : undefined
    expiry = setTimeout(() => {
      current.value = undefined
    }, 10000)
  })
  const stopAvailability = watch(client.availability, (value) => {
    if (value !== 'ready') {
      clear()
      products = []
    }
  })
  async function cancel() {
    clear()
    const tool = client.tools.value.find(tool => tool.name === 'browser_present')
    if (tool && client.availability.value === 'ready') {
      try {
        await client.execute(tool, { productRefs: [] })
      }
      catch { /* Visual cleanup cannot turn a settled vendor write into a retry. */ }
    }
  }
  return {
    current,
    cancel,
    /** Match only previously observed unique names, then revalidate refs in PB. */
    async speak(text: string) {
      const refs = products.filter(product => text.includes(product.name) && products.filter(other => other.name === product.name).length === 1).slice(0, 10).map(product => product.ref)
      const tool = client.tools.value.find(tool => tool.name === 'browser_present')
      if (!refs.length || !tool || client.availability.value !== 'ready')
        return
      try {
        await client.execute(tool, { productRefs: refs })
      }
      catch { /* Speech may continue when an optional product cue is unavailable. */ }
    },
    dispose() {
      clear()
      stop()
      stopAvailability()
      pending.clear()
      products = []
    },
  }
}
