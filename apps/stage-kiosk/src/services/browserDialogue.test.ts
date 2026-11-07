import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { CartLine } from '@proj-airi/stage-ui/services/pbCart'

import type { AnswerDecision, BrowserAnswer, BrowserEffect, EffectDecision } from '../../../server/src/services/domain/browser-ordering/contracts'

import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { beginBrowserCartTask, executeBrowserCartTool, executeBrowserReply } from './browserCartTask'
import { createBrowserDialogue } from './browserDialogue'

const release: Array<() => void> = []
afterEach(() => release.splice(0).forEach(dispose => dispose()))

function setup() {
  const state = { owner: 'customer', document: 'document' }
  const answer = vi.fn<(input: BrowserAnswer) => Promise<AnswerDecision>>(async () => ({ kind: 'ANSWER', choiceId: 'product:2', provider: 'system-one' }))
  const dialogue = createBrowserDialogue({ owner: () => state.owner, documentId: () => state.document, answer })
  const cartLines: CartLine[] = []
  const facts = { ok: true, source: 'browser', dataOnly: true, cart: { version: 'cart', lines: cartLines }, products: ['甲餐', '乙餐'].map((name, index) => ({ ref: `p-${index}`, name, price: 10 + index, configurations: [{ version: `config-${index}`, variantRef: '', name, unitPrice: 10 + index, groups: [] }] })) }
  const context: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const add = { ...context, name: 'browser_cart_add' }
  const clarify = { ...context, name: 'browser_clarify_product' }
  const execute = vi.fn(async (tool: ServiceTool): Promise<unknown> => tool.name === context.name ? facts : { ok: true, source: 'browser', status: 'verified', cart: { version: 'after-add' } })
  const client = { tools: readonly(shallowRef([context, add, clarify, { ...context, name: 'browser_product_get' }])), execute }
  const decide = vi.fn<(proposal: BrowserEffect) => Promise<EffectDecision>>(async () => ({ choice: 'ALLOW', provider: 'main' }))
  const begin = (text: string) => release.push(beginBrowserCartTask(text, { dialogue, decide, isCurrent: () => true }))
  return { state, answer, dialogue, facts, client, context, add, clarify, begin, decide }
}

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
it('confirms a semantically resolved unfamiliar name with the official product and full proposal before adding', async () => {
  const { client, context, add, begin, answer } = setup()
  const proposal = { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } }
  begin('乙飯一份')
  expect(await executeBrowserCartTool(client, add, proposal)).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-confirm-add', question: expect.stringContaining('乙餐 1 份') } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'confirm', provider: 'main' })
  begin('對，就這個設定')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).toMatchObject({ confirmedAddition: { productRef: 'p-1' } })
  expect(await executeBrowserCartTool(client, add, proposal)).toMatchObject({ status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S03/S13.
it.each(['CLARIFY', 'READ_ONLY', 'REVISE'] as const)('does not turn a %s proposal into a single-product purchase confirmation', async (choice) => {
  const { client, add, begin, decide } = setup()
  decide.mockResolvedValueOnce({ choice, provider: 'main' })
  begin('餐一份有嗎')
  const result = await executeBrowserCartTool(client, add, { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } })
  expect(result).not.toMatchObject({ pendingCustomerChoice: { purpose: 'browser-confirm-add' } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  if (choice === 'REVISE') {
    expect(result).toMatchObject({ status: 'proposal_rejected', dataOnly: true })
    expect(result).not.toHaveProperty('pendingCustomerChoice')
  }
  if (choice === 'READ_ONLY') {
    expect(result).toMatchObject({ dataOnly: true })
    expect(result).not.toHaveProperty('customerMessage')
  }
})

it('selects the original second product, presents a full proposal, and adds only after its one-use confirmation', async () => {
  const { client, context, add, clarify, facts, begin, answer, decide } = setup()
  begin('餐一份')
  expect(await executeBrowserCartTool(client, clarify, { query: '餐' })).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-product-choice' } })
  facts.products.reverse()
  begin('第二個')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).toMatchObject({ selectedProduct: { productRef: 'p-1', name: '乙餐' } })
  const proposal = { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } }
  expect(await executeBrowserCartTool(client, add, proposal)).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-confirm-add', question: expect.stringContaining('乙餐 1 份') } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'confirm', provider: 'system-one' })
  begin('對')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).toMatchObject({ confirmedAddition: { productRef: 'p-1', quantity: 1 } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  expect(await executeBrowserCartTool(client, add, { ...proposal, quantity: 2 })).toMatchObject({ status: 'proposal_rejected', effect: 'none' })
  expect(await executeBrowserCartTool(client, add, proposal)).toMatchObject({ status: 'verified' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
  expect(decide).not.toHaveBeenCalled()
  facts.cart.version = 'after-add'
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

it('carries a correction as context only and requires a newly presented complete confirmation', async () => {
  const { dialogue, facts, answer, client, context, add, begin } = setup()
  const proposal = { version: 'cart', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } }
  dialogue.presentAddition(facts, proposal)
  answer.mockResolvedValueOnce({ kind: 'NEW_REQUEST', provider: 'main' })
  begin('對，但改兩份')
  expect(await executeBrowserCartTool(client, context, { includeCatalog: true })).toMatchObject({ previousProposal: { quantity: 1 } })
  expect(await executeBrowserCartTool(client, add, { ...proposal, quantity: 2 })).toMatchObject({ pendingCustomerChoice: { question: expect.stringContaining('乙餐 2 份') } })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
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
  expect(await executeBrowserCartTool(client, add, { ...input, unitPrice: 11, selection: { version: 'config-1', variantRef: '', choices: [] } })).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-confirm-add' }, effect: 'none' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
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
it('asks only about the independently checked replacement product without writing it', async () => {
  const { dialogue, facts, begin, client, context, add } = setup()
  facts.products[0].name = '青醬雞肉便當'
  facts.products[1].name = '香煎鱈魚便當'
  facts.cart.lines.push({ ref: 'original', productRef: 'p-0', name: '青醬雞肉便當', quantity: 1, unitPrice: 10, configuration: 'plain', note: '' })
  begin('剛說錯，是鱈魚飯，不是雞肉飯')
  const replace = { ...add, name: 'browser_cart_replace' }
  const result = await executeBrowserCartTool(client, replace, { version: 'cart', lineRef: 'original', productRef: 'p-1', quantity: 1, unitPrice: 11, note: '', selection: { version: 'config-1', variantRef: '', choices: [] } })
  expect(result).toMatchObject({ effect: 'none', presentationRefs: ['p-1'], pendingCustomerChoice: expect.objectContaining({ purpose: 'browser-product-choice' }) })
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('香煎鱈魚便當'))
  expect(result).toHaveProperty('customerMessage', expect.not.stringContaining('青醬雞肉便當'))
  expect(client.execute).toHaveBeenCalledOnce()
  expect(client.execute).toHaveBeenCalledWith(context, { includeCatalog: true })
  expect(dialogue.hasPending()).toBe(true)
})

// Report: S13-nov4-review-2 took exact product lookup instead of the existing clarification tool.
it('converts an unresolved exact lookup into related current-product confirmation without a write', async () => {
  const { facts, dialogue, client, context, begin, decide } = setup()
  facts.products[0].name = '青醬雞肉便當'
  facts.products[1].name = '香煎鱈魚便當'
  const lookup = { ...context, name: 'browser_product_get' }
  client.execute.mockImplementation(async tool => tool.name === lookup.name ? { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '正式名稱未找到' } : facts)
  begin('香煎鱈魚飯一份')
  const result = await executeBrowserCartTool(client, lookup, { names: ['香煎鱈魚飯'] })
  expect(result).toMatchObject({ effect: 'none', presentationRefs: ['p-1'], pendingCustomerChoice: expect.objectContaining({ purpose: 'browser-product-choice' }) })
  expect(result).toHaveProperty('customerMessage', expect.stringContaining('香煎鱈魚便當'))
  expect(result).toHaveProperty('customerMessage', expect.not.stringContaining('青醬雞肉便當'))
  expect(client.execute.mock.calls.map(([tool]) => tool.name)).toEqual(['browser_product_get', 'browser_cart_get'])
  expect(decide).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(true)
})
