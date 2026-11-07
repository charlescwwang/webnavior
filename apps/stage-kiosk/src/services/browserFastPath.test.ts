import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { ProductConfiguration } from '@proj-airi/stage-ui/services/pbProduct'

import { describe, expect, it, vi } from 'vitest'

import { createBrowserFastPathSource } from './browserFastPath'
import { runFastPath } from './kiosk-fast-path'

const tools: ServiceTool[] = ['browser_cart_get', 'browser_observe', 'browser_product_get', 'browser_cart_add', 'browser_present'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))

const configuration: ProductConfiguration = { version: 'today-80', variantRef: '', name: '當日新菜', unitPrice: 80, groups: [] }
const product = { ref: 'p-daily-7', name: '當日新菜', price: 80, kind: 'product', priceType: 1, configurations: [configuration] }

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S13 confirmation failure.
it('delegates a pending PB answer before reading a context that could consume its one-use question', async () => {
  const read = vi.fn(async () => ({ ok: true, status: 'clarification', customerMessage: '請確認原本的選餐。' }))
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => true })
  const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const, reason: 'NEW_REQUEST' as const }))
  expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript: '對，換成雞腿便當一份。', webMcp: { tools, execute } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
  expect(read).not.toHaveBeenCalled()
  expect(decide).toHaveBeenCalledOnce()
  expect(execute).not.toHaveBeenCalled()
})

// Report: output/playwright/pb-electron/reception-fix-read-diagnostic-2.json.
it('reports missing PB cart context as a browser failure without calling or blaming Jev', async () => {
  const read = vi.fn(async () => ({ ok: false, status: 'rejected', customerMessage: 'PB cart unavailable' }))
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => false })
  const decide = vi.fn()
  expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript: '介紹菜單', webMcp: { tools, execute } })).toMatchObject({ kind: 'UNAVAILABLE', browserContextError: expect.stringContaining('PB cart unavailable') })
  expect(decide).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 read receipt refactor.
it('presents a compiled whole-menu read explicitly after internal catalog discovery', async () => {
  const read = vi.fn(async () => ({ cart: { version: 'cart' }, products: [product] }))
  const execute = vi.fn(async (tool: ServiceTool): Promise<unknown> => tool.name === 'browser_observe' ? { ok: true, source: 'browser', dataOnly: true, products: [product] } : { ok: true, source: 'browser', customerMessage: '目前查到當日新菜。' })
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => false })
  await source.context({ transcript: '看菜單' })
  expect(await source.execute({ candidateId: 'intent:search-menu' })).toMatchObject({ customerMessage: '目前查到當日新菜。' })
  expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_observe', 'browser_present'])
})
function setup(products = [product], pending = false) {
  const read = vi.fn(async (_tool: ServiceTool, _input: Record<string, unknown>) => ({ cart: { version: 'current-cart' }, products }))
  const execute = vi.fn(async (_tool: ServiceTool, _input: Record<string, unknown>) => ({ ok: true, source: 'browser', status: 'verified', customerMessage: '已完成指定操作。' }))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => pending })
  return { source, read, execute }
}

describe('pB Jev finite source', () => {
  it('calls Jev with real references and compiles one explicit addition through the shared executor', async () => {
    const { source, execute } = setup()
    const decide = vi.fn(async () => ({ kind: 'FAST_ACTION' as const, actionId: 'intent:add-item', modelCalls: 2 }))
    const result = await runFastPath({ isEnabled: async () => true, source, decide, transcript: '請幫我當日新菜兩份', webMcp: { tools, execute } })
    expect(result.kind).toBe('FAST_ACTION')
    expect(decide).toHaveBeenCalledOnce()
    expect(decide.mock.calls[0]).toMatchObject([{ decisionState: { phase: 'ordering', references: [{ label: '當日新菜', refId: 'p-daily-7' }] } }])
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]).toEqual([tools[3], { version: 'current-cart', productRef: 'p-daily-7', quantity: 2, unitPrice: 80, note: '', selection: { version: 'today-80', variantRef: '', choices: [] } }])
    expect(await source.execute({ candidateId: 'intent:add-item' })).toMatchObject({ ok: false, effect: 'none' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('reads the new daily menu instead of retaining old names or prices', async () => {
    const { source, read, execute } = setup()
    read.mockResolvedValueOnce({ cart: { version: 'tomorrow-cart' }, products: [{ ...product, ref: 'p-new-10', name: '明日新菜', price: 95, configurations: [{ ...product.configurations[0], name: '明日新菜', version: 'tomorrow-95', unitPrice: 95 }] }] })
    const context = await source.context({ transcript: '明日新菜一份' })
    expect(context).toMatchObject({ references: [{ label: '明日新菜', refId: 'p-new-10' }] })
    await source.execute({ candidateId: 'intent:add-item' })
    expect(execute.mock.calls[0][1]).toMatchObject({ productRef: 'p-new-10', unitPrice: 95, version: 'tomorrow-cart', selection: { version: 'tomorrow-95' } })
  })

  it.each(['當日新菜一份加白飯', '當日新菜兩份一份不要辣', '當日新菜一份再移除舊的', '當日新菜一份多少錢', '當日新菜一份不要了'])('does not compile a partial cart operation: %s', async (transcript) => {
    const { source, execute } = setup()
    const context = await source.context({ transcript })
    expect(context).toMatchObject({ candidates: [{ id: 'intent:search-menu' }] })
    await source.execute({ candidateId: 'intent:add-item' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('leaves same-name products and pending answers to Main without choosing the first', async () => {
    const duplicate = setup([product, { ...product, ref: 'p-other-category' }])
    expect(await duplicate.source.context({ transcript: '當日新菜一份' })).toMatchObject({ productResolution: { status: 'possible', count: 2 }, candidates: [{ id: 'intent:search-menu' }] })
    const pending = setup([product], true)
    expect(await pending.source.context({ transcript: '當日新菜一份' })).toMatchObject({ candidates: [{ id: 'intent:search-menu' }] })
  })

  it('delegates an existing question intact without issuing another direct operation', async () => {
    const { source, execute } = setup([product], true)
    const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const, reason: 'NEW_REQUEST' as const }))
    expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript: '第二個，兩份加白飯', webMcp: { tools, execute } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
    expect(decide).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()
  })

  it('never picks mandatory options, variable prices or group defaults', async () => {
    for (const entry of [
      { ...product, configurations: [{ ...product.configurations[0], groups: [{ ref: 'g-1', name: '必選', required: true, maximum: 1, choices: [{ ref: 'a-1', name: '白飯', unitPrice: 5, maximum: 1 }] }] }] },
      { ...product, priceType: 2 },
      { ...product, kind: 'group' },
    ]) {
      const { source } = setup([entry])
      expect(await source.context({ transcript: '當日新菜一份' })).toMatchObject({ candidates: [{ id: 'intent:search-menu' }] })
    }
  })

  it('hands the unchanged compound request to Main after a real Jev decision', async () => {
    const { source, execute } = setup()
    const transcript = '當日新菜一份加白飯，另外幫我看看其他餐點'
    const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const }))
    expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript, webMcp: { tools, execute } })).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    expect(decide.mock.calls[0]).toMatchObject([{ transcript }])
    expect(execute).not.toHaveBeenCalled()
  })

  it('reads an ordinary menu question through Jev and preserves a refusal from the cart gate', async () => {
    const { source, execute } = setup()
    expect(await runFastPath({ isEnabled: async () => true, source, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:search-menu' }), transcript: '目前有哪些餐點？', webMcp: { tools, execute } })).toMatchObject({ kind: 'FAST_ACTION' })
    expect(execute.mock.calls[0][0].name).toBe('browser_observe')
    execute.mockResolvedValueOnce({ ok: false, source: 'browser', status: 'rejected', customerMessage: '換客尚未確認' })
    await source.context({ transcript: '當日新菜一份' })
    expect(await source.execute({ candidateId: 'intent:add-item' })).toMatchObject({ ok: false, customerMessage: '換客尚未確認' })
  })
})

it('does not invent read-only authority when a context lookup hands a compound order to Main', async () => {
  const { source, execute } = setup()
  const result = await runFastPath({ isEnabled: async () => true, source, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:search-menu' }), transcript: '請加兩份當日新菜，每份加一份白飯', webMcp: { tools, execute } })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.decisionState?.readOnly).not.toBe(true)
  expect(execute.mock.calls[0][0].name).toBe('browser_product_get')
})

it('hands long daily multi-product requests to Main without exceeding the decision wire reference budget', async () => {
  const products = Array.from({ length: 8 }, (_, index) => ({ ...product, ref: `day-${index}`, name: `當日餐${index}` }))
  const { source } = setup(products)
  const context = await source.context({ transcript: `各一份${products.map(product => product.name).join('、')}` })
  expect(context).toMatchObject({ requiresPlanner: true, productResolution: { status: 'overflow', count: 8 } })
  expect(context).toHaveProperty('references.length', 5)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov4 pending-question admission audit.
it('still admits background speech while a PB question is pending without consuming it', async () => {
  const read = vi.fn(async () => ({}))
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => true })
  const decide = vi.fn(async () => ({ kind: 'IGNORE' as const }))
  expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript: '同伴，你要兩份還是三份？', webMcp: { tools, execute } })).toMatchObject({ kind: 'IGNORE' })
  expect(decide).toHaveBeenCalledOnce()
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ requiresPlanner: true }) }))
  expect(read).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})
