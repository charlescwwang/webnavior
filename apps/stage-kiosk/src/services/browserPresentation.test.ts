import type { ServiceTool, ToolExecution } from '@proj-airi/stage-shared/interactive-service'
import type { ServiceAvailability } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, readonly, shallowRef } from 'vue'

import { createBrowserPresentation } from './browserPresentation'

const disposals: Array<() => void> = []
afterEach(() => disposals.splice(0).forEach(dispose => dispose()))
function setup() {
  const state: { owner?: string, document: string } = { owner: 'visitor', document: 'doc' }
  const listeners = new Set<(event: ToolExecution) => void>()
  const tool: ServiceTool = { name: 'browser_present', origin: 'https://app.esgpb.com', description: 'Host cue', inputSchema: { type: 'object' } }
  const availability = shallowRef<ServiceAvailability>('ready')
  const execute = vi.fn(async (_tool: ServiceTool, _input: Record<string, unknown>) => ({}))
  const presentation = createBrowserPresentation({ tools: readonly(shallowRef([tool])), availability, execute, getDocumentId: () => state.document, onExecution: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  } }, () => state.owner)
  disposals.push(presentation.dispose)
  const publish = (phase: ToolExecution['phase'], result?: unknown, operationId = 'op', name = 'browser_product_get', input: Record<string, unknown> = {}) => {
    listeners.forEach(listener => listener({ tool: { ...tool, name }, input, connectionId: 'connection', documentId: state.document, operationId, phase, result }))
  }
  return { presentation, availability, execute, tool, publish, state }
}
const products = [{ ref: 'today', name: '每日新品', price: 90 }]

// Report: this chat, Nov14; native input activity cancelled the introduction from the Host.
it('locks Host takeover only for active cues, with late-result isolation and failure cleanup', async () => {
  const { presentation, publish } = setup()
  publish('called', undefined, 'prepare', 'browser_present', { productRefs: ['today'], deferVisual: true })
  expect(presentation.introducing.value).toBe(false)
  publish('called', undefined, 'old', 'browser_present', { productRefs: ['today'] })
  expect(presentation.introducing.value).toBe(true)
  await presentation.cancel()
  expect(presentation.introducing.value).toBe(false)
  publish('called', undefined, 'new', 'browser_present', { productRefs: ['today'] })
  publish('called', undefined, 'read')
  publish('resolved', { ok: true }, 'old', 'browser_present')
  expect(presentation.introducing.value).toBe(true)
  publish('failed', undefined, 'new', 'browser_present')
  expect(presentation.introducing.value).toBe(false)
})

it('presents only validated browser evidence and uses refs for speech cues', async () => {
  const { presentation, execute, tool, publish } = setup()
  publish('called')
  publish('resolved', { ok: true, source: 'browser', products, presentation: { products, cue: 'shown' } })
  expect(presentation.current.value).toEqual({ products, cue: 'shown' })
  await presentation.speak('每日新品現在是九十元。')
  expect(execute).toHaveBeenCalledWith(tool, { productRefs: ['today'], mode: 'information' })
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

// Report: this chat, Nov12 S10; one of three "other recommendations" repeated a previously presented dish.
it.each(['recommendation', 'other-recommendations'])('tracks the last successfully shown recommendation batch, scoped to visitor and document: %s', (mode) => {
  const { presentation, publish, state } = setup()
  publish('called', undefined, 'rec', 'browser_present', { productRefs: ['today'], mode })
  publish('resolved', { ok: true, source: 'browser', presentation: { products, cue: 'shown' } }, 'rec', 'browser_present')
  expect(presentation.filterRecommendations(['today', 'other'])).toEqual(['other'])
  publish('called', undefined, 'info', 'browser_present', { productRefs: ['other'], mode: 'information' })
  publish('resolved', { ok: true, source: 'browser', presentation: { products: [{ ref: 'other', name: '其他餐', price: 10 }], cue: 'shown' } }, 'info', 'browser_present')
  expect(presentation.filterRecommendations(['today', 'other'])).toEqual(['other'])
  state.owner = 'next'
  expect(presentation.filterRecommendations(['today', 'other'])).toEqual(['today', 'other'])
})

// Report: this chat, 2026-11-14 — returning from search/recommendations left the old dish strip visible.
it.each(['browser_search', 'browser_return_menu', 'browser_close_product'])('clears stale recommendation summaries after %s', (name) => {
  const { publish, presentation } = setup()
  publish('called', undefined, 'show', 'browser_present', { productRefs: ['p'], mode: 'recommendation' })
  publish('resolved', { ok: true, source: 'browser', presentation: { cue: 'shown', products: [{ ref: 'p', name: '餐點', price: 100 }] } }, 'show', 'browser_present')
  expect(presentation.current.value?.products).toHaveLength(1)
  publish('called', undefined, 'clear', name)
  publish('resolved', { ok: true, source: 'browser' }, 'clear', name)
  expect(presentation.current.value).toBeUndefined()
})

// Report: this chat, 2026-11-14 — dish frames ran before any customer reply appeared.
it('keeps recommendations invisible until the reply, then preserves native batch dwell in mention order', async () => {
  const { presentation, publish, execute, tool } = setup()
  const batch = [{ ref: 'soup', name: '魚丸湯' }, { ref: 'rice', name: '排骨飯' }]
  publish('called', undefined, 'prepare', 'browser_present', { productRefs: ['soup', 'rice'], mode: 'recommendation', deferVisual: true })
  publish('resolved', { ok: true, source: 'browser', presentation: { products: batch, cue: 'prepared' } }, 'prepare', 'browser_present')
  expect(presentation.current.value).toBeUndefined()
  expect(execute).not.toHaveBeenCalled()
  await presentation.speak('先推薦排骨飯，再來魚丸湯。')
  expect(execute.mock.calls.map(call => call[1])).toEqual([{ productRefs: ['rice', 'soup'], mode: 'information' }])
  expect(tool.name).toBe('browser_present')
})

it('does not invent a prepared recommendation owner before a reception starts', () => {
  const { state, publish, presentation } = setup()
  state.owner = undefined
  publish('called')
  expect(() => publish('resolved', { ok: true, source: 'browser', presentation: { products, cue: 'shown' } })).not.toThrow()
  expect(presentation.shownRecommendations()).toEqual([])
})
