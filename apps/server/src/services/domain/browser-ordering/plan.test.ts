import type { kioskInteractionEntries } from '../../../schemas/kiosk'

import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { browserPlanSchema } from './contracts'
import { resolvePlan } from './plan'

type Entry = typeof kioskInteractionEntries.$inferSelect
function entry(id: string, kind: Entry['kind'], content: string, metadata: Entry['metadata'] = {}): Entry {
  return { id, kind, content, metadata, createdAt: new Date(), sequence: 1, visitorSessionId: 'visitor' }
}
const effect = { transcript: '雞腿飯兩份', action: 'add', description: '新增雞腿飯兩份', note: '', serving: { productName: '雞腿飯', variantName: '', options: [] }, deltas: [{ name: '雞腿飯', kind: 'product', mode: 'increase', quantity: 2 }] }
const args = { version: 'cart', productRef: 'private-product', quantity: 2, unitPrice: 100, note: '', selection: { version: 'spec', variantRef: '', choices: [] } }

it.each([8, 10])('binds a public dumpling piece count of %i to exactly the compiled extras', (pieces) => {
  const input = { items: [{ name: '周氏水餃(最低8顆)', quantity: 2, piecesPerServing: pieces }] }
  const entries = [entry('user', 'user_text', '水餃兩份'), entry('issued', 'assistant_text', '', { browserAuthority: { source: 'main', userEntryId: 'user', readOnly: false }, toolCalls: [{ id: 'pieces', function: { name: 'add_items_to_cart', arguments: JSON.stringify(input) } }] })]
  const options = pieces === 8 ? [] : [{ name: '水餃1顆', quantity: pieces - 8 }]
  const plan = parse(browserPlanSchema, { source: 'main', toolName: 'browser_cart_add', arguments: JSON.stringify({ ...args, quantity: 2 }), effect: { ...effect, transcript: '水餃兩份', serving: { productName: input.items[0].name, variantName: '', options }, deltas: [{ name: input.items[0].name, kind: 'product', mode: 'increase', quantity: 2 }] } })
  expect(resolvePlan(entries, plan)).toMatchObject({ provider: 'main' })
  expect(resolvePlan(entries, { ...plan, effect: { ...plan.effect, serving: { ...plan.effect.serving!, options: [{ name: '水餃1顆', quantity: 4 }] } } })).toBeUndefined()
})

it('binds copying customization to the observed source and preserves unspecified options', () => {
  const input = { items: [{ name: '雞腿飯', quantity: 2, copyFrom: { name: '雞腿飯', note: '飯少' } }] }
  const entries = [entry('user', 'user_text', '再兩份一樣的'), entry('issued', 'assistant_text', '', { browserAuthority: { source: 'main', userEntryId: 'user', readOnly: false }, toolCalls: [{ id: 'copy', function: { name: 'add_items_to_cart', arguments: JSON.stringify(input) } }] })]
  const options = [{ name: '蛋', quantity: 1 }]
  const plan = parse(browserPlanSchema, { source: 'main', toolName: 'browser_cart_add', arguments: JSON.stringify({ ...args, copySourceRef: 'source', note: '飯少' }), effect: { ...effect, transcript: '再兩份一樣的', note: '飯少', copySource: { name: '雞腿飯', quantity: 1, options, note: '飯少' }, serving: { productName: '雞腿飯', variantName: '', options } } })
  expect(resolvePlan(entries, plan)).toMatchObject({ provider: 'main' })
  expect(resolvePlan(entries, { ...plan, effect: { ...plan.effect, serving: { ...plan.effect.serving!, options: [] } } })).toBeUndefined()
})

it('admits a complete finite dumpling request but rejects a changed extra quantity', () => {
  const transcript = '周氏水餃(最低8顆)十顆兩份'
  const name = '周氏水餃(最低8顆)'
  const entries = [entry('user', 'user_text', transcript, { utteranceId: 19 }), entry('finite', 'service_event', '', { browserAuthority: { source: 'system-one', actionId: 'intent:add-item', transcript, utteranceId: 19 } })]
  const plan = parse(browserPlanSchema, { source: 'system-one', toolName: 'browser_cart_add', arguments: JSON.stringify({ ...args, selection: { version: 'cfg', variantRef: '', choices: [{ ref: 'dumpling', quantity: 2 }] } }), effect: { ...effect, transcript, serving: { productName: name, variantName: '', options: [{ name: '水餃1顆', quantity: 2 }] }, deltas: [{ name, kind: 'product', mode: 'increase', quantity: 2 }, { name: '水餃1顆', kind: 'option', mode: 'increase', quantity: 4 }] } })
  expect(resolvePlan(entries, plan)).toMatchObject({ provider: 'system-one' })
  expect(resolvePlan(entries, { ...plan, effect: { ...plan.effect, serving: { ...plan.effect.serving!, options: [{ name: '水餃1顆', quantity: 3 }] } } })).toBeUndefined()
})

it('matches a public Main item call to its privately compiled native addition and rejects changed counts', () => {
  const entries = [entry('user', 'user_text', effect.transcript), entry('issued', 'assistant_text', '', { browserAuthority: { source: 'main', userEntryId: 'user', readOnly: false }, toolCalls: [{ id: 'call', function: { name: 'add_items_to_cart', arguments: JSON.stringify({ items: [{ name: '雞腿飯', quantity: 2 }] }) } }] })]
  const plan = parse(browserPlanSchema, { source: 'main', toolName: 'browser_cart_add', arguments: JSON.stringify(args), effect })
  expect(resolvePlan(entries, plan)).toMatchObject({ provider: 'main', userEntryId: 'user' })
  expect(resolvePlan(entries, { ...plan, arguments: JSON.stringify({ ...args, quantity: 3 }) })).toBeUndefined()
})
it('matches finite final quantities to the selected operation instead of add-only admission', () => {
  const transcript = '雞腿飯改成兩份'
  const entries = [entry('user', 'user_text', transcript, { utteranceId: 4 }), entry('finite', 'service_event', '', { browserAuthority: { source: 'system-one', actionId: 'intent:set-quantity', transcript, utteranceId: 4 } })]
  const plan = parse(browserPlanSchema, { source: 'system-one', toolName: 'browser_cart_quantity', arguments: JSON.stringify({ version: 'cart', lineRef: 'line', quantity: 2 }), effect: { transcript, action: 'quantity', description: '修改兩份', cartTarget: { selected: { name: '雞腿飯', quantity: 3 }, others: [] }, deltas: [{ name: '雞腿飯', kind: 'cart_line', mode: 'set', quantity: 2 }] } })
  expect(resolvePlan(entries, plan)).toMatchObject({ provider: 'system-one' })
  expect(resolvePlan(entries, { ...plan, effect: { ...plan.effect, action: 'remove' } })).toBeUndefined()
})

it('uses only uniquely published aliases for finite addition admission', () => {
  const transcript = '招牌再一份'
  const entries = [entry('user', 'user_text', transcript, { utteranceId: 8 }), entry('finite', 'service_event', '', { browserAuthority: { source: 'system-one', actionId: 'intent:add-item', transcript, utteranceId: 8 } })]
  const plan = parse(browserPlanSchema, { source: 'system-one', toolName: 'browser_cart_add', arguments: JSON.stringify({ ...args, quantity: 1 }), effect: { ...effect, transcript, deltas: [{ name: '雞腿飯', kind: 'product', mode: 'increase', quantity: 1 }] } })
  expect(resolvePlan(entries, plan)).toBeUndefined()
  expect(resolvePlan(entries, plan, [{ name: '雞腿飯', aliases: ['招牌'], category: '' }])).toMatchObject({ provider: 'system-one' })
  expect(resolvePlan(entries, plan, [{ name: '雞腿飯', aliases: ['招牌'], category: '' }, { name: '排骨飯', aliases: ['招牌'], category: '' }])).toBeUndefined()
})
it('assigns distinct finite claim keys to the complete batch and refuses extra effects', () => {
  const transcript = '雞腿飯兩份、蛋花湯一份'
  const entries = [entry('user', 'user_text', transcript, { utteranceId: 9 }), entry('finite', 'service_event', '', { browserAuthority: { source: 'system-one', actionId: 'intent:add-items', transcript, utteranceId: 9 } })]
  const first = parse(browserPlanSchema, { source: 'system-one', toolName: 'browser_cart_add', arguments: JSON.stringify(args), effect: { ...effect, transcript } })
  const second = parse(browserPlanSchema, { ...first, arguments: JSON.stringify({ ...args, quantity: 1 }), effect: { ...effect, transcript, serving: { productName: '蛋花湯', variantName: '', options: [] }, deltas: [{ name: '蛋花湯', kind: 'product', mode: 'increase', quantity: 1 }] } })
  expect(resolvePlan(entries, first)?.key).not.toBe(resolvePlan(entries, second)?.key)
  expect(resolvePlan(entries, second)).toMatchObject({ provider: 'system-one' })
  expect(resolvePlan(entries, { ...second, effect: { ...second.effect, deltas: [...second.effect.deltas, { name: '加料', kind: 'option', mode: 'increase', quantity: 1 }] } })).toBeUndefined()
})

it.each(['set_cart_item_quantity', 'remove_items_from_cart'] as const)('matches the named cart target for %s and refuses another configuration', (name) => {
  const target = { name: '雞腿飯', configuration: '原味', note: '' }
  const input = name === 'set_cart_item_quantity' ? { target, quantity: 2 } : { targets: [target] }
  const entries = [entry('user', 'user_text', '雞腿飯改一下'), entry('issued', 'assistant_text', '', { browserAuthority: { source: 'main', userEntryId: 'user', readOnly: false }, toolCalls: [{ id: 'cart', function: { name, arguments: JSON.stringify(input) } }] })]
  const remove = name === 'remove_items_from_cart'
  const plan = parse(browserPlanSchema, { source: 'main', toolName: remove ? 'browser_cart_remove' : 'browser_cart_quantity', arguments: JSON.stringify({ version: 'cart', lineRef: 'line', ...(remove ? {} : { quantity: 2 }) }), effect: { transcript: '雞腿飯改一下', action: remove ? 'remove' : 'quantity', description: '指定購物車餐點', cartTarget: { selected: { ...target, quantity: 3 }, others: [] }, deltas: [{ name: '雞腿飯', kind: 'cart_line', mode: remove ? 'remove' : 'set', quantity: remove ? 3 : 2 }] } })
  expect(resolvePlan(entries, plan)).toMatchObject({ provider: 'main' })
  expect(resolvePlan(entries, { ...plan, effect: { ...plan.effect, cartTarget: { ...plan.effect.cartTarget!, selected: { ...plan.effect.cartTarget!.selected, configuration: '加辣' } } } })).toBeUndefined()
})
it('binds a partial replacement to its requested new meal and retained original quantity', () => {
  const target = { name: '排骨飯', quantity: 3 }
  const input = { target: { name: '排骨飯' }, replaceQuantity: 2, replacement: { name: '雞腿飯' } }
  const entries = [entry('user', 'user_text', '排骨飯兩份換雞腿飯'), entry('issued', 'assistant_text', '', { browserAuthority: { source: 'main', userEntryId: 'user', readOnly: false }, toolCalls: [{ id: 'replace', function: { name: 'replace_item_in_cart', arguments: JSON.stringify(input) } }] })]
  const plan = parse(browserPlanSchema, { source: 'main', toolName: 'browser_cart_replace', arguments: JSON.stringify({ ...args, lineRef: 'line', retainQuantity: 1 }), effect: { ...effect, transcript: '排骨飯兩份換雞腿飯', action: 'replace', cartTarget: { selected: target, others: [] }, deltas: [...effect.deltas, { name: '排骨飯', kind: 'cart_line', mode: 'remove', quantity: 2 }] } })
  expect(resolvePlan(entries, plan)).toMatchObject({ provider: 'main' })
  expect(resolvePlan(entries, { ...plan, arguments: JSON.stringify({ ...args, retainQuantity: 0 }) })).toBeUndefined()
})

// Report: this chat, Nov14 audit — public alias resolution must survive Server admission.
it.each(['add_items_to_cart', 'set_cart_item_quantity', 'remove_items_from_cart'])('admits a uniquely published alias through %s, never a shared alias', (name) => {
  const input = name === 'add_items_to_cart' ? { items: [{ name: '招牌', quantity: 2 }] } : name === 'set_cart_item_quantity' ? { target: { name: '招牌' }, quantity: 2 } : { targets: [{ name: '招牌' }] }
  const toolName = name === 'add_items_to_cart' ? 'browser_cart_add' : name === 'set_cart_item_quantity' ? 'browser_cart_quantity' : 'browser_cart_remove'
  const action = name === 'add_items_to_cart' ? 'add' : name === 'set_cart_item_quantity' ? 'quantity' : 'remove'
  const entries = [entry('user', 'user_text', effect.transcript), entry('issued', 'assistant_text', '', { browserAuthority: { source: 'main', userEntryId: 'user', readOnly: false }, toolCalls: [{ id: 'alias', function: { name, arguments: JSON.stringify(input) } }] })]
  const plan = parse(browserPlanSchema, { source: 'main', toolName, arguments: JSON.stringify({ ...args, lineRef: 'line' }), effect: { ...effect, action, cartTarget: { selected: { name: '雞腿飯', quantity: 2 }, others: [] }, deltas: [{ name: '雞腿飯', kind: action === 'add' ? 'product' : 'cart_line', mode: action === 'add' ? 'increase' : action === 'quantity' ? 'set' : 'remove', quantity: 2 }] } })
  expect(resolvePlan(entries, plan, [{ name: '雞腿飯', aliases: ['招牌'], category: '' }])).toMatchObject({ provider: 'main' })
  expect(resolvePlan(entries, plan, [{ name: '雞腿飯', aliases: ['招牌'], category: '' }, { name: '排骨飯', aliases: ['招牌'], category: '' }])).toBeUndefined()
  expect(resolvePlan(entries, plan)).toBeUndefined()
})
