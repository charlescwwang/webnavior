import type { ServiceTool, ToolExecution } from '@proj-airi/stage-shared/interactive-service'
import type { ServiceAvailability } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, readonly, shallowRef } from 'vue'

import { createBrowserPresentation } from './browserPresentation'

const disposals: Array<() => void> = []
afterEach(() => disposals.splice(0).forEach(dispose => dispose()))
function setup() {
  const listeners = new Set<(event: ToolExecution) => void>()
  const tool: ServiceTool = { name: 'browser_present', origin: 'https://app.esgpb.com', description: 'Host cue', inputSchema: { type: 'object' } }
  const availability = shallowRef<ServiceAvailability>('ready')
  const execute = vi.fn(async (_tool: ServiceTool, _input: Record<string, unknown>) => ({}))
  const presentation = createBrowserPresentation({ tools: readonly(shallowRef([tool])), availability, execute, onExecution: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  } })
  disposals.push(presentation.dispose)
  const publish = (phase: ToolExecution['phase'], result?: unknown, operationId = 'op', name = 'browser_product_get') => {
    listeners.forEach(listener => listener({ tool: { ...tool, name }, input: {}, connectionId: 'connection', documentId: 'doc', operationId, phase, result }))
  }
  return { presentation, availability, execute, tool, publish }
}
const products = [{ ref: 'today', name: '每日新品', price: 90 }]

it('presents only validated browser evidence and uses refs for speech cues', async () => {
  const { presentation, execute, tool, publish } = setup()
  publish('called')
  publish('resolved', { ok: true, source: 'browser', products, presentation: { products, cue: 'shown' } })
  expect(presentation.current.value).toEqual({ products, cue: 'shown' })
  await presentation.speak('每日新品現在是九十元。')
  expect(execute).toHaveBeenCalledWith(tool, { productRefs: ['today'] })
  await presentation.speak('模型自行發明的餐點')
  expect(execute).toHaveBeenCalledOnce()
})

it('does not revive a late old-turn result after cancellation', async () => {
  const { presentation, publish } = setup()
  publish('called')
  await presentation.cancel()
  publish('resolved', { ok: true, source: 'browser', products, presentation: { products, cue: 'shown' } })
  expect(presentation.current.value).toBeUndefined()
})

it('discards product identities on service replacement and cannot speak them into another document', async () => {
  const { presentation, availability, publish, execute } = setup()
  publish('called')
  publish('resolved', { ok: true, source: 'browser', products })
  availability.value = 'loading'
  await nextTick()
  availability.value = 'ready'
  await nextTick()
  await presentation.speak('每日新品')
  expect(execute).not.toHaveBeenCalled()
})

it('keeps duplicate names out of speech targeting and rejects unverified presentation payloads', async () => {
  const { presentation, publish, execute } = setup()
  publish('called')
  publish('resolved', { ok: true, source: 'browser', products: [...products, { ...products[0], ref: 'another-category' }], presentation: { products: [{ name: '沒有識別' }], cue: 'shown' } })
  expect(presentation.current.value).toBeUndefined()
  await presentation.speak('每日新品')
  expect(execute).not.toHaveBeenCalled()
})

it('does not let an older read erase a newer cue in the same utterance', () => {
  const { presentation, publish } = setup()
  publish('called', undefined, 'older-read')
  publish('called', undefined, 'newer-cue', 'browser_present')
  publish('resolved', { ok: true, source: 'browser', presentation: { products, cue: 'shown' } }, 'newer-cue', 'browser_present')
  publish('resolved', { ok: true, source: 'browser', presentation: { products: [], cue: 'cancelled' } }, 'older-read')
  expect(presentation.current.value).toEqual({ products, cue: 'shown' })
})
