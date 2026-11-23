import type { ServiceTool, ToolExecution } from '@proj-airi/stage-shared/interactive-service'

import type { BrowserEffect, EffectDecision } from '../../../server/src/services/domain/browser-ordering/contracts'

import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { beginBrowserCartTask, executeBrowserCartTool, executeBrowserReply } from './browserCartTask'
import { createBrowserDialogue } from './browserDialogue'
import { createBrowserPresentation } from './browserPresentation'

const addition = { version: 'cart-version', productRef: 'new-today', quantity: 1, unitPrice: 10, note: '', selection: { version: 'config', variantRef: '', choices: [] } }
const disposals: Array<() => void> = []
const allow = { decide: vi.fn<(proposal: BrowserEffect) => Promise<EffectDecision>>(async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' })), isCurrent: () => true }
afterEach(() => disposals.splice(0).forEach(dispose => dispose()))

function setup(text: string) {
  const decide = vi.fn<(proposal: BrowserEffect) => Promise<EffectDecision>>(async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }))
  disposals.push(beginBrowserCartTask(text, { ...allow, decide }))
  const context: ServiceTool = { name: 'browser_cart_get', description: 'Context', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const tool: ServiceTool = { ...context, name: 'browser_cart_add' }
  const facts = { ok: true, source: 'browser', page: 'menu', products: [{ ref: 'new-today', name: '每日新品', configurations: [{ version: 'config', variantRef: '', name: '', unitPrice: 10, groups: [{ ref: 'extras', name: '加購', required: false, maximum: 1, choices: [{ ref: 'extra', name: '付費配菜', unitPrice: 5, maximum: 1 }] }] }] }], cart: { version: 'cart-version', lines: [{ ref: 'original', name: '原餐', quantity: 1 }] } }
  const execute = vi.fn(async (tool: ServiceTool): Promise<unknown> => tool.name === context.name ? facts : { ok: true, status: 'verified' })
  return { client: { tools: readonly(shallowRef([context, tool, { ...context, name: 'browser_cart_review' }])), execute }, tool, facts, decide }
}

// Report: this chat, 2026-10-29; actual Main proposed a replacement for D11.

it('reuses a repeated verified model call only while its resulting cart version is still current', async () => {
  const { client, tool, facts, decide } = setup('每日新品一份')
  client.execute.mockImplementation(async (current) => {
    if (current.name === 'browser_cart_get')
      return facts
    facts.cart.version = 'after-write'
    return { ok: true, status: 'verified', cart: { version: 'after-write' } }
  })
  const input = { ...addition, version: 'cart-version', productRef: 'new-today' }
  expect(await executeBrowserCartTool(client, tool, input)).toMatchObject({ status: 'verified' })
  expect(await executeBrowserCartTool(client, tool, input)).toMatchObject({ status: 'verified', repeated: true })
  expect(client.execute).toHaveBeenCalledTimes(3)
  expect(decide).toHaveBeenCalledTimes(1)
})

// Report: output/playwright/pb-electron/restored-S04-partial-verified.json.
it.each([false, true])('recognizes an already verified replacement after the planner refreshes its version (changed=%s)', async (changed) => {
  const { client, tool, facts, decide } = setup('原餐三份，其中一份換每日新品')
  Object.assign(facts.cart.lines[0], { quantity: 3, productRef: 'old', configuration: 'plain' })
  client.execute.mockImplementation(async (current) => {
    if (current.name === 'browser_cart_get')
      return facts
    facts.cart.version = 'after-replace'
    facts.cart.lines[0].quantity = 2
    return { ok: true, status: 'verified', cart: { version: 'after-replace' }, effectMessage: '已替換一份' }
  })
  const input = { ...addition, lineRef: 'original', retainQuantity: 2 }
  const replace = { ...tool, name: 'browser_cart_replace' }
  expect(await executeBrowserCartTool(client, replace, input)).toMatchObject({ status: 'verified' })
  if (changed)
    facts.cart.version = 'manual-change'
  const result = await executeBrowserCartTool(client, replace, { ...input, version: facts.cart.version, selection: { variantRef: '', choices: [] } })
  expect(result).toMatchObject(changed ? { status: 'proposal_rejected', effect: 'none' } : { status: 'verified', repeated: true })
  expect(client.execute.mock.calls.filter(([current]) => current.name === 'browser_cart_replace')).toHaveLength(1)
  expect(decide).toHaveBeenCalledTimes(1)
})

// Report: output/playwright/pb-electron/restored-S04-completed-context.json.
it.each(['verified', 'unknown'])('passes only verified addition counts to the next configuration (%s)', async (status) => {
  const { client, tool, facts, decide } = setup('每日新品兩份，另外一份每日新品加付費配菜')
  client.execute.mockImplementation(async (current) => {
    if (current.name === 'browser_cart_get')
      return facts
    facts.cart.version = 'after-write'
    return { ok: true, status, cart: { version: 'after-write' }, effectMessage: '已加入每日新品兩份' }
  })
  await executeBrowserCartTool(client, tool, { ...addition, version: 'cart-version', productRef: 'new-today', quantity: 2, selection: { version: 'config', variantRef: '', choices: [] } })
  await executeBrowserCartTool(client, tool, { ...addition, version: 'after-write', productRef: 'new-today', quantity: 1, unitPrice: 15, selection: { version: 'config', variantRef: '', choices: [{ ref: 'extra', quantity: 1 }] } })
  expect(decide.mock.calls[1][0].completedAdditions).toEqual(status === 'verified' ? [{ servingKey: JSON.stringify(['new-today', { variantRef: '', choices: [] }]), note: '', quantity: 2 }] : [])
  expect(decide.mock.calls[1][0].servingKey).toBe(JSON.stringify(['new-today', { variantRef: '', choices: [{ ref: 'extra', quantity: 1 }] }]))
})

it('allows an exact current daily product without configured product names', async () => {
  const { client, tool } = setup('每日新品一份')
  expect(await executeBrowserCartTool(client, tool, { ...addition, productRef: 'new-today' })).toMatchObject({ ok: true })
  expect(client.execute).toHaveBeenLastCalledWith(tool, addition)
})

it('rejects a late context read after a new task superseded the old utterance', async () => {
  const { client, tool, facts } = setup('每日新品一份')
  let resolve!: (value: typeof facts) => void
  client.execute.mockImplementationOnce(() => new Promise(ready => resolve = ready))
  const pending = executeBrowserCartTool(client, tool, { ...addition, productRef: 'new-today' })
  disposals.push(beginBrowserCartTask('先不要點', allow))
  resolve(facts)
  expect(await pending).toMatchObject({ status: 'rejected' })
  expect(client.execute).toHaveBeenCalledTimes(1)
})

it('does not apply PB target rules to the owned Menu tool path', async () => {
  const { client, tool } = setup('其他對話')
  const owned = { ...tool, name: 'order_add_item' }
  expect(await executeBrowserCartTool(client, owned, { itemId: 'owned' })).toMatchObject({ ok: true })
  expect(client.execute).toHaveBeenCalledTimes(1)
})

it('does not choose the first same-named cart line on behalf of the customer', async () => {
  const { client, tool, facts } = setup('原餐不要了')
  facts.cart.lines.push({ ref: 'another', name: '原餐', quantity: 1 })
  expect(await executeBrowserCartTool(client, { ...tool, name: 'browser_cart_remove' }, { lineRef: 'original' })).toMatchObject({ status: 'clarification', effect: 'none' })
  expect(client.execute).toHaveBeenCalledTimes(1)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, S09/S12.
it('supplies observed configurations and permits an issued cart target without repeating its formal name', async () => {
  const { client, tool, facts, decide } = setup('把加白飯的那份取消')
  Object.assign(facts.cart.lines[0], { productRef: 'p-1', configuration: 'rice', description: '白飯 ×1', note: '' })
  facts.cart.lines.push({ ref: 'plain', name: '原餐', quantity: 2 })
  Object.assign(facts.cart.lines[1], { productRef: 'p-1', configuration: 'plain', description: '', note: '' })
  const remove = { ...tool, name: 'browser_cart_remove' }
  expect(await executeBrowserCartTool(client, remove, { lineRef: 'original' })).toMatchObject({ status: 'verified' })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ cartTarget: { selected: { name: '原餐', quantity: 1, description: '白飯 ×1', configuration: '白飯 ×1', note: '' }, others: [{ name: '原餐', quantity: 2, description: '', configuration: '', note: '', sameConfiguration: false }] } }), expect.anything())
  expect(client.execute).toHaveBeenLastCalledWith(remove, { lineRef: 'original' })
})

it('keeps unrelated same-named products ambiguous after issued-plan admission', async () => {
  const { client, tool, facts } = setup('原餐不要了')
  Object.assign(facts.cart.lines[0], { productRef: 'p-1', configuration: 'plain' })
  facts.cart.lines.push({ ref: 'another', name: '原餐', quantity: 1 })
  Object.assign(facts.cart.lines[1], { productRef: 'p-2', configuration: 'plain' })
  expect(await executeBrowserCartTool(client, { ...tool, name: 'browser_cart_remove' }, { lineRef: 'original' })).toMatchObject({ status: 'clarification', effect: 'none' })
  expect(client.execute).toHaveBeenCalledTimes(1)
})

it('presents a verified equivalent row group as one total rather than a single internal row', async () => {
  const { client, tool, facts, decide } = setup('原餐總共改成五份')
  facts.cart.lines[0].quantity = 17
  Object.assign(facts.cart.lines[0], { productRef: 'p-1', configuration: 'plain', unitPrice: 10 })
  facts.cart.lines.push({ ref: 'second', name: '原餐', quantity: 13 })
  Object.assign(facts.cart.lines[1], { productRef: 'p-1', configuration: 'plain', unitPrice: 10 })
  expect(await executeBrowserCartTool(client, { ...tool, name: 'browser_cart_quantity' }, { lineRef: 'original', lineRefs: ['original', 'second'], quantity: 5 })).toMatchObject({ status: 'verified' })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ cartTarget: { selected: { name: '原餐', quantity: 30, description: '', configuration: '', note: '' }, others: [], groupSize: 2 }, deltas: [{ name: '原餐', kind: 'cart_line', mode: 'set', quantity: 5 }] }), expect.anything())
})

// Report: output/playwright/pb-electron/restored-S04-nov4-group-required-ref.json.
it('explains a missing group anchor without guessing one or dispatching a write', async () => {
  const { client, tool, decide } = setup('原餐合計改一份')
  const result = await executeBrowserCartTool(client, { ...tool, name: 'browser_cart_quantity' }, { lineRefs: ['original'], quantity: 1 })
  expect(result).toMatchObject({ status: 'proposal_rejected', effect: 'none', explanation: expect.stringContaining('缺少必填 lineRef') })
  expect(decide).not.toHaveBeenCalled()
  expect(client.execute).toHaveBeenCalledTimes(1)
})

// Report: output/playwright/pb-electron/restored-S05-nov4-notes-initial.json.
it('returns every missing selection field in one repair without a vendor write', async () => {
  const { client, tool, decide, facts } = setup('每日新品一份')
  Object.assign(facts.products[0].configurations[0], { version: 'observed-config-version' })
  const result = await executeBrowserCartTool(client, tool, { ...addition, productRef: 'new-today', quantity: 1, selection: {} })
  expect(result).toMatchObject({ status: 'proposal_rejected', effect: 'none', availableConfigurations: [{ version: 'observed-config-version', variantRef: '' }], selectionIssues: [expect.objectContaining({ path: 'version' }), expect.objectContaining({ path: 'variantRef' }), expect.objectContaining({ path: 'choices' })] })
  expect(decide).not.toHaveBeenCalled()
  expect(client.execute).toHaveBeenCalledTimes(1)
})

it('refuses to merge different configurations into one group before admission', async () => {
  const { client, tool, facts, decide } = setup('原餐總共改成五份')
  Object.assign(facts.cart.lines[0], { productRef: 'p-1', configuration: 'plain', unitPrice: 10 })
  facts.cart.lines.push({ ref: 'second', name: '原餐', quantity: 1 })
  Object.assign(facts.cart.lines[1], { productRef: 'p-1', configuration: 'rice', unitPrice: 15 })
  expect(await executeBrowserCartTool(client, { ...tool, name: 'browser_cart_quantity' }, { lineRef: 'original', lineRefs: ['original', 'second'], quantity: 5 })).toMatchObject({ status: 'proposal_rejected', effect: 'none' })
  expect(decide).not.toHaveBeenCalled()
  expect(client.execute).toHaveBeenCalledTimes(1)
})

it('describes only the replaced portion and the new per-serving configuration for partial replacements', async () => {
  const { client, tool, facts, decide } = setup('原餐三份，其中一份換每日新品加付費配菜')
  facts.cart.lines[0].quantity = 3
  Object.assign(facts.cart.lines[0], { productRef: 'p-original', configuration: 'plain' })
  const replace = { ...tool, name: 'browser_cart_replace' }
  expect(await executeBrowserCartTool(client, replace, { ...addition, unitPrice: 15, lineRef: 'original', productRef: 'new-today', quantity: 1, retainQuantity: 2, selection: { version: 'config', variantRef: '', choices: [{ ref: 'extra', quantity: 1 }] } })).toMatchObject({ status: 'verified' })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({
    deltas: expect.arrayContaining([{ name: '原餐', kind: 'cart_line', mode: 'remove', quantity: 1 }]),
    serving: { productName: '每日新品', variantName: '', options: [{ name: '付費配菜', quantity: 1 }] },
  }), expect.anything())
})

it('does not describe a fixed-price product label as a selected variant', async () => {
  const { client, tool, facts, decide } = setup('每日新品一份')
  facts.products[0].configurations[0].name = '每日新品'
  await executeBrowserCartTool(client, tool, { ...addition, productRef: 'new-today', quantity: 1, selection: { version: 'config', variantRef: '', choices: [] } })
  expect(decide.mock.calls[0][0].serving).toEqual({ productName: '每日新品', variantName: '', options: [] })
})

// Report: output/playwright/pb-electron/restored-S04-partial-before.json.

it('preserves the issued plain configuration separately from a serving with an add-on', async () => {
  const { client, tool, decide } = setup('每日新品三份，其中一份加付費配菜')
  expect(await executeBrowserCartTool(client, tool, { ...addition, productRef: 'new-today', quantity: 2, selection: { version: 'config', variantRef: '', choices: [] } })).toMatchObject({ status: 'verified' })
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ serving: { productName: '每日新品', variantName: '', options: [] } }), expect.anything())
})

// Report: this chat, 2026-10-30; actual Main quoted only the first meal in a two-name availability question.
it('keeps fresh presence evidence for every explicitly named product in a read-only quote reply', async () => {
  disposals.push(beginBrowserCartTask('甲餐跟乙餐都有嗎？', allow))
  const context: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const quote = { ...context, name: 'browser_quote' }
  const facts = { ok: true, source: 'browser', page: 'menu', cart: { version: 'cart', lines: [] }, products: [{ ref: 'a', name: '甲餐', kind: 'product', priceType: 1, price: 10, configurations: [] }, { ref: 'b', name: '乙餐', kind: 'product', priceType: 1, price: 11, configurations: [] }] }
  const client = { tools: readonly(shallowRef([context, quote])), execute: vi.fn(async (tool: ServiceTool) => tool.name === context.name ? facts : { ok: true, source: 'browser', customerMessage: '甲餐單份10元，一份10元。' }) }
  const result = await executeBrowserCartTool(client, quote, { name: '甲餐', quantity: 1 })
  expect(result).toMatchObject({ customerMessage: expect.stringContaining('乙餐') })
  expect(result).toMatchObject({ customerMessage: expect.stringContaining('單份 11 元') })
})

it('renders bounded Host conversation without reading or changing PB', async () => {
  disposals.push(beginBrowserCartTask('你好', allow))
  const client = { tools: readonly(shallowRef<ServiceTool[]>([])), execute: vi.fn() }
  expect(await executeBrowserReply(client, 'greeting')).toMatchObject({ source: 'host', effect: 'none', customerMessage: '您好，請問需要什麼協助？' })
  expect(client.execute).not.toHaveBeenCalled()
  await expect(executeBrowserReply(client, 'order-complete')).rejects.toThrow()
  expect(client.execute).not.toHaveBeenCalled()
})

// Report: this chat, 2026-10-31; a rice-price inquiry received the base-only quote.
it('rejects a partial base quote when a current option is mentioned, without choosing whether to include it', async () => {
  disposals.push(beginBrowserCartTask('每日新品加白飯要多少錢？', allow))
  const context: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const quote = { ...context, name: 'browser_quote' }
  const products = [{ ref: 'today', name: '每日新品', kind: 'product', priceType: 1, price: 10, configurations: [{ version: 'fresh', variantRef: '', name: '', unitPrice: 10, groups: [{ ref: 'g-1', name: '加購', required: false, maximum: 1, choices: [{ ref: 'a-rice', name: '白飯', unitPrice: 5, maximum: 1 }] }] }] }]
  const execute = vi.fn(async (tool: ServiceTool) => tool.name === context.name ? { ok: true, source: 'browser', page: 'menu', cart: { version: 'cart', lines: [] }, products } : { ok: true, source: 'browser', customerMessage: '單份10元，未含加購。' })
  const client = { tools: readonly(shallowRef([context, quote])), execute }
  const result = await executeBrowserCartTool(client, quote, { name: '每日新品', quantity: 1 })
  expect(result).toMatchObject({ dataOnly: true, requiredTool: 'browser_quote_selection' })
  expect(result).not.toHaveProperty('customerMessage')
  expect(execute).not.toHaveBeenCalledWith(quote, expect.anything())
})

// Report: this chat, 2026-10-31; Main searched the exact meal then asked which bento again.
it('returns exact named product configurations instead of asking a redundant broad product question', async () => {
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'document', answer: async () => ({ kind: 'UNCERTAIN', provider: 'unavailable' }) })
  disposals.push(beginBrowserCartTask('每日新品加白飯要多少錢？', { ...allow, dialogue }))
  const context: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const observe = { ...context, name: 'browser_observe' }
  const products = [{ ref: 'today', name: '每日新品', price: 10, configurations: [{ version: 'fresh', variantRef: '', name: '', unitPrice: 10, groups: [] }] }]
  const client = { tools: readonly(shallowRef([context, observe])), execute: vi.fn(async () => ({ ok: true, source: 'browser', page: 'menu', cart: { version: 'current', lines: [] }, products })) }
  const result = await executeBrowserCartTool(client, observe, { includeDescriptions: true, purpose: 'choose_product' })
  expect(result).toMatchObject({ dataOnly: true, products })
  expect(result).not.toHaveProperty('pendingCustomerChoice')
  expect(dialogue.hasPending()).toBe(false)
})

// Report: this chat, Nov11; spoken product choices must match the actual PB screen.
it.each(['browser_clarify_product', 'browser_product_get'])('withholds %s choices when their native presentation is cancelled', async (name) => {
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'document', answer: async () => ({ kind: 'UNCERTAIN', provider: 'unavailable' }) })
  disposals.push(beginBrowserCartTask('我要一份雞腿', { ...allow, dialogue }))
  const context: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const tool = { ...context, name }
  const present = { ...context, name: 'browser_present' }
  const products = [{ ref: 'chicken', name: '雞腿便當', price: 100, configurations: [{ version: 'fresh', variantRef: '', name: '', unitPrice: 100, groups: [] }] }]
  const execute = vi.fn(async (current: ServiceTool) => {
    if (current.name === context.name)
      return { ok: true, source: 'browser', page: 'menu', products, cart: { version: 'current', lines: [], subtotal: 0 } }
    if (current.name === 'browser_product_get')
      return { ok: true, source: 'browser', status: 'clarification', effect: 'none' }
    return { ok: true, source: 'browser', presentation: { products: [], cue: 'cancelled' } }
  })
  const client = { tools: readonly(shallowRef([context, tool, present])), execute }
  const result = await executeBrowserCartTool(client, tool, name === 'browser_product_get' ? { names: ['雞腿'] } : { query: '雞腿' })
  expect(result).toMatchObject({ ok: false, status: 'rejected', effect: 'none' })
  expect(result).not.toHaveProperty('pendingCustomerChoice')
  expect(execute).toHaveBeenCalledWith(present, { productRefs: ['chicken'], mode: 'information' })
  expect(dialogue.hasPending()).toBe(false)
})

// Report: this chat, Nov11; clearing recommendations must retire their old question.
it('retires the old product question after a successful search without changing the cart', async () => {
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'document', answer: async () => ({ kind: 'UNCERTAIN', provider: 'unavailable' }) })
  const products = [{ ref: 'chicken', name: '雞腿便當', price: 100, configurations: [{ version: 'fresh', variantRef: '', name: '', unitPrice: 100, groups: [] }] }]
  dialogue.presentProducts({ products, cart: { version: 'current', lines: [], subtotal: 0 } }, '雞腿', '我要雞腿')
  expect(dialogue.hasPending()).toBe(true)
  disposals.push(beginBrowserCartTask('這些都不要，先看全部', { ...allow, dialogue }))
  const search: ServiceTool = { name: 'browser_search', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const execute = vi.fn(async () => ({ ok: true, source: 'browser', search: '', customerMessage: '已清除搜尋，回到目前完整菜單。' }))
  const client = { tools: readonly(shallowRef([search])), execute }
  expect(await executeBrowserCartTool(client, search, { query: '' })).toMatchObject({ ok: true, search: '' })
  expect(execute).toHaveBeenCalledExactlyOnceWith(search, { query: '' })
  expect(dialogue.hasPending()).toBe(false)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S01/S11 baseline.
it.each(['先不要排骨，還有什麼？', '有完全不含花生的便當嗎？', '那熱量最低的是哪個？'])('does not present an unfiltered PB catalog as a verified answer to %s', async (text) => {
  disposals.push(beginBrowserCartTask(text, allow))
  const context: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const observe = { ...context, name: 'browser_observe' }
  const products = [{ ref: 'today-a', name: '雞腿便當', price: 10 }, { ref: 'today-b', name: '排骨便當', price: 10 }]
  const client = { tools: readonly(shallowRef([context, observe])), execute: vi.fn(async () => ({ ok: true, source: 'browser', products, cart: { version: 'current', lines: [] }, customerMessage: '目前查到：雞腿便當，單份 10 元；排骨便當，單份 10 元。' })) }
  const result = await executeBrowserCartTool(client, observe, { includeDescriptions: true, purpose: 'information' })
  expect(result).toMatchObject({ dataOnly: true, products })
  expect(result).not.toHaveProperty('customerMessage')
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S11 baseline.
it('can explicitly report insufficient information without inventing a matching menu result', async () => {
  const { client } = setup('有完全不含花生的便當嗎？')
  disposals.push(beginBrowserCartTask('有完全不含花生的便當嗎？', { ...allow, informationUnavailable: () => '目前網頁資料不足，無法確認這項條件。' }))
  expect(await executeBrowserReply(client, 'information-unavailable')).toMatchObject({ effect: 'none', customerMessage: '目前網頁資料不足，無法確認這項條件。' })
  expect(client.execute).not.toHaveBeenCalled()
})

it('keeps a read-only Main handoff from consuming a plan or dispatching a cart write', async () => {
  const { client, tool, decide } = setup('每日新品一份多少錢')
  disposals.push(beginBrowserCartTask('每日新品一份多少錢', { decide, isCurrent: () => true, readOnly: true }))
  expect(await executeBrowserCartTool(client, tool, { ...addition, productRef: 'new-today', quantity: 1 })).toMatchObject({ effect: 'none', status: 'rejected' })
  expect(decide).not.toHaveBeenCalled()
  expect(client.execute).not.toHaveBeenCalled()
})

// Report: this chat, Nov1: an already verified single edit waited for another
// Main prose round, even though Host presents only the verified receipt.
it.each([
  ['移除原餐', 'browser_cart_remove', true],
  ['移除原餐，然後介紹菜單', 'browser_cart_remove', false],
  ['不要移除原餐', 'browser_cart_remove', false],
  ['把原餐改成兩份', 'browser_cart_quantity', true],
  ['把原餐改成兩份，另外來每日新品', 'browser_cart_quantity', false],
])('only marks a fully covered verified single edit complete: %s', async (text, name, complete) => {
  const { client, facts, decide, tool } = setup(text)
  const onRequestComplete = vi.fn()
  disposals.push(beginBrowserCartTask(text, { ...allow, decide, onRequestComplete }))
  client.execute.mockImplementation(async (selected: ServiceTool) => selected.name === 'browser_cart_get' ? facts : { ok: true, status: 'verified', cart: { version: 'after', lines: [] } })
  await executeBrowserCartTool(client, { ...tool, name }, { version: facts.cart.version, lineRef: 'original', quantity: 2 })
  expect(onRequestComplete).toHaveBeenCalledTimes(complete ? 1 : 0)
})

it('does not fetch product configurations when changing an existing cart line', async () => {
  const { client, tool, facts } = setup('移除原餐')
  client.execute.mockImplementation(async (selected: ServiceTool) => selected.name === 'browser_cart_get' ? { ok: true, source: 'browser', page: 'menu', cart: facts.cart } : { ok: true, status: 'verified' })
  await executeBrowserCartTool(client, { ...tool, name: 'browser_cart_remove' }, { version: facts.cart.version, lineRef: 'original' })
  expect(client.execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_get' }), { includeCatalog: false })
})

// Report: output/playwright/pb-electron/restored-S13-retry-anchor-sequence.json.
it.each([{ includeCatalog: 'false' }, { quantity: 99, submit: true }, {}])('calls the fixed read-only review with no model-controlled arguments (%j)', async (input) => {
  const { client, tool, decide } = setup('核對一下，還不要送')
  const review = { ...tool, name: 'browser_cart_review' }
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'cart', cart: { version: 'cart', lines: [{ ref: 'line', name: '測試餐點', quantity: 2 }], subtotal: 20 }, customerMessage: '測試餐點2份，小計20元' })
  const result = await executeBrowserCartTool(client, review, input)
  expect(result).toMatchObject({ cart: { subtotal: 20 }, customerMessage: '測試餐點2份，小計20元' })
  expect(client.execute).toHaveBeenCalledExactlyOnceWith(review, {})
  expect(decide).not.toHaveBeenCalled()
})

// Report: output/playwright/pb-electron/restored-S13-nov4-normalized-sequence.json.
it('reviews the visible nonempty cart without a reception-attribution preflight', async () => {
  const { client, tool, decide } = setup('核對一下，還不要送')
  const review = { ...tool, name: 'browser_cart_review' }
  client.execute.mockResolvedValue({ ok: true, source: 'browser', page: 'cart', cart: { version: 'cart', lines: [{ ref: 'line', name: '測試餐點', quantity: 2 }], subtotal: 20 }, customerMessage: '測試餐點2份，小計20元' })
  const result = await executeBrowserCartTool(client, review, {})
  expect(result).toMatchObject({ cart: { subtotal: 20 }, customerMessage: '測試餐點2份，小計20元' })
  expect(client.execute).toHaveBeenCalledExactlyOnceWith(review, {})
  expect(decide).not.toHaveBeenCalled()
})
// Report: this chat, Nov15; searching 雞腿 found two dishes, but the Host dropped a previously recommended match.
it.each(['recommendation', 'other-recommendations'])('preserves named matches unless the model requests other recommendations: %s', async (mode) => {
  const read: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const present = { ...read, name: 'browser_present' }
  const listeners = new Set<(event: ToolExecution) => void>()
  let sequence = 0
  const execute = vi.fn(async (tool: ServiceTool, input: Record<string, unknown>) => {
    const operationId = String(++sequence)
    const refs = input.productRefs as string[]
    const event = { tool, input, operationId, documentId: 'page', connectionId: 'connection' }
    listeners.forEach(listener => listener({ ...event, phase: 'called' }))
    const result = { ok: true, source: 'browser', customerMessage: refs.join('、'), presentation: { cue: 'shown', products: refs.map(ref => ({ ref, name: ref, price: 10 })) } }
    listeners.forEach(listener => listener({ ...event, phase: 'resolved', result }))
    return result
  })
  const client = { tools: readonly(shallowRef([read, present])), execute, availability: shallowRef<'ready'>('ready'), getDocumentId: () => 'page', onExecution: (listener: (event: ToolExecution) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  } }
  const presentation = createBrowserPresentation(client, () => 'visitor')
  const release = beginBrowserCartTask('其他推薦', { ...allow, presentation })
  try {
    await executeBrowserCartTool(client, present, { productRefs: ['甲餐', '乙餐'] })
    const refs = mode === 'other-recommendations' ? ['丙餐'] : ['乙餐', '丙餐']
    expect(await executeBrowserCartTool(client, present, { productRefs: ['乙餐', '丙餐'], mode })).toMatchObject({ customerMessage: refs.join('、'), presentation: { products: refs.map(ref => ({ ref })) } })
    expect(execute).toHaveBeenLastCalledWith(present, { productRefs: refs, mode, deferVisual: true, preservePage: false })
    expect(await executeBrowserCartTool(client, present, { productRefs: ['丙餐'], mode: 'other-recommendations' })).toMatchObject({ dataOnly: true })
    expect(execute).toHaveBeenCalledTimes(2)
  }
  finally {
    release()
    presentation.dispose()
  }
})

// Report: this chat, 2026-11-15; a known pre-dispatch stale cart was narrated as an unconfirmed write.
it('preserves the exact uncompleted purchase for replanning after native pre-dispatch cart staleness', async () => {
  const { client, tool, facts } = setup('炸排骨便當1份')
  facts.products[0].name = '炸排骨便當'
  facts.cart.lines = []
  const stale = { ok: false, source: 'browser', status: 'rejected', effect: 'none', reason: 'stale-cart', execution: { steps: [] } }
  client.execute.mockImplementation(async selected => selected.name === 'browser_cart_get' ? facts : stale)
  const result = await executeBrowserCartTool(client, tool, { ...addition, productRef: 'new-today', quantity: 1, note: '', selection: { version: 'config', variantRef: '', choices: [] } })
  expect(result).toMatchObject({ status: 'proposal_rejected', effect: 'none', dataOnly: true, needsAssistant: true, originalRequest: '炸排骨便當1份', selectedProduct: { productRef: 'new-today', name: '炸排骨便當' }, requestedQuantity: 1 })
  expect(client.execute.mock.calls.filter(([selected]) => selected.name === 'browser_cart_add')).toHaveLength(1)
})

it.each([
  { status: 'unknown', effect: 'unknown', steps: [] },
  { status: 'rejected', effect: 'partial', steps: [] },
  { status: 'rejected', effect: 'none', steps: [{ effect: 'cart' }] },
])('never converts an uncertain or dispatched stale-labelled receipt into a replannable no-effect: %j', async ({ status, effect, steps }) => {
  const { client, tool, facts } = setup('每日新品一份')
  const receipt = { ok: false, source: 'browser', status, effect, reason: 'stale-cart', execution: { steps } }
  client.execute.mockImplementation(async selected => selected.name === 'browser_cart_get' ? facts : receipt)
  expect(await executeBrowserCartTool(client, tool, { ...addition, productRef: 'new-today', quantity: 1 })).toEqual(receipt)
  expect(client.execute.mock.calls.filter(([selected]) => selected.name === 'browser_cart_add')).toHaveLength(1)
})

// Report: this chat, 2026-11-15; an already issued Main plan must not be reclassified from a bare count.
it.each(['main', 'system-one'] as const)('executes the server-admitted %s continuation without demanding the product name again', async (provider) => {
  const { client, tool, facts, decide } = setup('3份')
  facts.products[0].name = '炸排骨便當'
  Object.assign(facts.products[0], { price: 130 })
  Object.assign(facts.products[0].configurations[0], { version: 'pork-config', unitPrice: 130, groups: [] })
  const dialogue = createBrowserDialogue({ owner: () => 'current-customer', documentId: () => 'current-document', answer: async () => ({ kind: 'UNCERTAIN', provider: 'main' }) })
  disposals.push(beginBrowserCartTask('3份', { dialogue, decide, isCurrent: () => true }))
  decide.mockResolvedValue({ choice: 'ALLOW', provider, admission: 'issued-plan' })
  const result = await executeBrowserCartTool(client, tool, { ...addition, version: 'cart-version', productRef: 'new-today', quantity: 3, unitPrice: 130, note: '', selection: { version: 'pork-config', variantRef: '', choices: [] } })
  expect(result).toMatchObject({ status: 'verified' })
  expect(client.execute.mock.calls.filter(([selected]) => selected.name === 'browser_cart_add')).toHaveLength(1)
  expect(dialogue.hasPending()).toBe(false)
  expect(decide).toHaveBeenCalledTimes(1)
})

// Report: this chat, 2026-11-15; model provenance never overrides current merchant configuration or price.
it.each(['price', 'configuration'] as const)('rejects an issued plan with stale %s before any write', async (changed) => {
  const { client, tool, facts, decide } = setup('3份')
  Object.assign(facts.products[0].configurations[0], { version: 'fresh-config', unitPrice: 130, groups: [] })
  decide.mockResolvedValue({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' })
  const result = await executeBrowserCartTool(client, tool, { ...addition, version: 'cart-version', productRef: 'new-today', quantity: 3, unitPrice: changed === 'price' ? 100 : 130, note: '', selection: { version: changed === 'configuration' ? 'old-config' : 'fresh-config', variantRef: '', choices: [] } })
  expect(result).toMatchObject({ status: 'proposal_rejected', effect: 'none', dataOnly: true })
  expect(client.execute.mock.calls.filter(([selected]) => selected.name === 'browser_cart_add')).toHaveLength(0)
})

// Report: this chat, Nov15; a generic ALLOW cannot replace a consumed issued plan.
it('does not dispatch a generic ALLOW without exact issued-plan admission', async () => {
  const { client, tool, decide } = setup('每日新品一份')
  decide.mockResolvedValue({ choice: 'ALLOW', provider: 'main' })
  expect(await executeBrowserCartTool(client, tool, addition)).toMatchObject({ status: 'clarification', effect: 'none' })
  expect(client.execute.mock.calls.filter(([selected]) => selected.name === 'browser_cart_add')).toHaveLength(0)
})

// Report: /tmp/pb-single-decision-correction-entries.json seq69–86; Main stopped after only part of a compound request.
it('returns tool-scoped completion with the complete original request and verified effects after replacement', async () => {
  const request = '我要每日新品3份。原餐只要1份。'
  const { client, tool, facts, decide } = setup(request)
  facts.cart.lines[0].quantity = 3
  Object.assign(facts.cart.lines[0], { productRef: 'original-product', configuration: 'plain', options: [], note: '' })
  const onRequestComplete = vi.fn()
  disposals.push(beginBrowserCartTask(request, { decide, isCurrent: () => true, onRequestComplete }))
  client.execute.mockImplementation(async selected => selected.name === 'browser_cart_get' ? facts : { ok: true, source: 'browser', status: 'verified', effect: 'applied', cart: { version: 'after-replacement' }, effectMessage: '已替換每日新品2份，原餐保留1份。' })
  const result = await executeBrowserCartTool(client, { ...tool, name: 'browser_cart_replace' }, { version: 'cart-version', lineRef: 'original', productRef: 'new-today', quantity: 2, retainQuantity: 1, unitPrice: 10, note: '', selection: { version: 'config', variantRef: '', choices: [] } })
  expect(result).toMatchObject({ status: 'verified', completionScope: 'tool-call', originalRequest: request, completedEffects: ['已替換每日新品2份，原餐保留1份。'] })
  expect(onRequestComplete).not.toHaveBeenCalled()
})
