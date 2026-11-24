import { browserConversationInstructions, browserToolArguments, browserToolNames, browserToolParameters } from '@proj-airi/stage-shared/browser-conversation'
import { explicitServingQuantities, quantityFromTranscript } from '@proj-airi/stage-shared/ordering-slots'
import { expect, it } from 'vitest'

// Report: this chat, Nov12; Main should receive the current task, not infer it from phase codes.
it('states the active question directly and separates absent customization from unread specifications', () => {
  const context = {
    taskId: 'private-task',
    sourceUtterance: '我要雞腿飯',
    phase: 'collecting_quantity' as const,
    readOnly: false,
    catalog: { complete: true, products: [{ ref: 'p-1', name: '雞腿飯', configurations: [{ version: 'spec-1', variantRef: '', name: '雞腿飯', unitPrice: 130, groups: [] }] }, { ref: 'p-2', name: '每日餐' }] },
    draft: { productRef: 'p-1', name: '雞腿飯', missing: ['quantity' as const, 'confirmation' as const] },
    waitingFor: { questionId: 'private-question', purpose: 'browser-order-quantity' as const, question: '雞腿飯要幾份？', expiresAt: Date.now() + 60_000, choices: [{ id: 'cancel', description: '取消這次選餐' }] },
    allowedToolNames: ['browser_cart_get'],
  }
  const instructions = browserConversationInstructions(context)
  const data = JSON.parse(instructions.slice(instructions.indexOf('{')))
  expect(data.currentActivity).toBe('等待顧客提供餐點份數')
  expect(data.currentQuestion).toEqual({ question: '雞腿飯要幾份？', answerOptions: [{ id: 'cancel', description: '取消這次選餐' }] })
  expect(data.catalog.products[0].customizationAvailability).toBe('none')
  expect(data.catalog.products[1].customizationAvailability).toBe('not_verified')
  expect(data.pendingItems[0].missingFields).toEqual(['餐點份數', '顧客確認加入'])
  expect(data).not.toHaveProperty('phase')
  expect(data).not.toHaveProperty('draft')
  expect(instructions).not.toContain('private-question')
  expect(instructions).not.toContain('private-task')
})

it('reads provided serving fields without turning meal names, add-ons or party size into servings', () => {
  expect(explicitServingQuantities('我要三杯雞便當', { productName: '三杯雞便當' })).toEqual([])
  expect(explicitServingQuantities('我要三杯雞兩份', { productName: '三杯雞便當' })).toEqual([2])
  expect(explicitServingQuantities('兩個人要雞腿便當', { productName: '雞腿便當' })).toEqual([])
  expect(explicitServingQuantities('水餃一份加兩顆')).toEqual([1])
  expect(explicitServingQuantities('先一份，不對，要兩份')).toEqual([1, 2])
  expect(explicitServingQuantities('便當二十七份')).toEqual([27])
  expect(explicitServingQuantities('便當９９份')).toEqual([99])
  expect(quantityFromTranscript('便當二十七份')).toBeUndefined()
  expect(quantityFromTranscript('便當兩份')).toBe(2)
})

it('changes model parameter guidance without changing native write validation', () => {
  const schema = { type: 'object', properties: { version: { type: 'string', description: 'Only copy from cart_get' }, quantity: { type: 'integer', minimum: 1, maximum: 99 }, selection: { type: 'object', properties: { version: { type: 'string' }, choices: { type: 'array', items: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['quantity'], additionalProperties: false } } }, required: ['version', 'choices'], additionalProperties: false } }, required: ['version', 'quantity', 'selection'], additionalProperties: false }
  const projected = browserToolParameters('browser_cart_add', schema)
  expect(projected).toMatchObject({ type: 'object', required: ['version', 'quantity', 'selection'], additionalProperties: false, properties: { version: { type: 'string', description: expect.stringContaining('本輪狀態') }, quantity: { type: 'integer', minimum: 1, maximum: 99 }, selection: { required: ['version', 'selectedOptions'], additionalProperties: false, properties: { selectedOptions: { items: { required: ['quantity'], additionalProperties: false, properties: { quantity: { type: 'integer', minimum: 1, maximum: 99, description: expect.stringContaining('每份') } } } } } } } })
  expect(schema.properties.version.description).toBe('Only copy from cart_get')
  expect(schema.properties.quantity).not.toHaveProperty('description')
})

it('uses the same option names in model schemas, native dispatch and continuation examples', () => {
  const original = { lines: [{ productRef: 'p-1', evidence: '餐點兩份', quantity: 2, choices: [{ ref: 'extra', quantity: null }], askGroups: ['group-1'], note: '' }] }
  const serialized = JSON.stringify(original)
  const model = browserToolArguments('browser_order_draft', serialized, 'model')
  expect(JSON.parse(model).lines[0]).toMatchObject({ selectedOptions: [{ ref: 'extra', quantity: null }], unansweredOptionGroupRefs: ['group-1'] })
  expect(browserToolArguments('browser_order_draft', model, 'host')).toBe(serialized)
  const parameters = { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: { choices: { type: 'array' }, askGroups: { type: 'array' } }, required: ['choices', 'askGroups'], additionalProperties: false } } }, required: ['lines'] }
  expect(browserToolParameters('browser_order_draft', parameters)).toMatchObject({ properties: { lines: { items: { required: ['selectedOptions', 'unansweredOptionGroupRefs'], additionalProperties: false } } } })
  const conflict = '{"lines":[{"choices":[],"selectedOptions":[{"ref":"x","quantity":1}]}]}'
  expect(browserToolArguments('browser_order_draft', conflict, 'host')).toBe(conflict)
  expect(browserToolArguments('browser_order_draft', 'not-json', 'host')).toBe('not-json')
})

it('keeps a pending question from exposing purchase tools and preserves immutable read-only scope', () => {
  const tools = ['browser_observe', 'browser_cart_get', 'browser_ask_quantity', 'browser_cart_add', 'browser_confirm_add', 'browser_cart_remove']
  expect(browserToolNames({ phase: 'collecting_quantity', readOnly: false }, tools)).toEqual(['browser_observe', 'browser_cart_get'])
  expect(browserToolNames({ phase: 'ready_to_add', readOnly: false }, tools)).toContain('browser_confirm_add')
  expect(browserToolNames({ phase: 'ready_to_add', readOnly: true }, tools)).not.toContain('browser_confirm_add')
})

it('uses draft collection instead of exposing raw native additions to Main', () => {
  const tools = ['browser_cart_get', 'browser_order_draft', 'browser_cart_add', 'browser_confirm_add']
  expect(browserToolNames({ phase: 'browsing', readOnly: false }, tools)).toEqual(['browser_cart_get', 'browser_order_draft'])
  expect(browserToolNames({ phase: 'ready_to_add', readOnly: false }, tools)).toEqual(['browser_cart_get', 'browser_confirm_add'])
})

it('exposes voice menu entry only on the table page and states the verified selection directly', () => {
  const tools = ['browser_cart_get', 'browser_table_select', 'browser_start_ordering', 'browser_cart_add']
  expect(browserToolNames({ phase: 'selecting_table', readOnly: true }, tools)).toEqual(['browser_cart_get', 'browser_table_select', 'browser_start_ordering'])
  expect(browserToolNames({ phase: 'browsing', readOnly: false }, tools)).toEqual(['browser_cart_get', 'browser_cart_add'])
  const instructions = browserConversationInstructions({ taskId: 'table', sourceUtterance: '開始點餐', phase: 'selecting_table', page: 'table', selectedTable: 'A1 桌', tableChoices: ['A1 桌'], readOnly: true, catalog: { complete: false, products: [] }, allowedToolNames: tools.slice(0, 3) })
  expect(instructions).toContain('"selectedTable":"A1 桌"')
  expect(instructions).toContain('可使用語音操作')
})

// Report: this chat, Nov14 full Host replay; Main rejected B03 despite a unique B3 table.
it('supplies a uniquely resolved spoken table as evidence without claiming it is already selected', () => {
  const base = { taskId: 'table', phase: 'selecting_table' as const, page: 'table' as const, readOnly: true, tableChoices: ['A3 桌', 'B3 吧檯'], catalog: { complete: false, products: [] }, allowedToolNames: ['select_table', 'start_ordering_at_table'] }
  const instructions = browserConversationInstructions({ ...base, sourceUtterance: 'B03' })
  const data = JSON.parse(instructions.slice(instructions.indexOf('{')))
  expect(data.requestedTable).toBe('B3 吧檯')
  expect(data.selectedTable).toBeUndefined()
  const absent = browserConversationInstructions({ ...base, sourceUtterance: 'B04' })
  expect(JSON.parse(absent.slice(absent.indexOf('{'))).requestedTable).toBeUndefined()
})

it('gives business tools names and prices without asking the model to carry host IDs or versions', () => {
  const instructions = browserConversationInstructions({ taskId: 'private-task', sourceUtterance: '看雞腿飯', phase: 'browsing', readOnly: true, cart: { version: 'private-cart-version', lines: [{ ref: 'private-row', productRef: 'private-product', name: '雞腿飯', quantity: 2, unitPrice: 100, configuration: 'private-configuration', description: '加蛋 ×1' }] }, catalog: { complete: true, products: [{ ref: 'private-product', name: '雞腿飯', configurations: [{ version: 'private-config', variantRef: 'private-variant', name: '大份', unitPrice: 100, groups: [] }] }] }, allowedToolNames: ['list_menu_items', 'list_cart_items'] })
  const data = JSON.parse(instructions.slice(instructions.indexOf('{')))
  expect(data.cart.lines[0]).toMatchObject({ name: '雞腿飯', quantity: 2, unitPrice: 100 })
  expect(data.catalog.products[0].orderSpecifications[0]).toMatchObject({ name: '大份', unitPrice: 100 })
  expect(instructions).not.toContain('private-')
})

// Report: docs/codex-handoff.md, Nov20 — the planner could not see the active menu filter.
it.each([['previous manual filter', true], ['', false]] as const)('tells the planner whether the menu is filtered without forwarding the search text (%s)', (search, menuSearchActive) => {
  const instructions = browserConversationInstructions({
    taskId: 'menu',
    sourceUtterance: '看全部',
    phase: 'browsing',
    page: 'menu',
    search,
    readOnly: true,
    catalog: { complete: true, products: [] },
    allowedToolNames: ['return_to_menu'],
  })
  expect(JSON.parse(instructions.slice(instructions.indexOf('{')))).toMatchObject({ menuSearchActive })
  expect(instructions).not.toContain('previous manual filter')
})
