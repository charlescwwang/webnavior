import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import type { FastPathSource } from './kiosk-fast-path'

import { errorMessageFrom } from '@moeru/std'
import { quantityFromTranscript } from '@proj-airi/stage-shared/ordering-slots'
import { productConfigurationSchema } from '@proj-airi/stage-ui/services/pbProduct'
import { array, looseObject, number, safeParse, string } from 'valibot'

const factsSchema = looseObject({
  cart: looseObject({ version: string() }),
  products: array(looseObject({ ref: string(), name: string(), price: number(), kind: string(), priceType: number(), configurations: array(productConfigurationSchema) })),
})

/**
 * PB supplies fresh references; Jev selects only a semantic intent. This adapter
 * compiles narrow literal slots and sends the actual operation through the same
 * Host cart/session/effect validator as Main. Uncovered speech remains intact.
 */
export function createBrowserFastPathSource(io: {
  tools: readonly ServiceTool[]
  read: (tool: ServiceTool, input: Record<string, unknown>) => Promise<unknown>
  execute: (tool: ServiceTool, input: Record<string, unknown>) => Promise<unknown>
  hasPendingQuestion: () => boolean
}): FastPathSource {
  let issued: { read: Record<string, unknown>, add?: Record<string, unknown>, transcript: string, plainMenu: boolean, productRefs: string[] } | undefined
  const tool = (name: string) => {
    const found = io.tools.find(tool => tool.name === name)
    if (!found)
      throw new Error(`PB capability unavailable: ${name}`)
    return found
  }
  const execute = async (name: string, args: Record<string, unknown>) => {
    const result = await io.execute(tool(name), args)
    return { ...(result && typeof result === 'object' ? result : {}), ...(result && typeof result === 'object' && 'status' in result && result.status === 'proposal_rejected' ? { needsAssistant: true } : {}), decisionTrace: { operationPlan: { toolName: name, input: args } } }
  }
  return {
    async context(input) {
      issued = undefined
      const transcript = typeof input.transcript === 'string' ? input.transcript : ''
      const candidates = [{ id: 'intent:search-menu', description: '讀取目前 PB 菜單與實際售價，不改購物車；需要條件篩選、比較或其他操作則交接 Main。' }]
      // Admission must still run, but Main must append this utterance before
      // the bound answer resolver runs.
      // Reading through that resolver here could consume consent early, or
      // return a question receipt with no cart and mislabel it as a Jev failure.
      if (io.hasPendingQuestion())
        return { phase: 'ordering', requiresPlanner: true, candidates }
      let raw: unknown
      try {
        raw = await io.read(tool('browser_cart_get'), { includeCatalog: true })
      }
      catch (error) {
        return { contextError: errorMessageFrom(error) ?? 'PB context read failed.' }
      }
      if (raw && typeof raw === 'object' && 'customerBoundary' in raw && raw.customerBoundary === 'review-required') {
        // Private prior-customer cart data is intentionally absent. Keep only
        // service admission available; Main retains the existing handoff gate.
        return { phase: 'ordering', requiresPlanner: true, customerBoundary: 'review-required', candidates }
      }
      if (raw && typeof raw === 'object' && 'ok' in raw && raw.ok === false)
        return { contextError: 'customerMessage' in raw && typeof raw.customerMessage === 'string' ? raw.customerMessage : 'PB context read was rejected.' }
      const parsed = safeParse(factsSchema, raw)
      if (!parsed.success)
        return { contextError: parsed.issues[0].message }
      const facts = parsed.output
      const matched = facts.products.filter(product => transcript.includes(product.name))
      const references = matched.slice(0, 5).map(product => ({ label: product.name, refId: product.ref }))
      const read = matched.length === 1 ? { names: [matched[0].name] } : { includeDescriptions: true, purpose: 'information' }
      // These closed forms define compiler coverage, not language intent.
      // Every uncovered request keeps its entire text for Main after Jev's
      // service/background admission; a catalog lookup cannot authorize edits.
      const plainMenu = /^(?:請問|請|我想知道|幫我看)?(?:目前|今天|現在)?(?:有什麼|有哪些|有甚麼|菜單|看菜單|餐點有哪些|有哪些餐點|有什麼餐點|有什麼可以吃|有哪些可以點)(?:餐點|品項|可以點|可以吃)?[？?。\s]*$/.test(transcript)
      issued = { read, transcript, plainMenu, productRefs: facts.products.map(product => product.ref) }
      // A closed literal slot form is compilation coverage, not intent. Jev
      // must select purchase before this one-use compiled plan can be admitted.
      if (matched.length === 1 && !io.hasPendingQuestion()) {
        const product = matched[0]
        const remainder = transcript.replace(product.name, '').replace(/[\s，。！!、]/g, '')
        const amount = quantityFromTranscript(remainder)
        const covered = /^(?:[請要加來]|幫我|請幫我|我要|我想要|再加)?(?:要|加)?(?:[1-9]|1\d|20|[一二兩三四五六七八九十]{1,3})份(?:謝謝)?$/.test(remainder)
        const configuration = product.configurations.length === 1 ? product.configurations[0] : undefined
        if (covered && amount && product.kind === 'product' && product.priceType === 1 && configuration && !configuration.variantRef && !configuration.groups.some(group => group.required)) {
          issued.add = { version: facts.cart.version, productRef: product.ref, quantity: amount, unitPrice: configuration.unitPrice, note: '', selection: { version: configuration.version, variantRef: configuration.variantRef, choices: [] } }
          candidates.push({ id: 'intent:add-item', description: '只新增本句明確指定的單一商品與份數，保留原車；不含加購、規格、備註或其他需求。' })
        }
      }
      return { phase: 'ordering', ...(io.hasPendingQuestion() || (!issued.add && !plainMenu) ? { requiresPlanner: true } : {}), candidates, references, productResolution: { status: matched.length > 5 ? 'overflow' : matched.length === 1 ? 'exact' : matched.length ? 'possible' : 'none', count: matched.length, references }, catalogEvidence: { products: matched.slice(0, 5).map(product => ({ label: product.name, matchedText: product.name, source: 'name' })), categories: [] } }
    },
    async execute(input) {
      const current = issued
      issued = undefined // A selected candidate is one-use, even on rejection.
      if (!current)
        return { ok: false, effect: 'none', customerMessage: '菜單候選已失效，請重新確認。' }
      if (input.candidateId === 'intent:add-item' && current.add)
        return execute('browser_cart_add', current.add)
      if (input.candidateId !== 'intent:search-menu')
        return { ok: false, effect: 'none', customerMessage: '目前無法直接執行這項需求。' }
      // Read evidence can inform Main, but a partial lookup cannot pretend to
      // have answered a compound request, an option question or a comparison.
      const result = await execute('names' in current.read ? 'browser_product_get' : 'browser_observe', current.read)
      if (!current.plainMenu)
        return { ...(result && typeof result === 'object' ? result : {}), needsAssistant: true }
      if (result && typeof result === 'object' && 'ok' in result && result.ok === true)
        return execute('browser_present', { productRefs: current.productRefs.slice(0, 10) })
      return result
    },
  }
}
