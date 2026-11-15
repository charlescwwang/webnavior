import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { ProductConfiguration } from '@proj-airi/stage-shared/product-configuration'

import { describe, expect, it, vi } from 'vitest'

import { createBrowserFastPathSource } from './browserFastPath'
import { createIncompleteAsrSession, runFastPath } from './kiosk-fast-path'

const tools: ServiceTool[] = ['browser_cart_get', 'browser_observe', 'browser_product_get', 'browser_cart_add', 'browser_present'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))

const configuration: ProductConfiguration = { version: 'today-80', variantRef: '', name: '當日新菜', unitPrice: 80, groups: [] }
const question = { questionId: 'pb-question', purpose: 'browser-order-slot', question: '請問要幾份？', expiresAt: Date.now() + 120000, choices: [{ id: 'cancel', description: '取消尚未加入的餐點。' }] }
const product = { ref: 'p-daily-7', name: '當日新菜', price: 80, kind: 'product', priceType: 1, configurations: [configuration] }

// Report: this chat, Nov15: asking serving contents while checkout was offered repeated checkout.
it('lets a new informational request leave a service question without accepting or declining checkout', async () => {
  const waiting = { ...question, purpose: 'browser-service-question', question: '要結帳嗎？', choices: [{ id: 'yes', description: '打開購物車核對' }, { id: 'no', description: '繼續點餐' }] }
  const execute = vi.fn(async () => ({ ok: true, source: 'browser', needsAssistant: true }))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ cart: { version: 'cart', lines: [] }, products: [product] }), execute, hasPendingQuestion: () => true, pendingQuestion: () => waiting })
  const context = await source.context({ transcript: '一份水餃有幾顆？' })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:new-request' })]) })
  const result = await source.execute({ candidateId: 'intent:new-request' })
  expect(result).toMatchObject({ needsAssistant: true })
  expect(execute).not.toHaveBeenCalled()
})

// Report: this chat, Nov15 real Electron: 「一份幾顆？」 was handed off to a generic acknowledgement.
it('offers a semantic item-information choice for the actual cart while checkout is pending', async () => {
  const dumplings = { ...product, name: '周氏水餃(最低8顆)', price: 64 }
  const waiting = { ...question, purpose: 'browser-service-question', question: '要結帳嗎？', choices: [{ id: 'yes', description: '打開購物車核對' }, { id: 'no', description: '繼續點餐' }] }
  const raw = { cart: { version: 'cart', lines: [{ ref: '1', productRef: dumplings.ref, name: dumplings.name, quantity: 1 }] }, products: [dumplings] }
  const releaseService = vi.fn()
  const execute = vi.fn(async () => ({ ok: true, source: 'browser', dataOnly: true, products: [dumplings] }))
  const read = vi.fn(async (tool: ServiceTool) => tool.name === 'browser_product_get' ? { ok: true, source: 'browser', dataOnly: true, products: [dumplings] } : raw)
  const source = createBrowserFastPathSource({ tools, read, execute, releaseService, hasPendingQuestion: () => true, pendingQuestion: () => waiting })
  const context = await source.context({ transcript: '一份幾顆？' })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'information:p-daily-7', description: expect.stringContaining(dumplings.name) })]) })
  const result = await source.execute({ candidateId: 'information:p-daily-7' })
  expect(releaseService).not.toHaveBeenCalled()
  expect(await source.context({ transcript: '正確' })).toMatchObject({ waitingFor: waiting, candidates: expect.arrayContaining(waiting.choices) })
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_product_get' }), { names: [dumplings.name] })
  expect(execute).not.toHaveBeenCalled()
  expect(result).toMatchObject({ dataOnly: false, customerMessage: expect.stringContaining('8顆') })
  expect(result).not.toHaveProperty('needsAssistant', true)
  expect(result).not.toMatchObject({ customerMessage: expect.stringContaining('要結帳') })
})

// Report: this chat; page hints must not manufacture customer consent.
it('provides visible table facts without pretending the assistant has asked a question', async () => {
  const source = createBrowserFastPathSource({ tools, read: async () => ({ ok: true, page: 'table', tableChoices: ['櫃台取餐', 'B3 吧檯'], selectedTable: 'B3 吧檯' }), execute: async () => ({}), hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: '好' })
  expect(context).toMatchObject({ tableSelection: { selectedTable: 'B3 吧檯' } })
  expect(context).not.toHaveProperty('waitingFor')
})

it('offers a direct item read and renders current merchant facts without Main', async () => {
  const execute = vi.fn<(tool: ServiceTool, input: Record<string, unknown>) => Promise<unknown>>(async () => ({ ok: true, source: 'browser', dataOnly: true, products: [{ ...product, name: 'A套餐', description: '水餃與蛋花湯' }] }))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ cart: { version: 'cart', lines: [] }, products: [{ ...product, name: 'A套餐' }] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: 'A套餐有什麼' })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:read-item' })]) })
  const result = await source.execute({ candidateId: 'intent:read-item' })
  expect(result).toMatchObject({ ok: true, customerMessage: expect.stringContaining('水餃與蛋花湯') })
  expect(result).not.toHaveProperty('needsAssistant', true)
  expect(execute.mock.calls[0][0].name).toBe('browser_product_get')
})

// Inject malformed catalog data to test target isolation; do not use this alias
// as a legitimate restaurant setting or as a model-comparison ground truth.
it('defends an exact target against an intentionally invalid category alias', async () => {
  const currentTools = [...tools, { ...tools[0], name: 'browser_open_product' }]
  const source = createBrowserFastPathSource({ tools: currentTools, read: async () => ({ cart: { version: 'cart', lines: [] }, products: [{ ...product, ref: 'a', name: 'A套餐' }, { ...product, ref: 'b', name: 'B 套餐' }] }), catalogLabels: () => [{ name: 'B 套餐', aliases: ['套餐'], category: '' }], execute: async () => ({}), hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: '看A套餐' })
  expect(context).toMatchObject({ productResolution: { status: 'exact', count: 1 }, candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:select-item', description: expect.stringContaining('A套餐') })]) })
})

it('offers Jev a complete dumpling purchase with pieces separate from servings', async () => {
  const dumplings = { ...product, name: '周氏水餃(最低8顆)', price: 64, configurations: [{ ...configuration, unitPrice: 64, groups: [{ ref: 'extra', name: '加量', required: false, maximum: 100, choices: [{ ref: 'dumpling', name: '水餃', maximum: 100, unitPrice: 8 }] }] }] }
  const execute = vi.fn(async () => ({ status: 'verified' }))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ cart: { version: 'cart', lines: [] }, products: [dumplings] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const decide = vi.fn(async () => ({ kind: 'FAST_ACTION' as const, actionId: 'intent:add-item', confidence: 0.95 }))
  const result = await runFastPath({ isEnabled: async () => true, source, decide, transcript: '周氏水餃(最低8顆)十顆兩份', webMcp: { tools, execute } })
  expect(result.kind).toBe('FAST_ACTION')
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 2, unitPrice: 80, selection: { version: configuration.version, variantRef: '', choices: [{ ref: 'dumpling', quantity: 2 }] } }))
})

// Report: this chat, Nov12; after rejecting A4, Jev ignored the correction
// 「A3」 because the table page was described as ordering with no live question.
it('carries visible table state through the decision wire without inventing a spoken question', async () => {
  const read = vi.fn(async () => ({ ok: true, page: 'table', tableChoices: ['櫃台取餐', 'A3 桌'], selectedTable: 'A3 桌' }))
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const, reason: 'NEW_REQUEST' as const }))
  await runFastPath({ isEnabled: async () => true, source, decide, transcript: 'A3', webMcp: { tools, execute } })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ phase: 'selecting_table', tableSelection: { choices: ['櫃台取餐', 'A3 桌'], selectedTable: 'A3 桌' } }) }))
  expect(execute).not.toHaveBeenCalled()
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S13 confirmation failure.
it('supplies Jev with a fresh pending question without consuming its one-use answer', async () => {
  const read = vi.fn(async () => ({ ok: true, status: 'clarification', customerMessage: '請確認原本的選餐。' }))
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => true, pendingQuestion: () => question })
  const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const, reason: 'NEW_REQUEST' as const }))
  expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript: '對，換成雞腿便當一份。', webMcp: { tools, execute } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST' })
  expect(read).toHaveBeenCalledOnce()
  expect(decide).toHaveBeenCalledOnce()
  expect(decide.mock.calls[0]).toMatchObject([{ decisionState: { waitingFor: question } }])
  expect(execute).not.toHaveBeenCalled()
})

// Report: output/playwright/pb-electron/reception-fix-read-diagnostic-2.json.
it('reports missing PB cart context as a browser failure without calling or blaming Jev', async () => {
  const read = vi.fn(async () => ({ ok: false, status: 'rejected', customerMessage: 'PB cart unavailable' }))
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const decide = vi.fn()
  expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript: '介紹菜單', webMcp: { tools, execute } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', browserContextError: expect.stringContaining('PB cart unavailable') })
  expect(decide).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 read receipt refactor.
it('presents a compiled whole-menu read explicitly after internal catalog discovery', async () => {
  const read = vi.fn(async () => ({ cart: { version: 'cart' }, products: [product] }))
  const execute = vi.fn(async (tool: ServiceTool): Promise<unknown> => tool.name === 'browser_observe' ? { ok: true, source: 'browser', dataOnly: true, products: [product] } : { ok: true, source: 'browser', customerMessage: '目前查到當日新菜。' })
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  await source.context({ transcript: '看菜單' })
  expect(await source.execute({ candidateId: 'intent:search-menu' })).toMatchObject({ customerMessage: '目前查到當日新菜。' })
  expect(execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_observe', 'browser_present'])
})
function setup(products = [product], pending = false) {
  const read = vi.fn(async (_tool: ServiceTool, _input: Record<string, unknown>) => ({ cart: { version: 'current-cart' }, products }))
  const execute = vi.fn(async (_tool: ServiceTool, _input: Record<string, unknown>): Promise<unknown> => ({ ok: true, source: 'browser', status: 'verified', customerMessage: '已完成指定操作。' }))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => pending, pendingQuestion: () => pending ? question : undefined })
  return { source, read, execute }
}

describe('pB Jev finite source', () => {
  // Adapted from master's merchant-alias ambiguity cases: labels are not write authority.
  it('compiles a unique configured alias while preserving alias evidence for admission', async () => {
    const read = vi.fn(async () => ({ cart: { version: 'cart' }, products: [product] }))
    const execute = vi.fn(async () => ({}))
    const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined, catalogLabels: () => [{ name: product.name, aliases: ['店家招牌'], category: '套餐' }] })
    expect(await source.context({ transcript: '店家招牌一份' })).toMatchObject({ references: [{ label: product.name, refId: product.ref }], catalogEvidence: { products: [{ label: product.name, matchedText: '店家招牌', source: 'alias' }] } })
    await source.execute({ candidateId: 'intent:add-item' })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ productRef: product.ref, quantity: 1 }))
  })
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
    expect(context).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]) })
    await source.execute({ candidateId: 'intent:add-item' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('leaves same-name products and pending answers to Main without choosing the first', async () => {
    const duplicate = setup([product, { ...product, ref: 'p-other-category' }])
    expect(await duplicate.source.context({ transcript: '當日新菜一份' })).toMatchObject({ productResolution: { status: 'possible', count: 2 }, candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]) })
    const pending = setup([product], true)
    expect(await pending.source.context({ transcript: '當日新菜一份' })).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]) })
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
      expect(await source.context({ transcript: '當日新菜一份' })).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]) })
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
  expect(context).toMatchObject({ productResolution: { status: 'overflow', count: 8 } })
  expect(context).toHaveProperty('references.length', 5)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov4 pending-question admission audit.
it('still admits background speech while a PB question is pending without consuming it', async () => {
  const read = vi.fn(async () => ({}))
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => true, pendingQuestion: () => question })
  const decide = vi.fn(async () => ({ kind: 'IGNORE' as const }))
  expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript: '同伴，你要兩份還是三份？', webMcp: { tools, execute } })).toMatchObject({ kind: 'IGNORE' })
  expect(decide).toHaveBeenCalledOnce()
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ waitingFor: question }) }))
  expect(read).toHaveBeenCalledOnce()
  expect(execute).not.toHaveBeenCalled()
})

it('compiles a quantity before the item name instead of requiring one fixed sentence order', async () => {
  const { source, execute } = setup()
  expect(await source.context({ transcript: '給我兩份當日新菜' })).not.toHaveProperty('requiresPlanner', true)
  await source.execute({ candidateId: 'intent:add-item' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 2 }))
})
it('offers a bound quantity answer to Jev without consuming it during context preparation', async () => {
  const read = vi.fn(async () => ({ cart: { version: 'cart' }, products: [product] }))
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => true, pendingQuestion: () => question, canAnswerLocally: () => true })
  expect(await source.context({ transcript: '兩份' })).toMatchObject({ candidates: [{ id: 'answer:current' }] })
  expect(execute).not.toHaveBeenCalled()
  await source.execute({ candidateId: 'answer:current' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_answer_question' }), {})
})
it('randomly presents real distinct items without adding or inventing a popularity ranking', async () => {
  const products = Array.from({ length: 5 }, (_, index) => ({ ...product, ref: `product-${index}`, name: `餐點${index}` }))
  const { source, execute } = setup(products)
  expect(await source.context({ transcript: '推薦三樣' })).toMatchObject({ candidates: expect.arrayContaining([{ id: 'intent:recommend', description: expect.any(String) }]) })
  await source.execute({ candidateId: 'intent:recommend' })
  const [tool, input] = execute.mock.calls[0]
  expect(tool.name).toBe('browser_present')
  expect(input.mode).toBe('recommendation')
  expect(input.productRefs).toHaveLength(3)
  expect(new Set(input.productRefs as string[]).size).toBe(3)
  expect((input.productRefs as string[]).every(ref => products.some(product => product.ref === ref))).toBe(true)
})

// Report: this chat, Nov15; local Jev selected a random batch despite two explicit chicken names.
it.each(['請推薦炸雞腿便當和港式油雞腿便當給我選', '雞腿'])('offers only the observed named/fragment matches for presentation: %s', async (transcript) => {
  const chicken = [{ ...product, ref: 'fried', name: '炸雞腿便當' }, { ...product, ref: 'oil', name: '港式油雞腿便當' }]
  const { source, execute } = setup([...chicken, product])
  const context = await source.context({ transcript })
  expect(context).toMatchObject({ productResolution: { status: 'possible', count: 2, references: [{ label: chicken[0].name, refId: 'fried' }, { label: chicken[1].name, refId: 'oil' }] } })
  if (transcript === '雞腿')
    expect(context).toMatchObject({ catalogEvidence: { products: chicken.map(item => ({ label: item.name, matchedText: '雞腿', source: 'fragment' })) } })
  await source.execute({ candidateId: 'intent:recommend' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_present' }), { mode: 'recommendation', productRefs: ['fried', 'oil'] })
})

it('does not silently truncate a named presentation beyond the finite batch limit', async () => {
  const items = Array.from({ length: 4 }, (_, index) => ({ ...product, ref: `chicken-${index}`, name: `雞腿餐${index}` }))
  const { source, execute } = setup(items)
  expect(await source.context({ transcript: items.map(item => item.name).join('和') })).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:recommend' })]) })
  expect(execute).not.toHaveBeenCalled()
})

// Report: current redesign review; an exhausted recommendation set must not clear the screen.
it('does not offer an empty other-recommendations batch or remove normal recommendations', async () => {
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ cart: { version: 'cart' }, products: [product] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined, shownRecommendations: () => [product.ref], previousRecommendations: () => [] })
  const context = await source.context({ transcript: '還有其他推薦嗎' })
  expect(context).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:recommend-other' })]) })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:recommend' })]) })
  expect(execute).not.toHaveBeenCalled()
})

// Report: this chat, Nov15; a named search was narrowed by unconditional recommendation-history exclusion.
it('lets Jev choose ordinary versus other recommendations using distinct issued effects', async () => {
  const other = { ...product, ref: 'other', name: '另一道餐點' }
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ cart: { version: 'cart' }, products: [product, other] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined, shownRecommendations: () => [product.ref], previousRecommendations: refs => refs.filter(ref => ref !== product.ref) })
  const context = await source.context({ transcript: '換其他推薦' })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:recommend' }), expect.objectContaining({ id: 'intent:recommend-other' })]) })
  await source.execute({ candidateId: 'intent:recommend-other' })
  expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'browser_present' }), { mode: 'other-recommendations', productRefs: [other.ref] })
  await source.context({ transcript: '推薦一下' })
  await source.execute({ candidateId: 'intent:recommend' })
  expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'browser_present' }), { mode: 'recommendation', productRefs: expect.arrayContaining([product.ref, other.ref]) })
})

it('compiles every explicit no-option item in a small batch and hands incomplete batches to Main', async () => {
  const products = [product, { ...product, ref: 'soup', name: '蛋花湯' }]
  const { source, execute } = setup(products)
  expect(await source.context({ transcript: '當日新菜兩份、蛋花湯一份' })).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:add-items' })]) })
  await source.execute({ candidateId: 'intent:add-items' })
  expect(execute).toHaveBeenCalledOnce()
  expect(execute.mock.calls[0]).toEqual([expect.objectContaining({ name: 'browser_add_items' }), { items: [{ name: product.name, quantity: 2 }, { name: '蛋花湯', quantity: 1 }] }])
  expect(await source.context({ transcript: '當日新菜兩份、蛋花湯' })).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-items' })]) })
})
it('replays only an actually shown batch as information', async () => {
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ cart: { version: 'cart' }, products: [product] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined, shownRecommendations: () => [product.ref, 'removed'] })
  expect(await source.context({ transcript: '再看一次' })).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:show-recommendations' })]) })
  await source.execute({ candidateId: 'intent:show-recommendations' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_present' }), { mode: 'information', productRefs: [product.ref] })
})

// Report: this chat, 2026-11-14 — B3 吧檯 and takeaway must map to current real choices.
it.each(['b3', 'b3 吧檯', '我要外帶', '我要自取', 'B3，還要排骨便當一份'])('offers real table targets to Jev without executing: %s', async (text) => {
  const read = vi.fn(async () => ({ ok: true, page: 'table', tableChoices: ['櫃台取餐', 'B3 吧檯'] }))
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const state = await source.context({ transcript: text })
  expect(state).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ description: expect.stringContaining(text.includes('自取') || text.includes('外帶') ? '櫃台取餐' : 'B3 吧檯') })]) })
  expect(execute).not.toHaveBeenCalled()
})

// Report: this chat, 2026-11-14 — 「那我不要了」 in an empty search fell into an old question.
it.each(['那我不要了', '先別找這個了', '回菜單', '我想點一份湯', '把購物車全部刪掉'])('exposes state-based search recovery to Jev for %s without interpreting the utterance', async (transcript) => {
  const navigation = { ...tools[0], name: 'browser_return_menu' }
  const execute = vi.fn(async () => ({ ok: true, source: 'browser' }))
  const source = createBrowserFastPathSource({ tools: [...tools, navigation], read: async () => ({ cart: { version: 'cart', lines: [] }, products: [], search: '不存在的餐點' }), execute, hasPendingQuestion: () => true, pendingQuestion: () => question })
  expect(await source.context({ transcript })).toMatchObject({ waitingFor: question, candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:return-menu' }), ...question.choices]) })
  expect(await source.execute({ candidateId: 'intent:return-menu' })).toMatchObject({ ok: true })
  expect(execute).toHaveBeenCalledWith(navigation, {})
})

// Report: this chat, 2026-11-14 — offering recovery must never decide the customer's intent.
it('forwards actual search state and obeys Jev handoff without clearing anything', async () => {
  const navigation = { ...tools[0], name: 'browser_return_menu' }
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools: [...tools, navigation], read: async () => ({ search: '雞排', cart: { version: 'cart', lines: [] }, products: [] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const, reason: 'UNCERTAIN_OPERATION' as const }))
  expect(await runFastPath({ isEnabled: async () => true, source, decide, transcript: '那我不要了', webMcp: { tools, execute } })).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ menuSearch: { query: '雞排' }, interactionState: expect.objectContaining({ screen: 'menu' }) }) }))
  expect(execute).not.toHaveBeenCalled()
})

// Report: this chat, Nov14 — a search must not hide the pending add confirmation from Jev.
it.each(['要', '要啊', '那就幫我加吧', '不要了', '改成兩份'])('offers the current question before search recovery without phrase admission: %s', async (transcript) => {
  const waitingFor = { questionId: 'fish-confirm', purpose: 'browser-confirm-add', question: '魚丸湯一份，要加入嗎？', expiresAt: Date.now() + 60000, choices: [{ id: 'confirm', description: '加入魚丸湯一份' }, { id: 'cancel', description: '取消尚未加入的魚丸湯' }] }
  const source = createBrowserFastPathSource({ tools, read: async () => ({ search: '魚', products: [product], cart: { version: 'cart' } }), execute: vi.fn(), hasPendingQuestion: () => true, pendingQuestion: () => waitingFor, canAnswerLocally: () => false })
  expect(await source.context({ transcript })).toMatchObject({ waitingFor, candidates: waitingFor.choices })
})

// Report: this chat, Nov14; local A套餐 dialog was absent from the Jev state.
it('offers Jev the current opened dish and a semantic close route without changing cart contents', async () => {
  const cart = { version: 'current-cart', lines: [{ ref: 'meal', name: '另一道餐點', quantity: 2 }] }
  const execute = vi.fn(async () => ({ ok: true, source: 'browser', customerMessage: '已回到菜單。' }))
  const currentTools = [...tools, { ...tools[0], name: 'browser_return_menu' }]
  const source = createBrowserFastPathSource({ tools: currentTools, read: async () => ({ ok: true, page: 'menu', cart, products: [{ ...product, name: 'A套餐' }], productDialog: [{ name: 'A套餐' }] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const decide = vi.fn(async () => ({ kind: 'FAST_ACTION' as const, actionId: 'intent:return-menu', confidence: 0.95 }))
  const result = await runFastPath({ transcript: '我不要a套餐了，幫我關閉', isEnabled: async () => true, source, decide, webMcp: { tools: currentTools, execute } })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ interactionState: expect.objectContaining({ screen: 'item_configuration', selectedItemName: 'A套餐' }) }), candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:return-menu', description: expect.stringContaining('關閉') })]) }))
  expect(result.kind).toBe('FAST_ACTION')
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_return_menu' }), {})
  expect(cart.lines).toEqual([{ ref: 'meal', name: '另一道餐點', quantity: 2 }])
})

// Report: this chat, Nov14 Start was narrowed to a table-only candidate.
it('offers a real Start action with the current table instead of only a table-selection label', async () => {
  const source = createBrowserFastPathSource({ tools, read: async () => ({ ok: true, page: 'table', tableChoices: ['櫃台取餐', 'A3 桌'], selectedTable: 'A3 桌' }), execute: async () => ({}), hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const, reason: 'NEW_REQUEST' as const }))
  await runFastPath({ isEnabled: async () => true, source, decide, transcript: '開始點餐', webMcp: { tools, execute: async () => ({}) } })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ candidates: expect.arrayContaining([{ id: 'start', description: '使用A3 桌開始點餐' }]) }))
})

// Report: this chat; incomplete customer speech must receive a visible question.
it('asks for a complete request instead of retaining a silent PB speech fragment', async () => {
  const execute = vi.fn(async () => ({}))
  const session = createIncompleteAsrSession()
  const source = createBrowserFastPathSource({ tools, read: async () => ({ page: 'menu', cart: { version: 'cart', lines: [] }, products: [product] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const result = await runFastPath({ transcript: '我要一份……', source, session, isEnabled: async () => true, decide: async () => ({ kind: 'INCOMPLETE' }), webMcp: { tools, execute } })
  expect(result).toMatchObject({ kind: 'CLARIFICATION', prompt: '請把需求說完整，例如想點哪道餐點、幾份。' })
  expect(session.snapshot()).toBeUndefined()
  expect(execute).not.toHaveBeenCalled()
})

// Report: this chat; the shared 套餐 alias cannot identify B while excluding A.
it('keeps both A and B possible for the shared 套餐 alias without inventing a unique purchase', async () => {
  const execute = vi.fn(async () => ({}))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ page: 'menu', cart: { version: 'cart', lines: [] }, products: [{ ...product, ref: 'a', name: 'A套餐' }, { ...product, ref: 'b', name: 'B套餐' }] }), catalogLabels: () => [{ name: 'A套餐', aliases: ['套餐'], category: '' }, { name: 'B套餐', aliases: ['套餐'], category: '' }], execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: '我要套餐' })
  expect(context).toMatchObject({ productResolution: { count: 2 }, candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-item' }), expect.objectContaining({ id: 'intent:ask-quantity' })]) })
  expect(execute).not.toHaveBeenCalled()
})

// Report: this chat; semantic/compiler failures must reach Main instead of a dead end.
it.each(['unavailable', 'invalid-choice', 'context-failure'])('hands PB %s to Main without executing a guessed operation', async (mode) => {
  const execute = vi.fn(async () => ({ ok: true, source: 'browser', status: 'verified' }))
  const source = createBrowserFastPathSource({ tools, read: async () => {
    if (mode === 'context-failure')
      throw new Error('Local snapshot unavailable')
    return { page: 'menu', cart: { version: 'cart', lines: [] }, products: [product] }
  }, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const result = await runFastPath({ transcript: '當日新菜兩份', source, isEnabled: async () => true, decide: async () => mode === 'invalid-choice' ? { kind: 'FAST_ACTION', actionId: 'missing' } : { kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' }, webMcp: { tools, execute } })
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
  expect(execute).not.toHaveBeenCalled()
})

it('does not claim a PB purchase succeeded when the native tool returns no receipt', async () => {
  const execute = vi.fn(async () => undefined)
  const source = createBrowserFastPathSource({ tools, read: async () => ({ page: 'menu', cart: { version: 'cart', lines: [] }, products: [product] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  expect(await runFastPath({ transcript: '當日新菜兩份', source, isEnabled: async () => true, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:add-item', confidence: 0.99 }), webMcp: { tools, execute } })).toMatchObject({ kind: 'EXECUTION_FAILED', uncertain: true })
  expect(execute).toHaveBeenCalledOnce()
})

it('hands a definitely unapplied PB rejection to Main without replaying it', async () => {
  const execute = vi.fn(async () => ({ ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '網站資料已更新。' }))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ page: 'menu', cart: { version: 'cart', lines: [] }, products: [product] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  expect(await runFastPath({ transcript: '當日新菜兩份', source, isEnabled: async () => true, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:add-item', confidence: 0.99 }), webMcp: { tools, execute } })).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
  expect(execute).toHaveBeenCalledOnce()
})

// Report: this chat, 2026-11-15; native rejected a stale initial cart before touching a product.
it('hands an explicitly unexecuted stale-cart purchase to Main without replaying it', async () => {
  const { source, execute } = setup()
  execute.mockResolvedValueOnce({ ok: false, source: 'browser', status: 'rejected', effect: 'none', reason: 'stale-cart', execution: { steps: [] } })
  await source.context({ transcript: '當日新菜一份' })
  const result = await source.execute({ candidateId: 'intent:add-item' })
  expect(result).toMatchObject({ status: 'rejected', effect: 'none', needsAssistant: true, decisionTrace: { operationPlan: { toolName: 'browser_cart_add', input: { productRef: product.ref, quantity: 1 } } } })
  expect(execute).toHaveBeenCalledOnce()
  expect(await source.execute({ candidateId: 'intent:add-item' })).toMatchObject({ ok: false, effect: 'none' })
  expect(execute).toHaveBeenCalledOnce()
})

// Report: this chat, 2026-11-15; the selected finite answer ID was discarded and classified twice.
it('passes the exact issued question and selected answer to the Host instead of an empty answer request', async () => {
  const waiting = { ...question, purpose: 'browser-service-question', choices: [{ id: 'yes', description: '打開購物車核對' }, { id: 'no', description: '繼續點餐' }] }
  const execute = vi.fn(async () => ({ ok: true, source: 'browser', status: 'verified' }))
  const source = createBrowserFastPathSource({ tools, read: async () => ({ cart: { version: 'cart', lines: [] }, products: [product] }), execute, hasPendingQuestion: () => true, pendingQuestion: () => waiting })
  await source.context({ transcript: '那就往下一步吧' })
  await source.execute({ candidateId: 'yes' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_answer_question' }), { questionId: waiting.questionId, choiceId: 'yes' })
})
