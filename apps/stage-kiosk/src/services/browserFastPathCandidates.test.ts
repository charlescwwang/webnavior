import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { expect, it, vi } from 'vitest'

import { createBrowserDialogue } from './browserDialogue'
import { createBrowserFastPathSource } from './browserFastPath'

const tools: ServiceTool[] = ['browser_state_get', 'browser_cart_get', 'browser_observe', 'browser_product_get', 'browser_open_product', 'browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_review', 'browser_return_menu', 'browser_present'].map(name => ({ name, description: name, inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }))
const products = ['炸排骨便當', '炸雞腿便當'].map((name, index) => ({ ref: `p-${index}`, name, price: 130 + index * 10, kind: 'product', priceType: 1, configurations: [{ version: `config-${index}`, variantRef: '', name, unitPrice: 130 + index * 10, groups: [] }] }))
const emptyFacts = () => ({ ok: true, source: 'browser', page: 'menu', cart: { version: 'cart-1', lines: [] }, products })

// Report: this chat, Nov14; artificial fixed two-serving candidates obscured
// whether the production generator itself offered unsupported mutations.
it('separates a missing quantity question from an executable addition', async () => {
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools, read: async () => emptyFacts(), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: '我要炸排骨便當' })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:ask-quantity' })]) })
  expect(context).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]) })
  await source.execute({ candidateId: 'intent:ask-quantity' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_ask_quantity' }), { productRef: 'p-0' })
})

it.each(['看購物車', '你好', '好', '炸排骨便當兩份一共多少錢？', '炸排骨便當兩份有沒有辣？', '不要炸排骨便當', '幫我加兩份炸排骨便當，再打開購物車', '炸排骨便當兩份，再推薦三樣'])('does not invent a direct purchase for %s', async (transcript) => {
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools, read: async () => emptyFacts(), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript })
  expect(context).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]) })
  expect(context).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-items' })]) })
  expect(execute).not.toHaveBeenCalled()
})

it.each(['炸排骨便當兩份', '給我兩份炸排骨便當', '炸排骨便當再加兩份'])('binds explicit servings to the current product instead of a test default: %s', async (transcript) => {
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools, read: async () => emptyFacts(), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  await source.context({ transcript })
  await source.execute({ candidateId: 'intent:add-item' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ productRef: 'p-0', quantity: 2, unitPrice: 130, version: 'cart-1' }))
})

it('keeps a total-quantity edit distinct from another addition', async () => {
  const execute = vi.fn(async () => ({ ok: true }))
  const facts = { ...emptyFacts(), cart: { version: 'cart-2', lines: [{ ref: 'line-7', productRef: 'p-0', name: '炸排骨便當', quantity: 4, unitPrice: 130 }] } }
  const source = createBrowserFastPathSource({ tools, read: async () => facts, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: '炸排骨便當改成兩份' })
  expect(context).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]) })
  await source.execute({ candidateId: 'intent:set-quantity' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_quantity' }), { version: 'cart-2', lineRef: 'line-7', quantity: 2 })
})

it('does not choose a cart row when duplicate dish rows exist', async () => {
  const facts = { ...emptyFacts(), cart: { version: 'cart-3', lines: [{ ref: 'a', name: '炸排骨便當', quantity: 1 }, { ref: 'b', name: '炸排骨便當', quantity: 2 }] } }
  const source = createBrowserFastPathSource({ tools, read: async () => facts, execute: async () => ({}), hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  expect(await source.context({ transcript: '炸排骨便當改成兩份' })).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:set-quantity' })]) })
})

it('describes a real product-choice answer as the issued question instead of a quantity answer', async () => {
  const facts = emptyFacts()
  const dialogue = createBrowserDialogue({ owner: () => 'visitor-1', documentId: () => 'document-1', answer: async () => ({ kind: 'UNCERTAIN', provider: 'main' }) })
  dialogue.presentProducts(facts, '便當', '我要便當')
  expect(dialogue.canAnswerLocally(facts, '炸排骨便當')).toBe(true)
  const question = dialogue.conversation(facts).waitingFor!
  const source = createBrowserFastPathSource({ tools, read: async () => facts, execute: async () => ({}), hasPendingQuestion: dialogue.hasPending, pendingQuestion: raw => dialogue.conversation(raw).waitingFor, canAnswerLocally: dialogue.canAnswerLocally })
  const context = await source.context({ transcript: '炸排骨便當' })
  expect(context).toMatchObject({ waitingFor: { questionId: question.questionId }, candidates: [{ id: 'answer:current', description: expect.stringContaining(question.question) }] })
  expect(context).toMatchObject({ candidates: [{ description: expect.not.stringContaining('份數問題') }] })
})

it('offers search cancellation without exposing unrelated purchase choices', async () => {
  const source = createBrowserFastPathSource({ tools, read: async () => ({ ...emptyFacts(), search: '蜜汁雞排' }), execute: async () => ({}), hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  expect(await source.context({ transcript: '那我不要了' })).toMatchObject({ menuSearch: { query: '蜜汁雞排' }, candidates: [{ id: 'intent:return-menu' }] })
})

// Report: this chat; verify missing production choices before comparing models.
it.each(['三杯雞便當', '三杯雞'])('preserves the numeric dish name or alias when compiling a cart edit: %s', async (label) => {
  const execute = vi.fn(async () => ({ ok: true }))
  const dish = { ...products[0], name: '三杯雞便當' }
  const facts = { ...emptyFacts(), products: [dish], cart: { version: 'cart-edit', lines: [{ ref: 'chicken', productRef: dish.ref, name: dish.name, quantity: 4 }] } }
  const source = createBrowserFastPathSource({ tools, read: async () => facts, execute, catalogLabels: () => [{ name: dish.name, aliases: ['三杯雞'], category: '' }], hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: `${label}改成兩份` })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:set-quantity' })]) })
  await source.execute({ candidateId: 'intent:set-quantity' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_quantity' }), { version: 'cart-edit', lineRef: 'chicken', quantity: 2 })
})

// Intentionally invalid alias injection checks containment defense only. It is
// not an approved restaurant alias or a semantic model-comparison question.
it('defends a multi-item target against an intentionally invalid category alias', async () => {
  const execute = vi.fn(async () => ({ ok: true }))
  const dishes = [{ ...products[0], name: 'A套餐' }, { ...products[1], name: 'B套餐' }, { ...products[0], ref: 'p-soup', name: '蛋花湯' }]
  const source = createBrowserFastPathSource({ tools, read: async () => ({ ...emptyFacts(), products: dishes }), execute, catalogLabels: () => [{ name: 'B套餐', aliases: ['套餐'], category: '' }], hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: 'A套餐兩份、蛋花湯一份' })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:add-items' })]) })
  await source.execute({ candidateId: 'intent:add-items' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_add_items' }), { items: [{ name: 'A套餐', quantity: 2 }, { name: '蛋花湯', quantity: 1 }] })
})

it.each([{ page: 'menu', screen: 'menu' }, { page: 'cart', screen: 'cart_review' }])('passes the actual $page screen and cart target count to the decision', async ({ page, screen }) => {
  const facts = { ...emptyFacts(), page, cart: { version: 'cart-screen', lines: [{ ref: 'pork', name: '炸排骨便當', quantity: 2 }] } }
  const source = createBrowserFastPathSource({ tools, read: async () => facts, execute: async () => ({}), hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  expect(await source.context({ transcript: '炸排骨便當改成一份' })).toMatchObject({ interactionState: { screen, matchingCartLines: 1 } })
})

it.each([
  { productRef: 'p-retired', name: '炸排骨便當', expected: false },
  { productRef: 'p-0', name: '購物車的簡短顯示名稱', expected: true },
])('uses the actual cart product reference instead of assuming display names identify a product: $productRef', async ({ productRef, name, expected }) => {
  const execute = vi.fn(async () => ({ ok: true }))
  const facts = { ...emptyFacts(), cart: { version: 'cart-identity', lines: [{ ref: 'actual-row', productRef, name, quantity: 4 }] } }
  const source = createBrowserFastPathSource({ tools, read: async () => facts, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript: '炸排骨便當改成兩份' })
  const quantity = expect.objectContaining({ id: 'intent:set-quantity' })
  expect(context).toMatchObject({ candidates: expected ? expect.arrayContaining([quantity]) : expect.not.arrayContaining([quantity]) })
  if (expected) {
    await source.execute({ candidateId: 'intent:set-quantity' })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_quantity' }), { version: 'cart-identity', lineRef: 'actual-row', quantity: 2 })
  }
})

// Report: this chat, 2026-11-23. A spoken serving should compile even when
// the customer says 一碗 or introduces the item with 我要點.
it.each([
  { name: '紅燒牛肉麵', transcript: '紅燒牛肉麵一碗' },
  { name: '紅燒牛肉麵', transcript: '我要點一碗紅燒牛肉麵' },
  { name: '周氏水餃(最低8顆)', transcript: '我要點水餃一份' },
])('compiles $transcript as one serving without a quantity question', async ({ name, transcript }) => {
  const product = { ...products[0], name, configurations: [{ ...products[0].configurations[0], name }] }
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools, catalogLabels: () => [{ name, aliases: name.startsWith('周氏') ? ['水餃'] : [], category: '' }], read: async () => ({ ...emptyFacts(), products: [product] }), execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  const context = await source.context({ transcript })
  expect(context).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ id: 'intent:add-item' })]) })
  expect(context).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:ask-quantity' })]) })
  expect(context).toMatchObject({ candidates: expect.not.arrayContaining([expect.objectContaining({ id: 'intent:recommend' })]) })
  await source.execute({ candidateId: 'intent:add-item' })
  expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 1 }))
})

it.each(['這樣就好', '先這樣好了', '點好了'])('offers cart review for %s after ordering without a pending question', async (transcript) => {
  const facts = { ...emptyFacts(), cart: { version: 'draft', lines: [{ ref: 'line', name: '炸排骨便當', productRef: 'p-0', quantity: 1, unitPrice: 130, configuration: 'plain' }] } }
  const execute = vi.fn(async () => ({ ok: true }))
  const source = createBrowserFastPathSource({ tools, read: async () => facts, execute, hasPendingQuestion: () => false, pendingQuestion: () => undefined })
  expect(await source.context({ transcript })).toMatchObject({ candidates: [{ id: 'intent:view-cart' }] })
  await source.execute({ candidateId: 'intent:view-cart' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_review' }), {})
})
