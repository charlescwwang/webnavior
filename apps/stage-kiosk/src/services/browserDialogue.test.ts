import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { CartLine } from '@proj-airi/stage-ui/services/pbCart'

import type { AnswerDecision, BrowserAnswer, BrowserEffect, EffectDecision } from '../../../server/src/services/domain/browser-ordering/contracts'

import { looseObject, parse, string } from 'valibot'
import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { askBrowserCustomerQuestion, beginBrowserCartTask, executeBrowserCartTool, executeBrowserConfirmedAddition, executeBrowserOrderDraft, executeBrowserQuantityQuestion, executeBrowserReply, prepareBrowserQuestionAnswer, readBrowserConversation } from './browserCartTask'
import { createBrowserDialogue } from './browserDialogue'

const release: Array<() => void> = []
afterEach(() => release.splice(0).forEach(dispose => dispose()))

const modelTools = ['browser_observe', 'browser_cart_get', 'browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace', 'browser_ask_quantity', 'browser_confirm_add', 'browser_respond']

// Report: this chat, Nov19 — compressed split-table codes must be confirmed before selection.
it.each([['A31', 'A3-1 桌'], ['A32', 'A3-2 桌']])('confirms %s before selecting the actual split table once', async (spoken, name) => {
  const { client: original, context, begin, dialogue } = setup()
  const select = { ...context, name: 'browser_table_select' }
  const client = { ...original, tools: readonly(shallowRef([...original.tools.value, select])) }
  const entry = { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['A3-1 桌', 'A3-2 桌'], selectedTable: 'A3-2 桌', customerMessage: '請選桌。' }
  client.execute.mockImplementation(async tool => tool.name === select.name ? { ok: true, source: 'browser', status: 'table-selected', selectedTable: name } : entry)
  begin(spoken)
  expect(await executeBrowserCartTool(client, select, { name })).toMatchObject({ effect: 'none', pendingCustomerChoice: { purpose: 'browser-table-confirmation', question: expect.stringContaining(name) } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === select.name)).toHaveLength(0)
  expect(dialogue.hasPending()).toBe(true)
  begin('對')
  const answer = await prepareBrowserQuestionAnswer(client)
  expect(answer).toBeTypeOf('function')
  expect(await answer!()).toMatchObject({ ok: true, selectedTable: name })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === select.name)).toHaveLength(1)
  expect(client.execute.mock.calls.find(([tool]) => tool.name === select.name)?.[1]).toEqual({ name })
  expect(dialogue.hasPending()).toBe(false)
  expect(await prepareBrowserQuestionAnswer(client)).toBeUndefined()
})

it.each(['不是', 'A3之二', 'manual-change', 'jev-answer'] as const)('handles a pending split-table answer safely: %s', async (answerText) => {
  const { client: original, context, begin, dialogue } = setup()
  const select = { ...context, name: 'browser_table_select' }
  const client = { ...original, tools: readonly(shallowRef([...original.tools.value, select])) }
  const entry = { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['A3-1 桌', 'A3-2 桌'], selectedTable: 'A3-2 桌', customerMessage: '請選桌。' }
  client.execute.mockImplementation(async (tool, input) => tool.name === select.name ? { ok: true, source: 'browser', effect: 'none', selectedTable: input.name } : { ...entry, observedAt: Date.now() })
  begin('A31')
  await executeBrowserCartTool(client, select, { name: 'A3-1 桌' })
  const question = dialogue.tables.pending(entry)!
  expect(dialogue.validate(entry, question.questionId)).toEqual(question)
  if (answerText === 'manual-change')
    entry.selectedTable = 'A3-1 桌'
  if (answerText === 'manual-change')
    expect(dialogue.validate(entry, question.questionId)).toBeUndefined()
  begin(answerText === 'manual-change' ? '對' : answerText === 'jev-answer' ? '就是那桌' : answerText, answerText === 'jev-answer')
  if (answerText === 'A3之二') {
    expect(await executeBrowserCartTool(client, select, { name: 'A3-2 桌' })).toMatchObject({ selectedTable: 'A3-2 桌' })
  }
  else {
    const operation = await prepareBrowserQuestionAnswer(client, answerText === 'jev-answer' ? { questionId: question.questionId, choiceId: 'yes' } : undefined)
    if (answerText === 'manual-change') {
      expect(operation).toBeUndefined()
    }
    else {
      expect(operation).toBeTypeOf('function')
      const result = await operation!()
      expect(result).toMatchObject(answerText === '不是' ? { effect: 'none', customerMessage: expect.stringContaining('尚未選擇') } : { selectedTable: 'A3-1 桌' })
    }
  }
  const calls = client.execute.mock.calls.filter(([tool]) => tool.name === select.name)
  expect(calls).toHaveLength(['A3之二', 'jev-answer'].includes(answerText) ? 1 : 0)
  expect(client.execute.mock.calls.some(([tool]) => tool.name === 'browser_start_ordering')).toBe(false)
})

it('selects an actual A31 directly rather than asking about A3-1', async () => {
  const { client, context, begin, dialogue } = setup()
  const select = { ...context, name: 'browser_table_select' }
  client.execute.mockImplementation(async tool => tool.name === select.name ? { ok: true, selectedTable: 'A31 桌' } : { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['A3-1 桌', 'A31 桌'], customerMessage: '請選桌。' })
  begin('A31')
  expect(await executeBrowserCartTool(client, select, { name: 'A31 桌' })).toMatchObject({ selectedTable: 'A31 桌' })
  expect(dialogue.hasPending()).toBe(false)
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === select.name)).toHaveLength(1)
})

// Report: this chat, Nov17 — cart review treated 「這樣就好」 as a request to edit a dish.
it('accepts a completed-cart answer only for cart review and still asks for invoice selection', async () => {
  const { dialogue, facts, answer } = setup()
  dialogue.presentService(facts, { purpose: 'cart-review', request: '結帳', question: '餐點正確嗎？', choices: [{ id: 'yes', description: '繼續選擇發票' }, { id: 'no', description: '修改餐點' }] })
  expect(dialogue.canAnswerLocally(facts, '這樣就好')).toBe(true)
  expect(await dialogue.answer(facts, '這樣就好', async () => facts, () => true)).toMatchObject({ kind: 'checkout', action: 'invoice-options' })
  expect(answer).not.toHaveBeenCalled()
  dialogue.presentService(facts, { purpose: 'submit-order', query: 'ticket', request: '送單', question: '確認送出嗎？', choices: [{ id: 'yes', description: '送出' }, { id: 'no', description: '保留' }] })
  expect(dialogue.canAnswerLocally(facts, '這樣就好')).toBe(false)
})

// Report: this chat, Nov15 — complete item/count answers must not ask to add again.
it.each(['complete', 'quantity-answer'] as const)('adds a validated %s order draft without a second confirmation', async (mode) => {
  const { begin, client, add, dialogue } = setup()
  begin(mode === 'complete' ? '我要乙餐一份' : '我要乙餐')
  const result = await executeBrowserOrderDraft(client, { lines: [{ productRef: 'p-1', evidence: mode === 'complete' ? '我要乙餐一份' : '乙餐', quantity: mode === 'complete' ? 1 : null, choices: [], askGroups: [], note: '' }] })
  let completed = result
  if (mode === 'quantity-answer') {
    expect(result).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-order-slot' } })
    begin('一份')
    const answer = await prepareBrowserQuestionAnswer(client)
    expect(answer).toBeTypeOf('function')
    completed = await answer!()
  }
  expect(completed).toMatchObject({ ok: true, status: 'verified' })
  expect(completed).not.toHaveProperty('pendingCustomerChoice')
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
  expect(dialogue.hasPending()).toBe(false)
})

it('refuses a completed draft whose exact issued plan cannot be admitted', async () => {
  const { begin, client, add, decide } = setup()
  begin('我要乙餐一份，飯少')
  decide.mockResolvedValueOnce({ choice: 'CLARIFY', provider: 'unavailable' })
  const result = await executeBrowserOrderDraft(client, { lines: [{ productRef: 'p-1', evidence: '乙餐一份', quantity: 1, choices: [], askGroups: [], note: '' }] })
  expect(result).not.toMatchObject({ status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ transcript: '我要乙餐一份，飯少' }), expect.anything())
})

// Report: fixed live PB cases in this chat, Nov11; Main asked quantity again
// after 「炸雞腿便當一份」 and selected a quantity question for recommendations.
it.each(['我要乙餐一份', '推薦什麼餐點？'])('does not expose a quantity question without a missing known target slot: %s', async (text) => {
  const { begin, client } = setup()
  begin(text)
  const context = await readBrowserConversation(client, 'known-fields', modelTools)
  expect(context.allowedToolNames).not.toContain('browser_ask_quantity')
})

it('exposes a quantity question only for a named target whose count is missing', async () => {
  const { begin, client } = setup()
  begin('我要乙餐')
  const context = await readBrowserConversation(client, 'missing-count', modelTools)
  expect(context.allowedToolNames).toContain('browser_ask_quantity')
})

// Adapted from master apps/order-menu/src/asrNameDiagnosis.test.ts and shared-alias controls.
it('uses published aliases only as formal-name confirmation candidates and preserves shared ambiguity', () => {
  const { facts } = setup()
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'page', answer: async () => ({ kind: 'UNCERTAIN', provider: 'main' }), catalogLabels: () => [{ name: '甲餐', aliases: ['招牌'], category: '套餐' }, { name: '乙餐', aliases: ['招牌', '店家別稱'], category: '套餐' }] })
  const shared = dialogue.presentProducts(facts, '招牌', '我要招牌一份')
  expect(shared).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-product-choice' }, presentationRefs: ['p-0', 'p-1'] })
  const unique = dialogue.presentProducts(facts, '店家別稱', '我要店家別稱')
  expect(unique).toMatchObject({ pendingCustomerChoice: { question: expect.stringContaining('乙餐') }, presentationRefs: ['p-1'] })
  expect(unique).not.toHaveProperty('confirmedAddition')
})

it('does not reuse configured labels after a product rename or interpret a category as an exact purchase', () => {
  const { facts } = setup()
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'page', answer: async () => ({ kind: 'UNCERTAIN', provider: 'main' }), catalogLabels: () => [{ name: '昨日餐點', aliases: ['招牌'], category: '套餐' }] })
  expect(dialogue.presentProducts(facts, '招牌', '我要招牌')).toMatchObject({ customerMessage: expect.stringContaining('沒有找到') })
  expect(dialogue.hasPending()).toBe(false)
})

// Adapted from master's categoryQueries and shared menu/filter regression cases.
it('projects labels to Main and displays current category refs instead of searching for an absent literal label', async () => {
  const { facts, client, dialogue, present, decide } = setup()
  const catalogLabels = () => [{ name: '甲餐', aliases: ['招牌'], category: '主食' }, { name: '乙餐', aliases: ['第二餐'], category: '主食' }]
  release.push(beginBrowserCartTask('主食有哪些？', { dialogue, decide, isCurrent: () => true, catalogLabels }))
  const context = await readBrowserConversation(client, 'labels', modelTools)
  expect(context.catalog.products[0]).toMatchObject({ aliases: ['招牌'], category: '主食', price: 10 })
  const search = { ...present, name: 'browser_search' }
  const result = await executeBrowserCartTool(client, search, { query: '主食' })
  expect(result).toMatchObject({ presentation: { cue: 'shown', products: [{ ref: 'p-0' }, { ref: 'p-1' }] } })
  expect(client.execute).toHaveBeenCalledWith(present, { productRefs: ['p-0', 'p-1'], mode: 'information' })
  expect(client.execute.mock.calls.some(([tool]) => tool.name === 'browser_search')).toBe(false)
  expect(facts.cart.lines).toHaveLength(0)
})

it('does not convert a model-picked recommendation into a customer product choice', async () => {
  const { begin, client, dialogue, present } = setup()
  begin('推薦什麼？')
  expect(await executeBrowserQuantityQuestion(client, { productRef: 'p-1' })).toMatchObject({ dataOnly: true, status: 'proposal_rejected' })
  expect(dialogue.hasPending()).toBe(false)
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === present.name)).toHaveLength(0)
})

it('refreshes the pending quantity and catalog before Main without consuming the customer answer', async () => {
  const { dialogue, facts, begin, client, answer } = setup()
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  begin('兩份')
  const context = await readBrowserConversation(client, 'turn-1', modelTools)
  expect(context).toMatchObject({ phase: 'collecting_quantity', sourceUtterance: '兩份', draft: { name: '乙餐', missing: ['quantity', 'configuration', 'confirmation'] }, waitingFor: { purpose: 'browser-order-quantity' }, catalog: { complete: true } })
  expect(context.allowedToolNames).toContain('browser_cart_get')
  expect(context.allowedToolNames).not.toContain('browser_cart_add')
  expect(context.catalog.products[1].configurations?.[0].version).toBe('config-1')
  expect(answer).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(true)
})

it('rejects an empty configuration version before semantic admission or native dispatch', async () => {
  const { begin, client, add, decide } = setup()
  begin('我要乙餐一份')
  expect(await executeBrowserCartTool(client, add, { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: '', variantRef: '', choices: [] } })).toMatchObject({ status: 'proposal_rejected', dataOnly: true })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  expect(decide).not.toHaveBeenCalled()
})

it('returns fresh state for a stale parallel plan after this turn verified a write', async () => {
  const { begin, client, facts, add, decide } = setup()
  begin('我要甲餐一份、乙餐一份')
  await executeBrowserCartTool(client, add, { version: 'cart', productRef: 'p-0', quantity: 1, unitPrice: 10, note: '', selection: { version: 'config-0', variantRef: '', choices: [] } })
  facts.cart.version = 'after-add'
  decide.mockClear()
  expect(await executeBrowserCartTool(client, add, { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } })).toMatchObject({ status: 'proposal_rejected', dataOnly: true, requiredAction: 'add', cart: { version: 'after-add' } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
  expect(decide).not.toHaveBeenCalled()
})

it('makes the complete quantity answer executable without asking for a second confirmation', async () => {
  const { dialogue, facts, begin, client, context: cart, add, answer } = setup()
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  begin('兩份')
  await executeBrowserCartTool(client, cart, { includeCatalog: true })
  const collected = await readBrowserConversation(client, 'quantity-turn', modelTools)
  expect(collected).toMatchObject({ phase: 'ready_to_add', draft: { productRef: 'p-1', quantity: 2, missing: [] } })
  expect(collected.waitingFor).toBeUndefined()
  expect(collected.allowedToolNames).toContain('browser_confirm_add')
  await executeBrowserCartTool(client, add, { version: 'cart', productRef: 'p-1', quantity: 2, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
  expect(answer).not.toHaveBeenCalled()
})

it('retires an old question when fresh cart evidence changes before the next model round', async () => {
  const { dialogue, facts, begin, client } = setup()
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  facts.cart.version = 'changed'
  begin('兩份')
  const context = await readBrowserConversation(client, 'new-turn', modelTools)
  expect(context).toMatchObject({ phase: 'browsing', cart: { version: 'changed' } })
  expect(context.waitingFor).toBeUndefined()
  expect(context.draft).toBeUndefined()
})

// Report: this chat, Nov20 — the visible cart does not prove who is operating it.
it('uses the visible nonempty cart without inferring customer ownership', async () => {
  const { facts, client, dialogue, decide } = setup()
  client.execute.mockResolvedValueOnce({ ...facts, cart: { version: 'visible-cart', subtotal: 20, lines: [{ ref: 'line-existing', name: '蛋花湯', quantity: 2, unitPrice: 10 }] } })
  release.push(beginBrowserCartTask('推薦什麼', { dialogue, decide, isCurrent: () => true }))
  const context = await readBrowserConversation(client, 'visible-cart-turn', modelTools)
  expect(context.phase).not.toBe('review_required')
  expect(context.cart).toMatchObject({ version: 'visible-cart', lines: [{ name: '蛋花湯', quantity: 2 }] })
})
it('does not turn a sign-in requirement into an empty cart or an empty complete catalog', async () => {
  const { client, begin } = setup()
  begin('推薦什麼')
  client.execute.mockResolvedValueOnce({ ok: false, source: 'browser', status: 'rejected', effect: 'none', code: 'sign-in-required', error: 'PB requires manual sign-in.' })
  const context = await readBrowserConversation(client, 'sign-in', modelTools)
  expect(context).toMatchObject({ phase: 'sign_in_required', catalog: { complete: false } })
  expect(context.cart).toBeUndefined()
  expect(context.allowedToolNames).not.toContain('browser_confirm_add')
})

it('gives Main a table task without inventing cart facts or exposing meal tools', async () => {
  const { client, begin } = setup()
  begin('我要雞腿飯一份')
  const pending = { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'A1 桌', 'B1 吧檯'], customerMessage: '請先選桌並開始點餐。' }
  client.execute.mockResolvedValue(pending)
  const context = await readBrowserConversation(client, 'table-task', modelTools)
  expect(context.phase).toBe('selecting_table')
  expect(context.page).toBe('table')
  expect(context.tableChoices).toEqual(pending.tableChoices)
  expect(context.cart).toBeUndefined()
  expect(context.catalog.complete).toBe(false)
  expect(context.allowedToolNames).toEqual(['browser_cart_get', 'browser_respond'])
  expect(await executeBrowserReply(client, 'checkout-guidance')).toMatchObject({ code: 'table-selection-required', customerMessage: pending.customerMessage })
  expect(client.execute.mock.calls.every(([tool]) => ['browser_cart_get', 'browser_state_get'].includes(tool.name))).toBe(true)
})

// Report: this chat, Nov12; 「我要坐a4」 and 「A4」 only repeated the generic
// table question even though the current table list proves that A4 is absent.
it.each(['我要坐a4', 'A4', '我要 A 四桌'])('explains an unavailable table without replacing it with another choice: %s', async (utterance) => {
  const { client, begin, context } = setup()
  begin(utterance)
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'A1 桌', 'A3 桌'], selectedTable: 'A3 桌', customerMessage: '請告訴我您的桌號。' })
  await readBrowserConversation(client, 'unknown-table', ['browser_cart_get', 'browser_table_select', 'browser_start_ordering', 'browser_respond'])
  expect(await executeBrowserReply(client, 'clarification')).toMatchObject({ customerMessage: expect.stringContaining('沒有「A4」這個桌號') })
  for (const name of ['browser_table_select', 'browser_start_ordering']) {
    expect(await executeBrowserCartTool(client, { ...context, name }, { name: 'A3 桌' })).toMatchObject({ customerMessage: expect.stringContaining('沒有「A4」這個桌號'), effect: 'none' })
  }
  expect(client.execute.mock.calls.every(([tool]) => ['browser_cart_get', 'browser_state_get'].includes(tool.name))).toBe(true)
})

// Report: this chat; customers must be able to enter the menu using voice.
it('returns the fresh touched table for Main to correct a stale Start proposal without asking the customer again', async () => {
  const { client, begin, context } = setup()
  begin('開始點餐')
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'B3 吧檯'], selectedTable: 'B3 吧檯', customerMessage: '使用目前選擇開始點餐嗎？' })
  const result = await executeBrowserCartTool(client, { ...context, name: 'browser_start_ordering' }, { name: '櫃台取餐' })
  expect(result).toMatchObject({ ok: true, status: 'proposal_rejected', effect: 'none', dataOnly: true, selectedTable: 'B3 吧檯' })
  expect(client.execute.mock.calls.every(([tool]) => ['browser_cart_get', 'browser_state_get'].includes(tool.name))).toBe(true)
})

it.each([
  ['開始點餐', undefined, '櫃台取餐', false],
  ['我要 A1 桌，開始點餐', undefined, 'A1 桌', true],
  ['我要 A 一桌，開始點餐', undefined, 'A1 桌', true],
  ['我要 A10 桌，開始點餐', undefined, 'A1 桌', false],
  ['開始點餐', 'A1 桌', 'A1 桌', true],
  ['我要櫃台取餐，開始點餐', undefined, '櫃台取餐', true],
] as const)('admits menu entry only for an explicit or verified table: %s / %s / %s', async (utterance, selectedTable, name, allowed) => {
  const { client, begin, context } = setup()
  begin(utterance)
  const start = { ...context, name: 'browser_start_ordering' }
  const entry = { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'A1 桌'], selectedTable, customerMessage: '請先選桌。' }
  client.execute.mockImplementation(async tool => ['browser_cart_get', 'browser_state_get'].includes(tool.name) ? entry : { ok: true, code: 'table-entry-starting' })
  const state = await readBrowserConversation(client, 'table-start', ['browser_cart_get', 'browser_table_select', 'browser_start_ordering', 'browser_cart_add'])
  expect(state.selectedTable).toBe(selectedTable)
  expect(state.allowedToolNames).toEqual(['browser_cart_get', 'browser_table_select', 'browser_start_ordering'])
  const result = await executeBrowserCartTool(client, start, { name })
  expect(result).toMatchObject(allowed ? { code: 'table-entry-starting' } : { status: 'clarification', effect: 'none' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === 'browser_start_ordering')).toHaveLength(allowed ? 1 : 0)
})

it.each(['開始點餐', '好', '好的，開始點餐', '對', '櫃台取餐，開始點餐', '開始點餐，還要乙餐一份'])('ends only a fully covered standalone entry request: %s', async (utterance) => {
  const { client, context, dialogue, decide } = setup()
  const complete = vi.fn()
  release.push(beginBrowserCartTask(utterance, { dialogue, decide, isCurrent: () => true, onRequestComplete: complete }))
  client.execute.mockImplementation(async tool => tool.name === 'browser_cart_get'
    ? { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐'], selectedTable: '櫃台取餐', customerMessage: '請開始點餐。' }
    : { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable: '櫃台取餐', customerMessage: '正在進入菜單。' })
  expect(await executeBrowserCartTool(client, { ...context, name: 'browser_start_ordering' }, { name: '櫃台取餐' })).toMatchObject({ code: 'table-entry-starting' })
  expect(complete).toHaveBeenCalledTimes(utterance === '開始點餐，還要乙餐一份' ? 0 : 1)
})

it('treats 加點 as navigation and retires an old quantity question without dispatching a cart write', async () => {
  const { client, begin, dialogue, facts, context, decide } = setup()
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  begin('我要加點')
  const navigation = { ...context, name: 'browser_return_menu' }
  const original = client.execute.getMockImplementation()!
  client.execute.mockImplementation((tool, input) => tool.name === navigation.name
    ? Promise.resolve({ ok: true, source: 'browser', page: 'menu', effect: 'none', cart: facts.cart })
    : original(tool, input))
  expect(await executeBrowserCartTool(client, navigation, {})).toMatchObject({ page: 'menu', effect: 'none' })
  expect(dialogue.hasPending()).toBe(false)
  expect(client.execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_return_menu'])
  expect(decide).not.toHaveBeenCalled()
})

function setup(labels: { name: string, aliases: string[], category: string }[] = []) {
  const state = { owner: 'customer', document: 'document' }
  const answer = vi.fn<(input: BrowserAnswer) => Promise<AnswerDecision>>(async () => ({ kind: 'ANSWER', choiceId: 'product:2', provider: 'system-one' }))
  const dialogue = createBrowserDialogue({ owner: () => state.owner, documentId: () => state.document, answer, catalogLabels: () => labels })
  const cartLines: CartLine[] = []
  const facts = { ok: true, source: 'browser', page: 'menu', dataOnly: true, cart: { version: 'cart', lines: cartLines }, products: ['甲餐', '乙餐'].map((name, index) => ({ ref: `p-${index}`, name, price: 10 + index, configurations: [{ version: `config-${index}`, variantRef: '', name, unitPrice: 10 + index, groups: [] }] })) }
  const context: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const add = { ...context, name: 'browser_cart_add' }
  const clarify = { ...context, name: 'browser_clarify_product' }
  const present = { ...context, name: 'browser_present' }
  const execute = vi.fn(async (tool: ServiceTool, input: Record<string, unknown>): Promise<unknown> => {
    if (tool.name === context.name || tool.name === 'browser_state_get')
      return facts
    if (tool.name === 'browser_return_menu')
      return { ok: true, source: 'browser', page: 'menu', cart: facts.cart }
    if (tool.name === present.name)
      return { ok: true, source: 'browser', presentation: { cue: 'shown', products: facts.products.filter(product => Array.isArray(input.productRefs) && input.productRefs.includes(product.ref)).map(({ ref, name, price }) => ({ ref, name, price })) } }
    return { ok: true, source: 'browser', status: 'verified', cart: { version: 'after-add' } }
  })
  const client = { tools: readonly(shallowRef([context, { ...context, name: 'browser_state_get' }, add, clarify, present, { ...context, name: 'browser_product_get' }])), execute }
  const decide = vi.fn<(proposal: BrowserEffect) => Promise<EffectDecision>>(async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }))
  const onRequestComplete = vi.fn()
  const begin = (text: string, jev = false) => release.push(beginBrowserCartTask(text, { ...(jev ? { intentSource: 'jev' as const } : {}), dialogue, decide, onRequestComplete, isCurrent: () => true }))
  return { state, answer, dialogue, facts, client, context, add, clarify, present, begin, decide, onRequestComplete }
}

// Report: this chat, Nov11; Main reissued the alias question after 對, then tried
// to add one invented serving after 是 without consuming the pending question.
it.each(['browser_clarify_product', 'browser_product_get', 'browser_cart_add'])('resolves the pending product answer before Main can bypass it with %s', async (name) => {
  const { dialogue, facts, answer, client, context, begin } = setup()
  dialogue.presentProducts(facts, '乙餐', '我想吃乙餐')
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'product:1', provider: 'main' })
  begin('對')
  const result = await executeBrowserCartTool(client, { ...context, name }, { query: '乙餐', names: ['乙餐'], quantity: 1 })
  expect(result).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-order-quantity', question: '請問「乙餐」要幾份？' } })
  expect(answer).toHaveBeenCalledOnce()
  expect(client.execute.mock.calls.every(([tool]) => [context.name, 'browser_present'].includes(tool.name))).toBe(true)
  expect(client.execute.mock.calls.find(([tool]) => tool.name === 'browser_present')?.[1]).toEqual({ productRefs: ['p-1'], mode: 'information' })
  expect(dialogue.hasPending()).toBe(true)
})

it('collects a missing serving count and admits the complete purchase without another question', async () => {
  const { dialogue, facts, client, context, add, begin, answer } = setup()
  begin('我想吃乙餐')
  expect(await executeBrowserQuantityQuestion(client, { productRef: 'p-1' })).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-order-quantity' } })
  begin('兩份')
  const selected = await executeBrowserCartTool(client, context, { includeCatalog: true })
  expect(selected).toMatchObject({ selectedProduct: { name: '乙餐' }, requestedQuantity: 2, originalRequest: '我想吃乙餐' })
  expect(answer).not.toHaveBeenCalled()
  const proposal = { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } }
  expect(await executeBrowserCartTool(client, add, { ...proposal, quantity: 2 })).toMatchObject({ status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
  expect(dialogue.hasPending()).toBe(false)
  expect(facts.cart.lines).toHaveLength(0)
})

it('does not turn a yes to a quantity question into one serving', async () => {
  const { dialogue, facts, begin, client, context, answer } = setup()
  dialogue.presentQuantity(facts, 'p-1', '我想吃乙餐')
  answer.mockResolvedValueOnce({ kind: 'UNCERTAIN', provider: 'main' })
  begin('對')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-order-quantity' } })
})

it('rejects a numeric slot if the cart changes before it is consumed', async () => {
  const { dialogue, facts } = setup()
  dialogue.presentQuantity(facts, 'p-1', '我想吃乙餐')
  const result = await dialogue.answer(facts, '兩份', async () => ({ ...facts, cart: { ...facts.cart, version: 'changed' } }), () => true)
  expect(result).toMatchObject({ kind: 'receipt', result: { ok: false, status: 'rejected' } })
})

// Report: live Main replay in this chat, Nov11; selection.version was repeatedly
// omitted while regenerating a fully confirmed proposal, exhausting the tool budget.
it('executes the saved complete confirmation without asking Main to rebuild internal versions', async () => {
  const { dialogue, facts, client, context, add, begin, answer, onRequestComplete } = setup()
  const proposal = { version: 'cart', productRef: 'p-1', quantity: 2, unitPrice: 11, note: '飯少', selection: { version: 'config-1', variantRef: '', choices: [] } }
  dialogue.presentAddition(facts, proposal)
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'confirm', provider: 'main' })
  begin('對')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).toHaveProperty('confirmedAddition')
  expect(await executeBrowserConfirmedAddition(client)).toMatchObject({ status: 'verified' })
  expect(client.execute).toHaveBeenLastCalledWith(add, proposal)
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
  expect(onRequestComplete).toHaveBeenCalledOnce()
})

// Report: live Main/Jev comparison in this chat, Nov11; Main attached a cart
// version to the argument-free confirmation command after customer assent.
it('executes only the saved proposal when a model attaches unrelated confirmation arguments', async () => {
  const { dialogue, facts, client, context, add, begin, answer } = setup()
  const proposal = { version: 'cart', productRef: 'p-1', quantity: 2, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } }
  dialogue.presentAddition(facts, proposal)
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'confirm', provider: 'main' })
  begin('對')
  await executeBrowserCartTool(client, context, { includeCatalog: true })
  // Invoke the public JS boundary as a model runtime does: excess fields must
  // neither replace sealed values nor become a second source of write authority.
  expect(await Reflect.apply(executeBrowserConfirmedAddition, undefined, [client, { version: 'invented', quantity: 99 }])).toMatchObject({ status: 'verified' })
  expect(client.execute).toHaveBeenLastCalledWith(add, proposal)
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
})

it('does not authorize a confirmation command from model arguments without customer assent', async () => {
  const { client, add, begin } = setup()
  begin('我要乙餐兩份')
  expect(await Reflect.apply(executeBrowserConfirmedAddition, undefined, [client, { version: 'cart', productRef: 'p-1', quantity: 2 }])).toMatchObject({ ok: false, status: 'rejected', effect: 'none' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
})

// Report: this chat, Nov11; 我想吃虱目魚 became an unrelated full-menu choice.
it('reports an absent requested product without replacing it with unrelated menu candidates', () => {
  const { dialogue, facts } = setup()
  dialogue.presentProducts(facts, '餐', '餐一份')
  const result = dialogue.presentProducts(facts, '虱目魚', '我想吃虱目魚')
  expect(result.customerMessage).toContain('沒有找到「虱目魚」')
  expect(result.customerMessage).not.toContain('甲餐')
  expect(result.customerMessage).not.toContain('乙餐')
  expect(result).not.toHaveProperty('pendingCustomerChoice')
  expect(result).not.toHaveProperty('presentationRefs')
  expect(dialogue.hasPending()).toBe(false)
})

it('does not substitute other bentos when only a generic meal suffix matches the missing dish', () => {
  const { dialogue, facts } = setup()
  facts.products[0].name = '雞腿便當'
  facts.products[1].name = '排骨便當'
  const result = dialogue.presentProducts(facts, '虱目魚便當', '我想吃虱目魚便當')
  expect(result.customerMessage).toContain('沒有找到「虱目魚便當」')
  expect(result.customerMessage).not.toContain('雞腿')
  expect(result.customerMessage).not.toContain('排骨')
  expect(result).not.toHaveProperty('pendingCustomerChoice')
})

it('does not claim a product is absent just because its configuration is unavailable for spoken selection', () => {
  const { dialogue, facts } = setup()
  facts.products[0].name = '虱目魚便當'
  facts.products[0].configurations = []
  const result = dialogue.presentProducts(facts, '虱目魚', '我想吃虱目魚')
  expect(result.customerMessage).toContain('虱目魚')
  expect(result.customerMessage).not.toContain('沒有找到')
  expect(result).not.toHaveProperty('pendingCustomerChoice')
  expect(result).not.toHaveProperty('presentationRefs')
})

it('keeps a multi-name lookup miss instead of offering the entire catalog as a substitute', async () => {
  const { client, context, begin, dialogue } = setup()
  const lookup = { ...context, name: 'browser_product_get' }
  const missing = { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前完整分類資料沒有找到「虱目魚」，請確認名稱。' }
  client.execute.mockResolvedValueOnce(missing)
  begin('甲餐和虱目魚各一份')
  expect(await executeBrowserCartTool(client, lookup, { names: ['甲餐', '虱目魚'] })).toEqual(missing)
  expect(client.execute).toHaveBeenCalledOnce()
  expect(dialogue.hasPending()).toBe(false)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S04/S12.
it('passes admitted current-cart labels to the answer resolver without sending executable row identities', async () => {
  const { dialogue, facts, answer, begin, client, context, add } = setup()
  facts.cart.lines.push({ ref: 'line-rice', productRef: 'p-0', name: '甲餐', quantity: 1, unitPrice: 15, configuration: 'rice-one', description: '白飯 ×1', note: '' })
  dialogue.presentProducts(facts, '餐', '再看一下其他餐點')
  answer.mockResolvedValueOnce({ kind: 'NEW_REQUEST', provider: 'main' })
  begin('把加白飯的那份取消')
  await executeBrowserCartTool(client, context, { includeCatalog: true })
  expect(answer).toHaveBeenCalledWith(expect.objectContaining({ transcript: '把加白飯的那份取消', cartContext: { version: 'cart', lines: [{ name: '甲餐', quantity: 1, description: '白飯 ×1', note: '' }] } }))
  expect(answer.mock.calls[0][0].cartContext?.lines[0]).not.toHaveProperty('ref')
  expect(answer.mock.calls[0][0].cartContext?.lines[0]).not.toHaveProperty('productRef')
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S13.

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S03/S13.
it('does not turn a denied issued-plan claim into a purchase confirmation or write', async () => {
  const { client, add, begin, decide } = setup()
  decide.mockResolvedValueOnce({ choice: 'CLARIFY', provider: 'unavailable' })
  begin('餐一份有嗎')
  const result = await executeBrowserCartTool(client, add, { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } })
  expect(result).toMatchObject({ status: 'clarification', effect: 'none' })
  expect(result).not.toHaveProperty('pendingCustomerChoice')
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
})

it('selects the original second product and admits its requested count once without another confirmation', async () => {
  const { client, context, add, clarify, facts, begin, decide } = setup()
  begin('餐一份')
  expect(await executeBrowserCartTool(client, clarify, { query: '餐' })).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-product-choice' } })
  facts.products.reverse()
  begin('第二個')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).toMatchObject({ selectedProduct: { productRef: 'p-1', name: '乙餐' } })
  const proposal = { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } }
  expect(await executeBrowserCartTool(client, add, proposal)).toMatchObject({ status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
  expect(decide).toHaveBeenCalledOnce()
  facts.cart.version = 'after-add'
  decide.mockResolvedValueOnce({ choice: 'CLARIFY', provider: 'unavailable' })
  begin('對')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).not.toHaveProperty('confirmedAddition')
  expect(await executeBrowserCartTool(client, add, { ...proposal, version: 'after-add' })).toMatchObject({ effect: 'none' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
})

it.each(['owner', 'document', 'cart', 'configuration', 'price'])('revokes an answer if %s changes during semantic IO', async (change) => {
  const { state, answer, facts, dialogue } = setup()
  dialogue.presentProducts(facts, '餐', '餐一份')
  answer.mockImplementationOnce(async () => {
    if (change === 'owner')
      state.owner = 'new-customer'
    if (change === 'document')
      state.document = 'new-document'
    if (change === 'cart')
      facts.cart.version = 'changed'
    if (change === 'configuration')
      facts.products[0].configurations[0].version = 'changed'
    if (change === 'price')
      facts.products[0].price = 999
    return { kind: 'ANSWER', choiceId: 'product:2', provider: 'system-one' }
  })
  expect(await dialogue.answer(facts, '第二個', async () => facts, () => true)).toMatchObject({ kind: 'receipt', result: { status: 'rejected', effect: 'none' } })
})

it('cancels or supersedes a pending question without a cart write', async () => {
  const { dialogue, facts, answer } = setup()
  dialogue.presentProducts(facts, '餐', '餐一份')
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'cancel', provider: 'system-one' })
  expect(await dialogue.answer(facts, '不要', async () => facts, () => true)).toMatchObject({ kind: 'receipt', result: { effect: 'none', customerMessage: expect.stringContaining('取消') } })
  expect(await dialogue.answer(facts, '對', async () => facts, () => true)).toBeUndefined()
  dialogue.presentProducts(facts, '餐', '餐一份')
  answer.mockResolvedValueOnce({ kind: 'NEW_REQUEST', provider: 'main' })
  expect(await dialogue.answer(facts, '乙餐兩份', async () => facts, () => true)).toBeUndefined()
  expect(await dialogue.answer(facts, '第二個', async () => facts, () => true)).toBeUndefined()
})

it('carries a correction as context and executes its newly admitted complete plan without repeating confirmation', async () => {
  const { dialogue, facts, answer, client, context, add, begin } = setup()
  const proposal = { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } }
  dialogue.presentAddition(facts, proposal)
  answer.mockResolvedValueOnce({ kind: 'NEW_REQUEST', provider: 'main' })
  begin('對，但改兩份')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).toMatchObject({ previousProposal: { quantity: 1 } })
  expect(await executeBrowserCartTool(client, add, { ...proposal, quantity: 2 })).toMatchObject({ status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
})

it('retains the current question without authority after answer service failure', async () => {
  const { dialogue, facts, answer } = setup()
  dialogue.presentProducts(facts, '餐', '餐一份')
  answer.mockRejectedValueOnce(new Error('offline'))
  expect(await dialogue.answer(facts, '第二個', async () => facts, () => true)).toMatchObject({ kind: 'receipt', result: { effect: 'none', pendingCustomerChoice: { purpose: 'browser-product-choice' } } })
})

it('cannot turn a generic acknowledgement into a reply that bypasses the pending product question', async () => {
  const { dialogue, facts, begin, client, answer } = setup()
  dialogue.presentProducts(facts, '餐', '餐一份')
  begin('第二個')
  expect(await executeBrowserReply(client, 'acknowledgement')).toMatchObject({ selectedProduct: { productRef: 'p-1' } })
  expect(answer).toHaveBeenCalledOnce()
  expect(client.execute.mock.calls.some(([tool]) => tool.name === 'browser_cart_add')).toBe(false)
})

// Report: this chat, 2026-10-30; an invalid Main add proposal ended a selected-product turn with a generic tool error.
it.each(['stale-version', 'wrong-price', 'missing-selection'])('returns a repairable pre-effect proposal error after selecting a product: %s', async (invalid) => {
  const { client, context, add, clarify, begin } = setup()
  begin('餐一份')
  await executeBrowserCartTool(client, clarify, { query: '餐' })
  begin('第二個')
  await executeBrowserCartTool(client, context, { includeCatalog: true })
  const input = { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: invalid === 'wrong-price' ? 99 : 11, note: '', ...(invalid === 'missing-selection' ? {} : { selection: { version: invalid === 'stale-version' ? 'cart' : 'config-1', variantRef: '', choices: [] } }) }
  expect(await executeBrowserCartTool(client, add, input)).toMatchObject({ status: 'proposal_rejected', effect: 'none', dataOnly: true })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  expect(await executeBrowserCartTool(client, add, { ...input, unitPrice: 11, selection: { version: 'config-1', variantRef: '', choices: [] } })).toMatchObject({ status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
})

// Report: this chat, Nov1 v2; a genuinely uncertain Jev operation was mislabeled
// as an inquiry and Main retried cart writes instead of asking for confirmation.
it('can ask a sealed addition question on uncertain meaning without granting write authority', async () => {
  const { client, add, dialogue, decide } = setup()
  release.push(beginBrowserCartTask('我要甲餐一份', { readOnly: true, clarifyOrder: true, dialogue, decide, isCurrent: () => true }))
  const result = await executeBrowserCartTool(client, add, { version: 'cart', productRef: 'p-0', quantity: 1, unitPrice: 10, note: '', selection: { version: 'config-0', variantRef: '', choices: [] } })
  expect(result).toMatchObject({ effect: 'none', pendingCustomerChoice: { purpose: 'browser-confirm-add' } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  expect(decide).not.toHaveBeenCalled()
})

it('never turns an information-only price inquiry into an addition confirmation', async () => {
  const { client, add, dialogue, decide } = setup()
  release.push(beginBrowserCartTask('甲餐一份多少錢', { readOnly: true, dialogue, decide, isCurrent: () => true }))
  expect(await executeBrowserCartTool(client, add, { version: 'cart', productRef: 'p-0', quantity: 1, unitPrice: 10, note: '', selection: { version: 'config-0', variantRef: '', choices: [] } })).toMatchObject({ effect: 'none', status: 'rejected' })
  expect(dialogue.hasPending()).toBe(false)
  expect(client.execute).not.toHaveBeenCalled()
  expect(decide).not.toHaveBeenCalled()
})

// Report: output/playwright/pb-electron/restored-S06-nov4-r2.json; nonformal names need related choices.
it.each(['', '香煎鱈魚飯'])('discovers current product fragments for confirmation without authorizing an addition (query=%j)', (query) => {
  const { dialogue, facts } = setup()
  facts.products[0].name = '青醬雞肉便當'
  facts.products[1].name = '香煎鱈魚便當'
  const result = dialogue.presentProducts(facts, query, '香煎鱈魚飯一份')
  expect(result).toMatchObject({ effect: 'none', presentationRefs: ['p-1'] })
  expect(result.customerMessage).toContain('香煎鱈魚便當')
  expect(result.customerMessage).not.toContain('青醬雞肉便當')
})

it('keeps all related options when the customer only names the shared meal category', () => {
  const { dialogue, facts } = setup()
  facts.products[0].name = '青醬雞肉便當'
  facts.products[1].name = '香煎鱈魚便當'
  expect(dialogue.presentProducts(facts, '', '便當一份')).toMatchObject({ effect: 'none', presentationRefs: ['p-0', 'p-1'] })
})

// Report: S13-nov4-discovery-4: replacement aliases reached a plain full-catalog fallback.

// Report: S13-nov4-review-2 took exact product lookup instead of the existing clarification tool.
it('converts an unresolved exact lookup into related current-product confirmation without a write', async () => {
  const { facts, dialogue, client, context, present, begin, decide } = setup()
  facts.products[0].name = '青醬雞肉便當'
  facts.products[1].name = '香煎鱈魚便當'
  const lookup = { ...context, name: 'browser_product_get' }
  const execute = client.execute.getMockImplementation()!
  client.execute.mockImplementation(async (tool, input) => tool.name === lookup.name ? { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '正式名稱未找到' } : execute(tool, input))
  begin('香煎鱈魚飯一份')
  const result = await executeBrowserCartTool(client, lookup, { names: ['香煎鱈魚飯'] })
  expect(result).toMatchObject({ effect: 'none', presentationRefs: ['p-1'], pendingCustomerChoice: expect.objectContaining({ purpose: 'browser-product-choice' }) })
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('香煎鱈魚便當'))
  expect(result).toHaveProperty('customerMessage', expect.not.stringContaining('青醬雞肉便當'))
  expect(client.execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_product_get', 'browser_cart_get', present.name])
  expect(decide).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(true)
})

// Report: this chat, Nov12 live S01/S02; the new draft accepted only the original request, not its bound quantity answer.
it('keeps quantity-answer evidence separate from the original request when collecting a selected dish', async () => {
  const { dialogue, facts, begin, client, context, add, decide } = setup()
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  begin('兩份')
  await executeBrowserCartTool(client, context, { includeCatalog: true })
  const completed = await executeBrowserOrderDraft(client, { lines: [{ productRef: 'p-1', evidence: '兩份', quantity: 2, choices: [], askGroups: [], note: '' }] })
  expect(completed, JSON.stringify({ completed, checks: decide.mock.calls })).toMatchObject({ ok: true, status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
})

// Report: this chat, 2026-11-14 — exact named replies repeated the same product question.
it('consumes an exact product-name reply once without calling a model to choose again', async () => {
  const { dialogue, facts, answer } = setup()
  dialogue.presentProducts(facts, '餐', '我要餐一份')
  expect(await dialogue.answer(facts, '乙餐', async () => facts, () => true)).toMatchObject({ kind: 'product', product: { name: '乙餐' }, request: '我要餐一份' })
  expect(answer).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(false)
})

// Report: this chat, 2026-11-14 — 排骨便當 fell back to every bento because 便當 was the longest contiguous match.
it('keeps a distinctive contained dish name instead of broadening to all bentos', () => {
  const { dialogue, facts } = setup()
  facts.products[0].name = '炸雞腿便當'
  facts.products[1].name = '炸排骨便當'
  facts.products[0].configurations[0].name = '炸雞腿便當'
  facts.products[1].configurations[0].name = '炸排骨便當'
  expect(dialogue.presentProducts(facts, '排骨便當', '我要一份排骨便當')).toMatchObject({ presentationRefs: ['p-1'], customerMessage: expect.stringContaining('炸排骨便當') })
})

// Report: this chat, 2026-11-14 — delivery and takeaway must not be confused with missing tables.
it.each(['我要外帶', '我要自取', '我要外送'])('handles the actual table-page service request: %s', async (utterance) => {
  const { client, begin, context } = setup()
  begin(utterance)
  const native = { ...context, name: 'browser_table_select' }
  client.execute.mockImplementation(async tool => tool.name === 'browser_cart_get'
    ? { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'B3 吧檯'], customerMessage: '請選桌。' }
    : { ok: true, source: 'browser', selectedTable: '櫃台取餐' })
  const result = await executeBrowserCartTool(client, native, { name: '櫃台取餐' })
  if (utterance === '我要外送') {
    expect(result).toMatchObject({ customerMessage: expect.stringContaining('沒有外送') })
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === native.name)).toHaveLength(0)
  }
  else {
    expect(result).toMatchObject({ selectedTable: '櫃台取餐' })
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === native.name)).toHaveLength(1)
  }
})

// Report: this chat, 2026-11-14 — a missing quantity is a question, not a rejected cart write.
it('can ask quantity for an explicit named item without granting cart-write authority', async () => {
  const { client, dialogue, decide } = setup()
  release.push(beginBrowserCartTask('乙餐', { dialogue, decide, readOnly: true, clarifyOrder: true, isCurrent: () => true }))
  expect(await executeBrowserQuantityQuestion(client, { productRef: 'p-1' })).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-order-quantity' } })
  expect(decide).not.toHaveBeenCalled()
})

// Report: this chat, 2026-11-14 — a fully specified purchase looped after the official-name answer.
it('completes an original quantity plus exact named choice once, even when the short reply was routed read-only', async () => {
  const labels = [{ name: '炸排骨便當', aliases: ['排骨便當'], category: '' }]
  const { client, facts, dialogue, decide } = setup(labels)
  facts.products[1].name = '炸排骨便當'
  facts.products[1].configurations[0].name = '炸排骨便當'
  dialogue.presentProducts(facts, '排骨便當', '我要一份排骨便當')
  release.push(beginBrowserCartTask('炸排骨便當', { dialogue, decide, readOnly: true, isCurrent: () => true, catalogLabels: () => labels }))
  const complete = await prepareBrowserQuestionAnswer(client)
  expect(complete).toBeTypeOf('function')
  expect(await complete!()).toMatchObject({ ok: true, status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(client.execute.mock.calls.find(([tool]) => tool.name === 'browser_cart_add')?.[1]).toMatchObject({ productRef: 'p-1', quantity: 1 })
  expect(await complete!()).toMatchObject({ ok: false, effect: 'none' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(decide).not.toHaveBeenCalled()
})

// Report: this chat, 2026-11-14 — entering a menu produced status prose but no ordering guidance.
it('waits for the native menu before replacing the entry acknowledgement with ordering guidance', async () => {
  const { client, begin, context } = setup()
  begin('開始點餐')
  let entered = false
  client.execute.mockImplementation(async tool => tool.name === 'browser_cart_get'
    ? entered ? { ok: true, source: 'browser', page: 'menu', menuReady: true, cart: { version: 'cart-ready', lines: [], tableName: 'A2' } } : { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['A2'], selectedTable: 'A2', customerMessage: '請開始。' }
    : { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable: 'A2', customerMessage: '正在準備菜單。' })
  const ready = Promise.withResolvers<void>()
  const waitUntilReady = vi.fn(() => ready.promise)
  const settled = vi.fn()
  const pending = executeBrowserCartTool({ ...client, waitUntilReady }, { ...context, name: 'browser_start_ordering' }, { name: 'A2' }).then((result) => {
    settled()
    return result
  })
  await vi.waitFor(() => expect(waitUntilReady).toHaveBeenCalledOnce())
  expect(settled).not.toHaveBeenCalled()
  entered = true
  ready.resolve()
  expect(await pending).toMatchObject({ customerMessage: expect.stringContaining('菜單準備好了，想吃什麼') })
})

// Report: this chat, 2026-11-14 — finite cancellation closed PB but left the Host's quantity question alive.
it('retires the pending question and abandoned search when the finite close tool is selected', async () => {
  const { client, dialogue, facts, begin, context } = setup()
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  begin('不要了')
  const close = { ...context, name: 'browser_close_product' }
  const search = { ...context, name: 'browser_search' }
  const native = client.execute.getMockImplementation()!
  client.execute.mockImplementation((tool, input) => [close.name, search.name].includes(tool.name)
    ? Promise.resolve({ ok: true, source: 'browser', effect: 'none', customerMessage: '已回到完整菜單。' })
    : native(tool, input))
  const bound = { tools: readonly(shallowRef([...client.tools.value, close, search])), execute: client.execute }
  expect(await executeBrowserCartTool(bound, close, {})).toMatchObject({ ok: true })
  expect(dialogue.hasPending()).toBe(false)
  expect(client.execute.mock.calls.find(([tool]) => tool.name === search.name)?.[1]).toEqual({ query: '' })
  expect(client.execute.mock.calls.some(([tool]) => tool.name === 'browser_cart_remove')).toBe(false)
})

// Report: this chat, 2026-11-14 — returning to menu should end the navigation demand, including ASR punctuation.
it.each(['回到菜單', '請幫我回到菜單。'])('finishes a verified standalone menu return without another menu listing: %s', async (text) => {
  const { client, context, onRequestComplete, begin } = setup()
  begin(text, true)
  expect(await executeBrowserCartTool(client, { ...context, name: 'browser_return_menu' }, {})).toMatchObject({ ok: true })
  expect(onRequestComplete).toHaveBeenCalledOnce()
})

// Report: this chat, Nov14 — Jev-selected answers are semantic, not a literal phrase whitelist.
it('executes a Jev-selected semantic confirmation using the sealed meal exactly once', async () => {
  const { dialogue, facts, answer, client, begin } = setup()
  dialogue.presentAddition(facts, { productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } })
  answer.mockResolvedValue({ kind: 'ANSWER', choiceId: 'confirm', provider: 'system-one' })
  begin('那就幫我放進去吧', true)
  const prepared = await prepareBrowserQuestionAnswer(client)
  expect(prepared).toBeTypeOf('function')
  expect(await prepared!()).toMatchObject({ status: 'verified' })
  expect(answer).toHaveBeenCalledOnce()
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(dialogue.hasPending()).toBe(false)
})

// Report: this chat, Nov14; document ready was announced while the menu was blank.
it('does not announce menu ready when the replacement document has no menu evidence', async () => {
  const { client, begin, context } = setup()
  begin('開始點餐')
  let entered = false
  client.execute.mockImplementation(async (tool) => {
    if (tool.name === 'browser_cart_get')
      return entered ? { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['A2'], selectedTable: 'A2', customerMessage: '請開始。' } : { ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['A2'], selectedTable: 'A2', customerMessage: '請開始。' }
    entered = true
    return { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable: 'A2', customerMessage: '正在準備菜單。' }
  })
  const result = await executeBrowserCartTool({ ...client, waitUntilReady: async () => {} }, { ...context, name: 'browser_start_ordering' }, { name: 'A2' })
  expect(result).toMatchObject({ ok: false, effect: 'none' })
  expect(result).not.toMatchObject({ customerMessage: expect.stringContaining('菜單準備好了') })
})

// Cross-tool audit: refusing a write proposed for a price inquiry is not a new customer question.
it.each(['draft', 'confirm'])('keeps a read-only %s refusal available for model correction instead of issuing a question', async (operation) => {
  const { client, dialogue, decide } = setup()
  release.push(beginBrowserCartTask('甲餐一份多少錢', { readOnly: true, dialogue, decide, isCurrent: () => true }))
  const result = operation === 'draft' ? await executeBrowserOrderDraft(client, {}) : await executeBrowserConfirmedAddition(client)
  expect(result).toMatchObject({ ok: true, status: 'proposal_rejected', effect: 'none', dataOnly: true })
  expect(result).not.toHaveProperty('pendingCustomerChoice')
  expect(client.execute).not.toHaveBeenCalled()
})

it('returns a real waiting state when a reply is guarded by the current table page', async () => {
  const { client, begin } = setup()
  begin('a9')
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'A1 桌'], selectedTable: 'A1 桌', customerMessage: '目前選擇A1 桌。' })
  await readBrowserConversation(client, 'table-reply', ['reply_to_customer'])
  expect(await executeBrowserReply(client, 'clarification')).toMatchObject({ status: 'clarification', effect: 'none', customerMessage: expect.stringContaining('A9') })
})

// Report: this chat, 2026-11-15; pork follow-up was incorrectly interpreted as changing chicken quantity.
it('binds three servings to the explicitly offered pork instead of the prior chicken checkout', async () => {
  const { begin, client, dialogue, facts, answer } = setup()
  facts.products[0].name = '炸雞腿便當'
  facts.products[1].name = '炸排骨便當'
  const checkout = dialogue.presentService(facts, { purpose: 'review-checkout', request: '炸雞腿便當一份', question: '要結帳嗎？', choices: [{ id: 'yes', description: '打開購物車' }, { id: 'no', description: '繼續點餐' }] })
  begin('炸排骨便當呢？')
  const introduced = await askBrowserCustomerQuestion(client, { questionType: 'purchase-recommendation', name: '炸排骨便當', quantity: 1 })
  expect(introduced).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-service-question', question: '要來一份炸排骨便當嗎？' } })
  expect(dialogue.conversation(facts).waitingFor?.questionId).not.toBe(checkout.pendingCustomerChoice.questionId)
  expect(client.execute.mock.calls.some(([tool]) => tool.name === 'browser_cart_add')).toBe(false)
  const selected = await dialogue.answer(facts, '3份', async () => facts, () => true)
  expect(selected).toMatchObject({ kind: 'product', product: { productRef: 'p-1', name: '炸排骨便當' }, requestedQuantity: 3, orderSelection: true })
  expect(answer).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(false)
})

// Report: this chat, 2026-11-15; Jev must not ask another model to judge the choice it just selected.
it('consumes Jev’s already selected current answer without another model call', async () => {
  const { dialogue, facts, answer } = setup()
  const shown = dialogue.presentService(facts, { purpose: 'review-checkout', request: '乙餐一份', question: '要結帳嗎？', choices: [{ id: 'yes', description: '打開購物車' }, { id: 'no', description: '繼續點餐' }] })
  const result = await dialogue.answer(facts, '那就往下一步吧', async () => facts, () => true, 7, { selectedAnswer: { questionId: shown.pendingCustomerChoice.questionId, choiceId: 'yes' } })
  expect(result).toEqual({ kind: 'review-cart' })
  expect(answer).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(false)
})
it.each(['wrong-question', 'wrong-choice'])('rejects an obsolete selected answer (%s) without a model fallback or consumption', async (scenario) => {
  const { dialogue, facts, answer } = setup()
  const shown = dialogue.presentService(facts, { purpose: 'review-checkout', request: '乙餐一份', question: '要結帳嗎？', choices: [{ id: 'yes', description: '打開購物車' }, { id: 'no', description: '繼續點餐' }] })
  const result = await dialogue.answer(facts, '那就往下一步吧', async () => facts, () => true, 7, { selectedAnswer: { questionId: scenario === 'wrong-question' ? 'old-question' : shown.pendingCustomerChoice.questionId, choiceId: scenario === 'wrong-choice' ? 'other' : 'yes' } })
  expect(result).toMatchObject({ kind: 'receipt', result: { status: 'rejected', effect: 'none' } })
  expect(answer).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(true)
})
it('routes the first unresolved answer in a Main turn to Main explicitly', async () => {
  const { dialogue, facts, answer } = setup()
  const shown = dialogue.presentService(facts, { purpose: 'review-checkout', request: '乙餐一份', question: '要結帳嗎？', choices: [{ id: 'yes', description: '打開購物車' }, { id: 'no', description: '繼續點餐' }] })
  await dialogue.answer(facts, '那就往下一步吧', async () => facts, () => true)
  expect(answer).toHaveBeenCalledWith(expect.objectContaining({ questionId: shown.pendingCustomerChoice.questionId, decisionSource: 'main' }))
})

// Report: this chat, Nov16 — segmented phones must stay in one bound checkout step.
it('keeps phone fragments out of unrelated questions and retires them on a cart change', async () => {
  const { dialogue, facts } = setup()
  dialogue.presentService(facts, { purpose: 'notification-details', request: '通知手機', question: '請報通知手機', choices: [] })
  const first = await dialogue.answer(facts, '0912', async () => facts, () => true)
  expect(first).toMatchObject({ kind: 'receipt', result: { customerMessage: expect.stringContaining('4 碼') } })
  facts.cart.version = 'changed'
  expect(dialogue.canAnswerLocally(facts, '345')).toBe(false)
  expect(await dialogue.answer(facts, '345', async () => facts, () => true)).toBeUndefined()
  dialogue.presentService(facts, { purpose: 'cart-review', request: '核對', question: '正確嗎？', choices: [{ id: 'yes', description: '是' }, { id: 'no', description: '否' }] })
  expect(dialogue.canAnswerLocally(facts, '0912')).toBe(false)
})

it('accepts spoken digits, supports restarting, and rejects overflow without truncating a phone', async () => {
  const { dialogue, facts } = setup()
  dialogue.presentService(facts, { purpose: 'notification-details', request: '通知手機', question: '請報通知手機', choices: [] })
  const say = async (text: string) => {
    const result = await dialogue.answer(facts, text, async () => facts, () => true)
    if (result?.kind !== 'receipt' || !('customerMessage' in result.result))
      throw new Error('Expected a bound phone prompt.')
    return result.result.customerMessage
  }
  expect(await say('零九一二')).toContain('4 碼')
  expect(await say('3456789')).toContain('格式不正確')
  expect(await say('0987')).toContain('4 碼')
  expect(await say('重來')).toContain('重新報')
  expect(await say('零九一二，三四五，六七八')).toContain('0 9 1 2 3 4 5 6 7 8')
  const denied = await dialogue.answer(facts, '不對', async () => facts, () => true)
  expect(denied).toMatchObject({ kind: 'receipt', result: { customerMessage: expect.stringContaining('重新報') } })
  dialogue.reset()
  expect(dialogue.canAnswerLocally(facts, '正確')).toBe(false)
})

// Report: this chat, Nov17 cases 6/11 — Main context must not parse a result page as an empty cart.
it('provides fresh order facts to Main and keeps payment replies read-only', async () => {
  const { client, begin } = setup()
  begin('我要用信用卡付款')
  const order = { reference: 'TEST-1', status: 20, total: 64, paymentStatus: 'pending', paymentMethods: ['信用卡'], invoice: { method: 'donation', code: '123' } }
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'payment', observedAt: 123, order })
  const resultClient = { ...client, tools: readonly(shallowRef(client.tools.value.filter(tool => tool.name === 'browser_state_get'))) }
  expect(await readBrowserConversation(resultClient, 'payment-turn', modelTools)).toMatchObject({ phase: 'viewing_order', readOnly: true, page: 'payment', order, allowedToolNames: ['browser_respond'] })
  expect(await executeBrowserReply(resultClient, 'checkout-guidance')).toMatchObject({ effect: 'none', customerMessage: expect.stringContaining('信用卡') })
  expect(client.execute.mock.calls.every(([tool]) => tool.name === 'browser_state_get')).toBe(true)
  // Manual SPA submission retains the discovered editor descriptors until re-discovery.
  expect(await readBrowserConversation(client, 'manual-payment-turn', modelTools)).toMatchObject({ phase: 'viewing_order' })
  expect(await executeBrowserReply(client, 'checkout-guidance')).toMatchObject({ effect: 'none', customerMessage: expect.stringContaining('信用卡') })
  expect(client.execute.mock.calls.every(([tool]) => tool.name === 'browser_state_get')).toBe(true)
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'payment', observedAt: 124, order: { ...order, reference: 'other-order' } })
  await expect(executeBrowserReply(client, 'checkout-guidance')).rejects.toThrow('different order')
})

// Report: this chat, Nov20 — local reception IDs do not identify the operator.
it('reads the visible order without inferring customer ownership or granting write tools', async () => {
  const { client } = setup()
  release.push(beginBrowserCartTask('這張發票是什麼', { decide: async () => {
    throw new Error('An order-result read must not request a write.')
  }, isCurrent: () => true }))
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'payment', observedAt: 123, order: { reference: 'visible-order', status: 20, total: 64, paymentStatus: 'pending', paymentMethods: ['信用卡'], invoice: { method: 'donation', code: '12345' } } })
  const resultClient = { ...client, tools: readonly(shallowRef(client.tools.value.filter(tool => tool.name === 'browser_state_get'))) }
  const context = await readBrowserConversation(resultClient, 'visible-order-turn', modelTools)
  expect(context.phase).toBe('viewing_order')
  expect(context.order?.reference).toBe('visible-order')
  expect(context.allowedToolNames).not.toContain('add_items_to_cart')
  expect(await executeBrowserReply(resultClient, 'checkout-guidance')).toMatchObject({ effect: 'none', customerMessage: expect.stringContaining('信用卡') })
})
// Report: this chat, Nov17 case 12 — persistent entry position is scoped to one reception/document.
it.each(['owner', 'document', 'reset'] as const)('does not restore checkout progress after %s changes', (change) => {
  const { dialogue, state, facts } = setup()
  Object.assign(facts, { checkout: { methods: [{ method: 'donation', label: '捐贈', selected: true }], fields: [{ kind: 'donation', label: '捐贈碼', value: '', valid: false }], ready: false, missing: ['捐贈碼'], orderNote: '' } })
  dialogue.presentService(facts, { purpose: 'invoice-details', request: '捐贈', question: '填好說好了', choices: [{ id: 'yes', description: '重新查核' }] })
  facts.cart.version = 'field-edited'
  expect(dialogue.conversation(facts).waitingFor).toBeDefined()
  if (change === 'reset')
    dialogue.reset()
  else
    state[change] = 'replacement'
  expect(dialogue.conversation(facts).waitingFor).toBeUndefined()
  expect(dialogue.checkoutStep(facts)).toBeUndefined()
})

// Report: this chat, Nov19 — actual PB card availability is not kiosk payment support.
it.each([
  { text: '有沒有其他付款方式？', paymentMethods: ['LINE Pay', '信用卡'] },
  { text: '可以用信用卡嗎？', paymentMethods: ['LINE Pay', '信用卡'] },
  { text: '可以付現金嗎？', paymentMethods: ['LINE Pay', '信用卡'] },
  { text: '用信用卡付款', paymentMethods: ['信用卡'] },
])('explains LINE Pay only without initiating payment: $text', async ({ text, paymentMethods }) => {
  const { client, begin } = setup()
  begin(text)
  const order = { reference: 'TEST-1', status: 20, total: 64, paymentStatus: 'pending', paymentMethods, invoice: { method: 'none' } }
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'payment', observedAt: 123, order })
  const resultClient = { ...client, tools: readonly(shallowRef(client.tools.value.filter(tool => tool.name === 'browser_state_get'))) }
  const result = parse(looseObject({ customerMessage: string() }), await executeBrowserReply(resultClient, 'checkout-guidance'))
  expect(result.customerMessage).toContain('僅支援 LINE Pay')
  expect(result.customerMessage).toContain('暫不支援信用卡')
  if (paymentMethods.includes('LINE Pay'))
    expect(result.customerMessage).toContain('點選 LINE Pay')
  else
    expect(result.customerMessage).toContain('沒有可用的 LINE Pay')
  expect(client.execute.mock.calls.every(([tool]) => tool.name === 'browser_state_get')).toBe(true)
})

// Report: this chat, Nov19 — repeated unresolved questions need a non-destructive way out.
it('stops after two distinct unresolved answers to the same question, even if Main reissues it', async () => {
  const { dialogue, facts, answer } = setup()
  answer.mockResolvedValue({ kind: 'UNCERTAIN', provider: 'main' })
  const cart = structuredClone(facts.cart)
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  expect(await dialogue.answer(facts, '聽不懂', async () => facts, () => true, 10)).toMatchObject({ result: { pendingCustomerChoice: { purpose: 'browser-order-quantity' } } })
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  expect(await dialogue.answer(facts, '還是不懂', async () => facts, () => true, 11)).toMatchObject({ result: { code: 'QUESTION_RETRY_LIMIT', effect: 'none' } })
  expect(dialogue.hasPending()).toBe(false)
  expect(facts.cart).toEqual(cart)
  dialogue.presentQuantity(facts, 'p-0', '我要甲餐')
  expect(await dialogue.answer(facts, '一份', async () => facts, () => true, 12)).toMatchObject({ kind: 'product', requestedQuantity: 1 })
})

it('does not count the same utterance twice toward the question retry limit', async () => {
  const { dialogue, facts, answer } = setup()
  answer.mockResolvedValue({ kind: 'UNCERTAIN', provider: 'main' })
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  await dialogue.answer(facts, '聽不懂', async () => facts, () => true, 10)
  expect(await dialogue.answer(facts, '聽不懂', async () => facts, () => true, 10)).toMatchObject({ result: { pendingCustomerChoice: { purpose: 'browser-order-quantity' } } })
  expect(dialogue.hasPending()).toBe(true)
})

it('releases the old invoice question when the customer naturally asks about other meals', async () => {
  const { dialogue, facts, answer } = setup()
  answer.mockResolvedValue({ kind: 'NEW_REQUEST', provider: 'main' })
  dialogue.presentService(facts, { purpose: 'invoice-method', request: '結帳', question: '發票要哪種？', choices: [{ id: 'none', description: '無載具' }, { id: 'carrier', description: '手機載具' }] })
  expect(await dialogue.answer(facts, '我想先看看別的餐點', async () => facts, () => true, 10)).toBeUndefined()
  expect(dialogue.hasPending()).toBe(false)
  expect(facts.cart.lines).toEqual([])
})

it('retires a repeatedly unresolved submission question without returning a submit action', async () => {
  const { dialogue, facts, answer } = setup()
  answer.mockResolvedValue({ kind: 'UNCERTAIN', provider: 'unavailable' })
  dialogue.presentService(facts, { purpose: 'submit-order', query: 'ticket', request: '送單', question: '確認送出嗎？', choices: [{ id: 'yes', description: '送出' }, { id: 'no', description: '保留' }] })
  await dialogue.answer(facts, '聽不懂', async () => facts, () => true, 10)
  const result = await dialogue.answer(facts, '還是不懂', async () => facts, () => true, 11)
  expect(result).toMatchObject({ kind: 'receipt', result: { code: 'QUESTION_RETRY_LIMIT', effect: 'none' } })
  expect(dialogue.hasPending()).toBe(false)
  expect(dialogue.hasSubmissionQuestion()).toBe(false)
})

it('does not release a newer question when an older unresolved answer finishes late', async () => {
  const { dialogue, facts, answer } = setup()
  const gate = Promise.withResolvers<AnswerDecision>()
  answer.mockImplementationOnce(() => gate.promise)
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  const pending = dialogue.answer(facts, '聽不懂', async () => facts, () => true, 10)
  dialogue.presentQuantity(facts, 'p-0', '我要甲餐')
  gate.resolve({ kind: 'UNCERTAIN', provider: 'main' })
  expect(await pending).toMatchObject({ result: { ok: false, status: 'rejected' } })
  expect(dialogue.conversation(facts).waitingFor?.question).toContain('甲餐')
  expect(dialogue.hasPending()).toBe(true)
})

it('resets the unresolved count after a valid quantity answer', async () => {
  const { dialogue, facts, answer } = setup()
  answer.mockResolvedValue({ kind: 'UNCERTAIN', provider: 'main' })
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  await dialogue.answer(facts, '聽不懂', async () => facts, () => true, 10)
  expect(await dialogue.answer(facts, '一份', async () => facts, () => true, 11)).toMatchObject({ kind: 'product' })
  dialogue.presentQuantity(facts, 'p-1', '我要乙餐')
  expect(await dialogue.answer(facts, '聽不懂', async () => facts, () => true, 12)).toMatchObject({ result: { pendingCustomerChoice: { purpose: 'browser-order-quantity' } } })
})
