import type { ProductPresentation } from '@proj-airi/stage-shared/product-presentation'
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import { pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { browserPresentationInputSchema, productPresentationSchema } from '@proj-airi/stage-shared/product-presentation'
import { toOrderingTraditionalChinese } from '@proj-airi/stage-ui/libs/taiwan-traditional-chinese'
import { array, looseObject, number, optional, safeParse, string } from 'valibot'
import { shallowRef, watch } from 'vue'

/** Owns ephemeral, document-bound product evidence and segment-level speech cues. */
export function createBrowserPresentation(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'onExecution' | 'execute' | 'tools' | 'availability' | 'getDocumentId'>, visitorOwner: () => string | undefined) {
  const current = shallowRef<ProductPresentation>()
  const introducing = shallowRef(false)
  let epoch = 0
  let expiry: ReturnType<typeof setTimeout> | undefined
  let products: ProductPresentation['products'] = []
  let sequence = 0
  let latestFacts = 0
  let latestCue = 0
  let speechCues: Promise<void> = Promise.resolve()
  let preparedRecommendation: { owner: string, documentId: string, refs: string[] } | undefined
  // Only accepted native presentations count. Scope by visitor/document, not
  // the ten-second speech cue; an informational re-read must not rotate a batch.
  let recommendations: { owner: string, documentId: string, refs: string[] } | undefined
  const pending = new Map<string, { epoch: number, sequence: number, visitor?: string, recommendation: boolean, introduction: boolean }>()
  function clear() {
    epoch++
    clearTimeout(expiry)
    current.value = undefined
    introducing.value = false
    preparedRecommendation = undefined
  }
  const stop = client.onExecution((event) => {
    if (event.phase === 'called') {
      const input = safeParse(browserPresentationInputSchema, event.input)
      const introduction = event.tool.name === 'browser_present' && input.success && input.output.productRefs.length > 0 && !input.output.deferVisual
      pending.set(event.operationId, { epoch, sequence: ++sequence, visitor: visitorOwner(), recommendation: event.tool.name === 'browser_present' && input.success && input.output.mode !== 'information', introduction })
      if (introduction)
        introducing.value = true
      return
    }
    const owner = pending.get(event.operationId)
    pending.delete(event.operationId)
    if (owner?.epoch === epoch && owner.introduction)
      introducing.value = [...pending.values()].some(other => other.epoch === epoch && other.introduction)
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
    if (['browser_search', 'browser_return_menu', 'browser_close_product', 'browser_customer_reset'].includes(event.tool.name)) {
      clear()
      return
    }
    const presentation = safeParse(productPresentationSchema, result.presentation)
    // Reads and speech cues may finish in reverse order within one turn.
    // Only this document's newest issued visual result can replace its cue.
    if (!presentation.success || owner.sequence < latestCue)
      return
    latestCue = owner.sequence
    if (owner.recommendation && owner.visitor && owner.visitor === visitorOwner() && event.documentId === client.getDocumentId() && presentation.output.products.length) {
      const batch = { owner: owner.visitor, documentId: event.documentId, refs: presentation.output.products.map(product => product.ref) }
      if (presentation.output.cue === 'prepared')
        preparedRecommendation = batch
      else if (presentation.output.cue === 'shown')
        recommendations = batch
    }
    const prepared = preparedRecommendation
    if (presentation.output.cue === 'shown' && prepared && prepared.owner === visitorOwner() && prepared.documentId === event.documentId) {
      const spoken = presentation.output.products.map(product => product.ref).filter(ref => prepared.refs.includes(ref))
      if (spoken.length) {
        const alreadyShown = recommendations?.owner === prepared.owner && recommendations.documentId === prepared.documentId
          ? recommendations.refs.filter(ref => prepared.refs.includes(ref))
          : []
        recommendations = { ...prepared, refs: [...new Set([...alreadyShown, ...spoken])] }
      }
    }
    if (presentation.output.products.length && owner.sequence >= latestFacts) {
      latestFacts = owner.sequence
      const fresh = presentation.output.products
      products = [...products.filter(product => !fresh.some(next => next.ref === product.ref)), ...fresh]
    }
    if (presentation.output.cue === 'prepared')
      return
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
      recommendations = undefined
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
    introducing,
    cancel,
    shownRecommendations() {
      return recommendations && recommendations.owner === visitorOwner() && recommendations.documentId === client.getDocumentId() ? [...recommendations.refs] : []
    },
    /** Keeps model-selected new items; never substitutes an unrequested product. */
    filterRecommendations(refs: readonly string[]) {
      const visitor = visitorOwner()
      const documentId = client.getDocumentId()
      if (!visitor || !documentId)
        return
      if (recommendations && (recommendations.owner !== visitor || recommendations.documentId !== documentId))
        recommendations = undefined
      return refs.filter(ref => !recommendations?.refs.includes(ref))
    },
    /** Match only previously observed unique names, then revalidate refs in PB. */
    async speak(text: string) {
      const spokenText = toOrderingTraditionalChinese(text)
      const spokenName = (name: string) => toOrderingTraditionalChinese(pbProductName(name))
      const refs = products.filter(product => spokenText.includes(spokenName(product.name)) && products.filter(other => spokenName(other.name) === spokenName(product.name)).length === 1).sort((a, b) => spokenText.indexOf(spokenName(a.name)) - spokenText.indexOf(spokenName(b.name))).slice(0, 10).map(product => product.ref)
      const tool = client.tools.value.find(tool => tool.name === 'browser_present')
      if (!refs.length || !tool || client.availability.value !== 'ready')
        return
      const owner = epoch
      const visitor = visitorOwner()
      const documentId = client.getDocumentId()
      speechCues = speechCues.then(async () => {
        if (owner !== epoch || visitor !== visitorOwner() || documentId !== client.getDocumentId())
          return
        // Native batches retain one frame per dish and its reading dwell;
        // separate single-dish calls would drop that dwell to zero.
        await client.execute(tool, { productRefs: refs, mode: 'information', preservePage: true })
      }).catch(() => { /* Optional visual failure does not stop the customer reply. */ })
      await speechCues
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
