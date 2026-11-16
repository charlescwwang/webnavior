import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { CatalogLabel } from '@proj-airi/stage-shared/ordering-sites'
import type { OrderingToolName } from '@proj-airi/stage-shared/ordering-tools'
import type { PbCheckout } from '@proj-airi/stage-shared/pb-checkout'
import type { ProductConfiguration } from '@proj-airi/stage-shared/product-configuration'
import type { CartLine } from '@proj-airi/stage-ui/services/pbCart'

import { orderingTools } from '@proj-airi/stage-shared/ordering-tools'
import { executeTool } from '@xsai/shared-chat'
import { array, looseObject, parse, string } from 'valibot'
import { afterEach, expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { presentedQuestionSchema } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import { beginBrowserCartTask, executeBrowserCartTool, prepareBrowserQuestionAnswer, readBrowserConversation } from './browserCartTask'
import { createBrowserDialogue } from './browserDialogue'
import { createBrowserFastPathSource } from './browserFastPath'
import { createBrowserOrderingTools } from './browserOrderingTools'
import { offerCheckout } from './checkoutInvitation'
import { runFastPath } from './kiosk-fast-path'

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).forEach(dispose => dispose()))

// Report: this chat, Nov16 — real-model boundary cases fell back to generic acknowledgements.
it.each(['off-topic', 'food-safety', 'promotion-policy', 'unsupported-budget', 'unsupported-delivery', 'unsupported-taxi', 'menu-unavailable', 'unsupported-permission'] as const)('renders the %s policy without website effects or consuming the pending meal question', async (replyType) => {
  const { call, dialogue, execute } = setup('先問其他事情', true)
  const servicePolicyReply = vi.fn(() => `localized ${replyType}`)
  cleanup.push(beginBrowserCartTask('先問其他事情', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue, servicePolicyReply }))
  const result = await call('reply_to_customer', { replyType })
  expect(result.customerMessage).toBe(`localized ${replyType}`)
  expect(result.effect).toBe('none')
  expect(servicePolicyReply).toHaveBeenCalledWith(replyType)
  expect(execute).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(true)
})
function setup(transcript: string, pending = false, labels: CatalogLabel[] = []) {
  const answer = vi.fn<Parameters<typeof createBrowserDialogue>[0]['answer']>(async () => ({ kind: 'UNCERTAIN', provider: 'unavailable' }))
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'document', answer, catalogLabels: () => labels })
  const configuration: ProductConfiguration = { version: 'config', variantRef: '', name: '', unitPrice: 100, groups: [] }
  const lines: CartLine[] = [{ ref: 'line', productRef: 'chicken', name: '雞腿飯', quantity: 3, configuration: '', unitPrice: 100, note: '', options: [] }]
  const facts = { ok: true, source: 'browser', cart: { version: 'cart', lines }, products: [{ ref: 'chicken', name: '雞腿飯', price: 100, kind: 'product', priceType: 1, configurations: [configuration] }] }
  const checkout: PbCheckout = { methods: [{ method: 'none', label: '無載具', selected: true }, { method: 'carrier', label: '手機載具', selected: false }], fields: [], missing: ['請填寫通知手機或電子信箱。'], ready: false, orderNote: '', total: 300 }
  const names = ['browser_table_select', 'browser_start_ordering', 'browser_open_product', 'browser_clarify_product', 'browser_cart_get', 'browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace', 'browser_cart_review', 'browser_product_get', 'browser_present', 'browser_close_product', 'browser_search', 'browser_return_menu', 'browser_checkout_prepare', 'browser_invoice_select', 'browser_notification_phone', 'browser_order_submit']
  const tools = shallowRef<ServiceTool[]>(names.map(name => ({ name, description: '', inputSchema: { type: 'object' }, origin: 'http://127.0.0.1:5188' })))
  const execute = vi.fn<(tool: ServiceTool, input: Record<string, unknown>) => Promise<unknown>>(async (tool, input) => {
    if (['browser_checkout_prepare', 'browser_invoice_select', 'browser_notification_phone'].includes(tool.name)) {
      if (tool.name === 'browser_invoice_select') {
        checkout.methods.forEach(method => method.selected = method.method === input.method)
        const method = checkout.methods.find(method => method.selected)!
        checkout.fields = method.method === 'none' ? [] : [{ kind: method.method, label: method.label, value: '', valid: false }]
        checkout.ready = false
      }
      if (tool.name === 'browser_notification_phone') {
        checkout.fields = [...checkout.fields.filter(field => field.kind !== 'phone'), { kind: 'phone', label: '通知手機', value: String(input.phone), valid: true }]
        checkout.ready = checkout.fields.every(field => field.valid)
        checkout.missing = checkout.fields.filter(field => !field.valid).map(field => `請填寫${field.label}。`)
      }
      return { ok: true, source: 'browser', page: 'cart', dataOnly: true, cart: structuredClone(facts.cart), checkout: { ...structuredClone(checkout), ...(checkout.ready && tool.name === 'browser_checkout_prepare' ? { confirmationToken: 'native-once' } : {}) } }
    }
    if (tool.name === 'browser_order_submit')
      return { ok: true, source: 'browser', code: 'order-submission-starting', effect: 'pending', confirmationToken: input.confirmationToken, customerMessage: '已按下送出訂單。' }
    if (tool.name === 'browser_cart_get')
      return structuredClone(facts)
    if (['browser_table_select', 'browser_start_ordering'].includes(tool.name))
      return { ok: true, source: 'browser', selectedTable: input.name }
    if (tool.name === 'browser_open_product')
      return { ok: true, source: 'browser', dataOnly: true }
    if (tool.name === 'browser_close_product' || tool.name === 'browser_search')
      return { ok: true, source: 'browser', status: 'verified', effect: 'none', customerMessage: '已更新選餐畫面。' }
    if (tool.name === 'browser_present')
      return { ok: true, source: 'browser', presentation: { cue: 'shown', products: facts.products.filter(product => Array.isArray(input.productRefs) && input.productRefs.includes(product.ref)).map(({ ref, name, price }) => ({ ref, name, price })) } }
    if (tool.name === 'browser_product_get')
      return { ok: true, source: 'browser', dataOnly: true, products: structuredClone(facts.products) }
    if (tool.name === 'browser_cart_review')
      return { ok: true, source: 'browser', status: 'verified', cart: structuredClone(facts.cart), ...('checkout' in facts ? { checkout } : {}), customerMessage: '購物車已開啟。' }
    if (tool.name === 'browser_cart_quantity')
      facts.cart.lines[0].quantity = Number(input.quantity)
    if (tool.name === 'browser_cart_add') {
      if (facts.cart.lines[0])
        facts.cart.lines[0].quantity += Number(input.quantity)
      else
        facts.cart.lines.push({ ref: 'added', productRef: String(input.productRef), name: facts.products.find(product => product.ref === input.productRef)!.name, quantity: Number(input.quantity), unitPrice: Number(input.unitPrice), configuration: '', note: '', options: [] })
    }
    if (tool.name === 'browser_cart_remove')
      facts.cart.lines.splice(0)
    facts.cart.version += '-updated'
    return { ok: true, source: 'browser', status: 'verified', effect: 'applied', cart: structuredClone(facts.cart), customerMessage: '已完成指定餐點操作。' }
  })
  if (pending)
    dialogue.presentQuantity(facts, 'chicken', '雞腿飯')
  cleanup.push(beginBrowserCartTask(transcript, { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue, catalogLabels: () => labels }))
  const publicTools = createBrowserOrderingTools({ tools: readonly(tools), execute })
  let id = 0
  const call = async (name: string, input: Record<string, unknown>) => {
    const result = await executeTool({ captureToolErrors: false, messages: [], tools: publicTools, toolCall: { id: String(++id), type: 'function', function: { name, arguments: JSON.stringify(input) } } })
    if (typeof result.message.content !== 'string')
      throw new Error('Expected JSON receipt.')
    return JSON.parse(result.message.content)
  }
  return { call, execute, facts, dialogue, answer, checkout, publicTools, client: { tools: readonly(tools), execute } }
}

// Report: this chat, Nov15: 確認無誤 / 我要用載具 repeated cart guidance instead of continuing.
it('resolves the pending cart review when Main chooses continue_checkout after a weak fast-path answer', async () => {
  const { call, facts, dialogue, answer, checkout, execute } = setup('結帳')
  Object.assign(facts, { page: 'cart', checkout })
  await call('open_cart', {})
  cleanup.push(beginBrowserCartTask('ok', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'yes', provider: 'main' })
  const result = await call('continue_checkout', {})
  expect(answer).toHaveBeenCalledOnce()
  expect(result.pendingCustomerChoice.question).toContain('發票要用哪種方式')
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_invoice_select')).toHaveLength(0)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_order_submit')).toHaveLength(0)
})

it.each(['no', 'uncertain'] as const)('does not advance checkout when the independent review answer is %s', async (choice) => {
  const { call, facts, dialogue, answer, checkout, execute } = setup('結帳')
  Object.assign(facts, { page: 'cart', checkout })
  await call('open_cart', {})
  const before = execute.mock.calls.length
  cleanup.push(beginBrowserCartTask('先看一下', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  answer.mockResolvedValueOnce(choice === 'no' ? { kind: 'ANSWER', choiceId: 'no', provider: 'main' } : { kind: 'UNCERTAIN', provider: 'main' })
  await call('continue_checkout', {})
  expect(answer).toHaveBeenCalledOnce()
  expect(execute.mock.calls.slice(before).filter(([tool]) => ['browser_checkout_prepare', 'browser_invoice_select', 'browser_order_submit'].includes(tool.name))).toHaveLength(0)
  expect(facts.cart.lines[0].quantity).toBe(3)
})

// Report: this chat, Nov15: final submission consent must remain separate from cart review.
it('advances cart confirmation to invoice fields and uses a separate one-use final submission question', async () => {
  const { call, client, facts, dialogue, answer, checkout, execute, publicTools } = setup('結帳')
  Object.assign(facts, { page: 'cart', checkout })
  const nextTurn = (text: string) => cleanup.push(beginBrowserCartTask(text, { intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const reviewed = await call('open_cart', {})
  expect(reviewed.pendingCustomerChoice.question).toContain('餐點、份數和金額正確嗎')
  nextTurn('ok')
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'yes', provider: 'system-one' })
  const answerReview = await prepareBrowserQuestionAnswer(client)
  expect(answerReview).toBeTypeOf('function')
  const invoice = await answerReview!()
  expect(invoice).toMatchObject({ dataOnly: false, pendingCustomerChoice: { question: expect.stringContaining('發票要用哪種方式') } })
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_order_submit')).toHaveLength(0)
  nextTurn('我要用載具')
  const selected = await call('choose_invoice_method', { method: 'carrier' })
  expect(selected.customerMessage).toContain('手機載具')
  expect(selected.pendingCustomerChoice.question).toContain('手機載具')
  checkout.fields[0] = { kind: 'carrier', label: '手機載具', value: '/ABC1234', valid: true }
  nextTurn('通知手機0912345678')
  await call('set_invoice_notification_phone', { phone: '0912345678' })
  nextTurn('資料填好了')
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'yes', provider: 'system-one' })
  const final = await call('continue_checkout', {})
  expect(final).toMatchObject({ dataOnly: false, pendingCustomerChoice: { question: expect.stringContaining('確認送出訂單嗎') } })
  expect(final.pendingCustomerChoice.question).toContain('雞腿飯 3 份')
  expect(final.pendingCustomerChoice.question).toContain('總金額300元')
  expect(final.pendingCustomerChoice.question).toContain('0912345678')
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_order_submit')).toHaveLength(0)
  expect(publicTools.some(tool => tool.function.name === 'browser_order_submit')).toBe(false)
  nextTurn('好')
  const answerSubmission = await prepareBrowserQuestionAnswer(client)
  expect(answerSubmission).toBeTypeOf('function')
  const submitted = await answerSubmission!()
  expect(submitted).toMatchObject({ code: 'order-submission-starting', effect: 'pending' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_order_submit' }), { confirmationToken: 'native-once' })
  await answerSubmission!()
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_order_submit')).toHaveLength(1)
})

// Report: this chat, Nov16 — "正確" adopted the default invoice without listing choices.
it('lists invoice choices when Main tries to treat cart confirmation as choosing no carrier', async () => {
  const { call, facts, dialogue, checkout, execute } = setup('結帳')
  Object.assign(facts, { page: 'cart', checkout })
  await call('open_cart', {})
  cleanup.push(beginBrowserCartTask('正確', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const result = await call('choose_invoice_method', { method: 'none' })
  expect(result.customerMessage).toContain('發票要用哪種方式')
  expect(result.customerMessage).toContain('無載具')
  expect(result.customerMessage).toContain('手機載具')
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_invoice_select')).toHaveLength(0)
})

// Report: this chat, Nov16 — phone fragments were rejected instead of accumulated.
it('collects phone fragments in the bound contact question and fills only after read-back confirmation', async () => {
  const { call, client, facts, dialogue, checkout, execute } = setup('手機載具')
  Object.assign(facts, { page: 'cart', checkout })
  await call('choose_invoice_method', { method: 'carrier' })
  checkout.fields[0] = { kind: 'carrier', label: '手機載具', value: '/ABC1234', valid: true }
  checkout.fields.push({ kind: 'phone', label: '通知手機', value: '', valid: false })
  const turn = async (text: string) => {
    cleanup.push(beginBrowserCartTask(text, { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
    const answer = await prepareBrowserQuestionAnswer(client)
    expect(answer).toBeTypeOf('function')
    return parse(looseObject({ customerMessage: string() }), await answer!())
  }
  await turn('好了')
  expect((await turn('0912')).customerMessage).toContain('4 碼')
  expect((await turn('345')).customerMessage).toContain('7 碼')
  const complete = await turn('678')
  expect(complete.customerMessage).toContain('0 9 1 2 3 4 5 6 7 8')
  expect(complete.customerMessage).toContain('正確嗎')
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_notification_phone')).toHaveLength(0)
  await turn('正確')
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_notification_phone' }), { phone: '0912345678' })
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_order_submit')).toHaveLength(0)
})

// Report: this chat, Nov16 — invoice and contact guidance were merged, then "OK" did not advance.
it('guides invoice entry and notification details one step at a time before final submission consent', async () => {
  const { call, client, facts, dialogue, checkout, execute } = setup('手機載具')
  Object.assign(facts, { page: 'cart', checkout })
  const nextTurn = (text: string) => cleanup.push(beginBrowserCartTask(text, { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const receiptSchema = looseObject({ pendingCustomerChoice: presentedQuestionSchema })
  const selected = await call('choose_invoice_method', { method: 'carrier' })
  expect(selected.pendingCustomerChoice.question).toContain('手機載具')
  expect(selected.pendingCustomerChoice.question).not.toContain('通知手機')
  expect(selected.pendingCustomerChoice.question).not.toContain('電子信箱')
  nextTurn('ok')
  const unfinished = await prepareBrowserQuestionAnswer(client)
  const repeated = parse(receiptSchema, await unfinished!())
  expect(repeated.pendingCustomerChoice.question).toContain('手機載具')
  expect(repeated.pendingCustomerChoice.question).not.toContain('通知手機')
  nextTurn('先不要')
  const wait = await prepareBrowserQuestionAnswer(client)
  const waiting = parse(receiptSchema, await wait!())
  expect(waiting.pendingCustomerChoice.question).toContain('手機載具')
  checkout.fields[0] = { kind: 'carrier', label: '手機載具', value: '/ABC1234', valid: true }
  checkout.fields.push({ kind: 'phone', label: '通知手機', value: '', valid: false }, { kind: 'email', label: '通知電子信箱', value: '', valid: false })
  checkout.missing = ['請填寫通知手機或電子信箱。']
  nextTurn('ok')
  const invoiceDone = await prepareBrowserQuestionAnswer(client)
  const contact = parse(receiptSchema, await invoiceDone!())
  expect(contact.pendingCustomerChoice.question).toContain('通知手機')
  expect(contact.pendingCustomerChoice.question).toContain('電子信箱')
  expect(contact.pendingCustomerChoice.question).not.toContain('手機載具')
  expect(contact.pendingCustomerChoice.question).not.toContain('確認送出')
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_order_submit')).toHaveLength(0)
  checkout.fields.find(field => field.kind === 'phone')!.value = '0912345678'
  checkout.fields.find(field => field.kind === 'phone')!.valid = true
  checkout.missing = []
  checkout.ready = true
  nextTurn('ok')
  const contactDone = await prepareBrowserQuestionAnswer(client)
  const summary = parse(receiptSchema, await contactDone!())
  expect(summary.pendingCustomerChoice.question).toContain('確認送出訂單嗎')
  expect(summary.pendingCustomerChoice.question).toContain('0912345678')
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_order_submit')).toHaveLength(0)
})

// Report: this chat, Nov16 19:57 — 8-piece serving was falsely reported adjusted.
it('does not dispatch or certify an unchanged serving count as a completed customization', async () => {
  const { facts, call, execute } = setup('我水餃要10顆')
  facts.products[0].name = '周氏水餃(最低8顆)'
  Object.assign(facts.cart.lines[0], { name: '周氏水餃(最低8顆)', quantity: 1, unitPrice: 64 })
  const result = await call('set_cart_item_quantity', { target: { name: '周氏水餃' }, quantity: 1 })
  expect(result.status).toBe('proposal_rejected')
  expect(result.effect).toBe('none')
  expect(result.dataOnly).toBe(true)
  expect(result.customerMessage).not.toContain('已調整')
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_quantity')).toHaveLength(0)
  expect(facts.cart.lines[0].quantity).toBe(1)
})

it('resolves the unique dumpling extra by its observed option identity instead of a group heading', async () => {
  const { facts, call, execute } = setup('水餃每份10顆，一份')
  const product = facts.products[0]
  product.name = '周氏水餃(最低8顆)'
  product.configurations[0].unitPrice = 64
  product.configurations[0].groups = [{ ref: 'extra', name: '加量選項', required: false, maximum: 100, choices: [{ ref: 'dumpling', name: '水餃1顆', unitPrice: 8, maximum: 100 }] }]
  const result = await call('add_items_to_cart', { items: [{ name: product.name, quantity: 1, piecesPerServing: 10 }] })
  expect(result.status).toBe('verified')
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 1, unitPrice: 80, selection: { version: 'config', variantRef: '', choices: [{ ref: 'dumpling', quantity: 2 }] } }))
})

// Report: this chat, Nov14; servings and dumpling extras must remain distinct.
it.each([8, 10, 12])('compiles %i dumplings per serving using current option prices', async (pieces) => {
  const { facts, call, execute } = setup('周氏水餃(最低8顆)兩份')
  const product = facts.products[0]
  product.name = '周氏水餃(最低8顆)'
  product.configurations[0].unitPrice = 64
  product.configurations[0].groups = [{ ref: 'extra', name: '加量', required: false, maximum: 100, choices: [{ ref: 'dumpling', name: '水餃1顆', unitPrice: 9, maximum: 100 }] }]
  const result = await call('add_items_to_cart', { items: [{ name: product.name, quantity: 2, piecesPerServing: pieces }] })
  expect(result.status).toBe('verified')
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 2, unitPrice: 64 + (pieces - 8) * 9, selection: { version: 'config', variantRef: '', choices: pieces === 8 ? [] : [{ ref: 'dumpling', quantity: pieces - 8 }] } }))
})

it('copies an unambiguous customized meal with its per-serving options and note', async () => {
  const { facts, call, execute } = setup('再一份一樣的')
  facts.products[0].configurations[0].groups = [{ ref: 'extras', name: '加購', required: false, maximum: 2, choices: [{ ref: 'egg', name: '蛋', unitPrice: 10, maximum: 2 }] }]
  Object.assign(facts.cart.lines[0], { options: [{ name: '蛋', quantity: 1 }], note: '飯少', unitPrice: 110 })
  expect(await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1, copyFrom: { name: '雞腿飯' } }] })).toMatchObject({ status: 'verified' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 1, note: '飯少', unitPrice: 110, selection: { version: 'config', variantRef: '', choices: [{ ref: 'egg', quantity: 1 }] } }))
})

it('changes one customized serving without dropping its other options or note', async () => {
  const { facts, call, execute } = setup('其中一份不要蛋')
  facts.products[0].configurations[0].groups = [{ ref: 'extras', name: '加購', required: false, maximum: 3, choices: [{ ref: 'egg', name: '蛋', unitPrice: 10, maximum: 2 }, { ref: 'rice', name: '飯', unitPrice: 5, maximum: 1 }] }]
  Object.assign(facts.cart.lines[0], { options: [{ name: '蛋', quantity: 1 }, { name: '飯', quantity: 1 }], note: '飯少', unitPrice: 115 })
  expect(await call('replace_item_in_cart', { target: { name: '雞腿飯' }, replaceQuantity: 1, replacement: { name: '雞腿飯', options: [{ group: '加購', name: '蛋', quantity: 0 }] } })).toMatchObject({ status: 'verified' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_replace' }), expect.objectContaining({ quantity: 1, retainQuantity: 2, note: '飯少', unitPrice: 105, selection: { version: 'config', variantRef: '', choices: [{ ref: 'rice', quantity: 1 }] } }))
})

// Report: this chat, Nov15; Main tried to set a cart serving total to zero.
it('rejects zero serving totals before website IO without leaking schema diagnostics', async () => {
  const { call, execute } = setup('雞腿飯不要了')
  const result = await call('set_cart_item_quantity', { target: { name: '雞腿飯' }, quantity: 0 })
  expect(result).toMatchObject({ ok: false, status: 'rejected', effect: 'none', code: 'INVALID_TOOL_ARGUMENTS', dataOnly: true })
  expect(result.customerMessage).toBe('餐點尚未變更，請再說一次要調整哪道餐點的份數。')
  expect(result.explanation).toContain('remove_items_from_cart')
  expect(result.customerMessage).not.toContain('Invalid')
  expect(execute).not.toHaveBeenCalled()
})

// Report: this chat, Nov15; Main supplied a second count in replacement.quantity.
it('rejects a duplicate replacement count without exposing schema errors or touching the website', async () => {
  const { call, execute } = setup('三份雞腿飯換排骨飯')
  const result = await call('replace_item_in_cart', { target: { name: '雞腿飯' }, replaceQuantity: 3, replacement: { name: '排骨飯', quantity: 3 } })
  expect(result).toMatchObject({ ok: false, status: 'rejected', effect: 'none', code: 'INVALID_TOOL_ARGUMENTS', dataOnly: true })
  expect(result.customerMessage).toBe('餐點尚未變更，請再說一次要將哪道餐點的幾份換成哪道餐點。')
  expect(result.explanation).toContain('replaceQuantity')
  expect(result.explanation).toContain('replacement')
  expect(execute).not.toHaveBeenCalled()
})

it('uses the single replacement serving count for a complete three-serving substitution', async () => {
  const { facts, call, execute } = setup('三份雞腿飯換排骨飯')
  facts.products.push({ ...facts.products[0], ref: 'pork', name: '排骨飯' })
  expect(await call('replace_item_in_cart', { target: { name: '雞腿飯' }, replaceQuantity: 3, replacement: { name: '排骨飯' } })).toMatchObject({ status: 'verified' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_replace' }), expect.objectContaining({ productRef: 'pork', lineRef: 'line', quantity: 3, retainQuantity: 0 }))
})

it('replaces servings across matching rows and does not inherit customization onto a different dish', async () => {
  const { facts, call, execute } = setup('兩份雞腿飯換排骨飯')
  facts.cart.lines[0].quantity = 1
  facts.cart.lines[0].note = '飯少'
  facts.cart.lines.push({ ...facts.cart.lines[0], ref: 'line2', quantity: 2 })
  facts.products.push({ ...facts.products[0], ref: 'pork', name: '排骨飯' })
  expect(await call('replace_item_in_cart', { target: { name: '雞腿飯' }, replaceQuantity: 2, replacement: { name: '排骨飯' } })).toMatchObject({ status: 'verified' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_replace' }), expect.objectContaining({ lineRefs: ['line', 'line2'], retainQuantity: 1, quantity: 2, note: '' }))
})

it('refuses copying among different customizations rather than selecting the first row', async () => {
  const { facts, call, execute } = setup('再一份一樣的')
  facts.cart.lines.push({ ...facts.cart.lines[0], ref: 'other', configuration: 'different' })
  expect(await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1, copyFrom: { name: '雞腿飯' } }] })).toMatchObject({ status: 'rejected' })
  expect(execute.mock.calls.some(([tool]) => tool.name === 'browser_cart_add')).toBe(false)
})

it('uses the base eight-piece serving when no extra is requested', async () => {
  const { facts, call, execute } = setup('周氏水餃一份')
  facts.products[0].name = '周氏水餃(最低8顆)'
  facts.products[0].configurations[0].unitPrice = 64
  facts.products[0].configurations[0].groups = [{ ref: 'extra', name: '加量', required: false, maximum: 100, choices: [{ ref: 'dumpling', name: '水餃1顆', unitPrice: 8, maximum: 100 }] }]
  expect(await call('add_items_to_cart', { items: [{ name: '周氏水餃', quantity: 1 }] })).toMatchObject({ status: 'verified' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 1, unitPrice: 64, selection: { version: 'config', variantRef: '', choices: [] } }))
})

it.each([7, 10])('rejects invalid or contradictory dumpling pieces before writing: %i', async (pieces) => {
  const { facts, call, execute } = setup('周氏水餃十顆一份')
  facts.products[0].name = '周氏水餃(最低8顆)'
  facts.products[0].configurations[0].groups = [{ ref: 'extra', name: '加量', required: false, maximum: 100, choices: [{ ref: 'dumpling', name: '水餃1顆', unitPrice: 8, maximum: 100 }] }]
  expect(await call('add_items_to_cart', { items: [{ name: '周氏水餃', quantity: 1, piecesPerServing: pieces, options: [{ group: '加量', name: '水餃1顆', quantity: 4 }] }] })).toMatchObject({ status: 'rejected' })
  expect(execute.mock.calls.some(([tool]) => tool.name === 'browser_cart_add')).toBe(false)
})

it('compiles additional servings without asking Main to provide IDs or prices', async () => {
  const { call, execute, facts } = setup('雞腿飯再加兩份')
  const result = await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 2 }] })
  expect(result.status).toBe('verified')
  expect(facts.cart.lines[0].quantity).toBe(5)
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ productRef: 'chicken', quantity: 2, unitPrice: 100, version: 'cart', selection: { version: 'config', variantRef: '', choices: [] } }))
})
it('sets final servings and refuses a negative quantity', async () => {
  const { call, facts, execute } = setup('雞腿飯改成兩份')
  expect((await call('set_cart_item_quantity', { target: { name: '雞腿飯' }, quantity: 2 })).status).toBe('verified')
  expect(facts.cart.lines[0].quantity).toBe(2)
  execute.mockClear()
  expect((await call('set_cart_item_quantity', { target: { name: '雞腿飯' }, quantity: -1 })).ok).toBe(false)
  expect(execute).not.toHaveBeenCalled()
})
it('reads cart and menu details without consuming a pending quantity answer or displaying products', async () => {
  const { call, dialogue, answer, execute } = setup('兩份', true)
  expect((await call('list_cart_items', {})).cart.lines[0].quantity).toBe(3)
  expect((await call('get_menu_item_details', { names: ['雞腿飯'] })).products[0].name).toBe('雞腿飯')
  expect(dialogue.hasPending()).toBe(true)
  expect(answer).not.toHaveBeenCalled()
  expect(execute.mock.calls.some(([tool]) => tool.name === 'browser_present')).toBe(false)
})
it('validates all named additions before the first write', async () => {
  const { call, execute, facts } = setup('雞腿飯一份和不存在餐一份')
  expect((await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1 }, { name: '不存在餐', quantity: 1 }] })).ok).toBe(false)
  expect(facts.cart.lines[0].quantity).toBe(3)
  expect(execute.mock.calls.some(([tool]) => tool.name === 'browser_cart_add')).toBe(false)
})
it('does not expose quote, reset, confirmation or native-parameter tools to Main', () => {
  const { publicTools } = setup('你好')
  expect(publicTools).toHaveLength(20)
  expect(publicTools.some(tool => tool.function.name.startsWith('browser_'))).toBe(false)
  expect(publicTools.some(tool => tool.function.name.includes('quote'))).toBe(false)
  expect(JSON.stringify(publicTools.map(tool => tool.function.parameters))).not.toContain('unitPrice')
  expect(JSON.stringify(publicTools.map(tool => tool.function.parameters))).not.toContain('lineRef')
})

// Report: this chat; a bound missing-quantity answer completes the purchase directly.
it('adds the named dish after its quantity answer without another add-confirmation question', async () => {
  const { execute, facts, dialogue } = setup('兩份', true)
  const toolNames = ['browser_cart_get', 'browser_cart_add']
  const tools = shallowRef<ServiceTool[]>(toolNames.map(name => ({ name, description: '', inputSchema: { type: 'object' }, origin: 'http://127.0.0.1:5188' })))
  const prepared = await prepareBrowserQuestionAnswer({ tools: readonly(tools), execute })
  expect(prepared).toBeTypeOf('function')
  expect(facts.cart.lines[0].quantity).toBe(3)
  expect(await prepared!()).toMatchObject({ status: 'verified' })
  expect(facts.cart.lines[0].quantity).toBe(5)
  expect(dialogue.hasPending()).toBe(false)
})

it('keeps recommendation assent separate from an explicit purchase with quantity', async () => {
  const { call, client, dialogue, facts } = setup('剛推薦雞腿飯')
  expect(await call('ask_customer_question', { questionType: 'purchase-recommendation', name: '雞腿飯' })).toMatchObject({ status: 'clarification' })
  cleanup.push(beginBrowserCartTask('好', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const assent = await prepareBrowserQuestionAnswer(client)
  expect(await assent!()).toMatchObject({ status: 'clarification', customerMessage: expect.stringContaining('幾份') })
  expect(facts.cart.lines[0].quantity).toBe(3)
})
it('accepts recommendation assent with an explicit serving count without asking twice', async () => {
  const { call, client, dialogue, facts } = setup('剛推薦雞腿飯')
  await call('ask_customer_question', { questionType: 'purchase-recommendation', name: '雞腿飯' })
  cleanup.push(beginBrowserCartTask('好來兩份', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const purchase = await prepareBrowserQuestionAnswer(client)
  expect(await purchase!()).toMatchObject({ status: 'verified' })
  expect(facts.cart.lines[0].quantity).toBe(5)
})
it('restores the quantity question when switching to soup is declined', async () => {
  const { call, client, dialogue, facts } = setup('有什麼湯', true)
  await call('ask_customer_question', { questionType: 'cancel-and-search', query: '湯' })
  cleanup.push(beginBrowserCartTask('不要', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const declined = await prepareBrowserQuestionAnswer(client)
  expect(await declined!()).toMatchObject({ status: 'clarification', customerMessage: expect.stringContaining('幾份') })
  expect(facts.cart.lines[0].quantity).toBe(3)
  expect(dialogue.hasPending()).toBe(true)
})
it('closes the unfinished selection and searches soup only after switch consent', async () => {
  const { call, client, dialogue, facts, execute } = setup('有什麼湯', true)
  await call('ask_customer_question', { questionType: 'cancel-and-search', query: '湯' })
  cleanup.push(beginBrowserCartTask('好', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const accepted = await prepareBrowserQuestionAnswer(client)
  expect(await accepted!()).toMatchObject({ ok: true })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_close_product' }), {})
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_search' }), { query: '湯' })
  expect(facts.cart.lines[0].quantity).toBe(3)
  expect(dialogue.hasPending()).toBe(false)
})

// Report: current redesign review; a later read failure must retain the first verified addition.
it('reports the completed item when a later batch read fails', async () => {
  const { call, execute, facts } = setup('雞腿飯一份，再一份雞腿飯')
  const original = execute.getMockImplementation()!
  execute.mockImplementation(async (tool, input) => {
    if (tool.name === 'browser_cart_get' && facts.cart.lines[0].quantity > 3)
      throw new Error('後續購物車讀取失敗')
    return original(tool, input)
  })
  const result = await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1 }, { name: '雞腿飯', quantity: 1 }] })
  expect(facts.cart.lines[0].quantity).toBe(4)
  expect(result.effect).toBe('partial')
  expect(result.results[0].status).toBe('verified')
  expect(result.customerMessage).toContain('已完成指定餐點操作')
  expect(result.customerMessage).toContain('後續購物車讀取失敗')
})

it('retains recommendation price/exclusion criteria and never recommends an excluded dish', async () => {
  const { call, execute } = setup('不要雞腿飯，100元以下的有什麼')
  const result = await call('list_menu_items', { criteria: { excludedTerms: ['雞腿'], maxUnitPrice: 100, priceScope: 'reception' } })
  expect(result.products).toEqual([])
  expect(result.recommendationCriteria).toMatchObject({ maxUnitPrice: 100, excludedTerms: ['雞腿'] })
  execute.mockClear()
  expect((await call('point_to_menu_items', { names: ['雞腿飯'], purpose: 'recommendation' })).ok).toBe(false)
  expect(execute.mock.calls.some(([tool]) => tool.name === 'browser_present')).toBe(false)
  const relaxed = await call('list_menu_items', { criteria: { clearPrice: true } })
  expect(relaxed.recommendationCriteria.excludedTerms).toEqual(['雞腿'])
  expect(relaxed.products).toEqual([])
})
it.each(['好', '不好'])('only relaxes a no-match budget after an affirmative answer: %s', async (answer) => {
  const { call, client, dialogue } = setup('看100元以下餐點')
  await call('list_menu_items', { criteria: { maxUnitPrice: 50, priceScope: 'reception' } })
  expect((await call('ask_customer_question', { questionType: 'price-range' })).pendingCustomerChoice.question).toContain('要看其他價格')
  cleanup.push(beginBrowserCartTask(answer, { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const apply = await prepareBrowserQuestionAnswer(client)
  expect(apply).toBeTypeOf('function')
  await apply!()
  expect(dialogue.recommendations.snapshot().maxUnitPrice).toBe(answer === '好' ? undefined : 50)
})

it('rejects an unknown recommendation category without poisoning the next menu read', async () => {
  const { call } = setup('有什麼湯')
  expect((await call('list_menu_items', { criteria: { category: '未設定分類' } })).ok).toBe(false)
  const next = await call('list_menu_items', {})
  expect(next.products).toHaveLength(1)
  expect(next.recommendationCriteria.category).toBeUndefined()
})

it('does not reuse an answered question as evidence for a later utterance', async () => {
  const { call, client, dialogue, facts } = setup('看便宜餐點')
  await call('list_menu_items', { criteria: { maxUnitPrice: 50 } })
  await call('ask_customer_question', { questionType: 'price-range' })
  cleanup.push(beginBrowserCartTask('好', { utteranceId: 41, isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const apply = await prepareBrowserQuestionAnswer(client)
  await apply!()
  expect(dialogue.conversation(facts, 41).answeredQuestion).toBeDefined()
  expect(dialogue.conversation(facts, 42).answeredQuestion).toBeUndefined()
})

it('asks before changing a keyword search while an unadded meal is waiting for quantity', async () => {
  const { call, execute } = setup('有什麼湯', true)
  const result = await call('search_menu_items', { query: '湯' })
  expect(result.pendingCustomerChoice.question).toBe('要先取消雞腿飯，改看湯嗎？')
  expect(execute.mock.calls.some(([tool]) => tool.name === 'browser_search')).toBe(false)
})

it('resolves the cart configuration by its readable description while retaining its private identity', async () => {
  const { call, facts } = setup('加蛋雞腿飯改成兩份')
  Object.assign(facts.cart.lines[0], { description: '加蛋 ×1', configuration: '{"optionId":123}' })
  expect((await call('set_cart_item_quantity', { target: { name: '雞腿飯', configuration: '加蛋 ×1' }, quantity: 2 })).status).toBe('verified')
  expect(facts.cart.lines[0].configuration).toBe('{"optionId":123}')
})

// Report: this chat, Nov14 audit; aliases must survive question creation too.
it.each(['purchase-recommendation', 'option'])('resolves a published alias when asking %s', async (questionType) => {
  const { call, facts } = setup('招牌', false, [{ name: '雞腿飯', aliases: ['招牌'], category: '' }])
  facts.products[0].configurations[0].groups = [{ ref: 'extras', name: '加購', required: false, maximum: 2, choices: [{ ref: 'egg', name: '蛋', unitPrice: 10, maximum: 2 }] }]
  const result = await call('ask_customer_question', { questionType, name: '招牌', ...(questionType === 'option' ? { query: '加購' } : {}) })
  expect(result.ok).toBe(true)
  expect(result.pendingCustomerChoice.question).toContain('雞腿飯')
})

it('returns a repairable question failure for an unavailable option group without losing the next request', async () => {
  const { call, execute } = setup('雞腿飯怎麼選')
  expect(await call('ask_customer_question', { questionType: 'option', name: '雞腿飯', query: '不存在的選項' })).toMatchObject({ ok: false, status: 'rejected', effect: 'none' })
  expect(execute.mock.calls.every(([tool]) => tool.name === 'browser_cart_get')).toBe(true)
  expect((await call('ask_customer_question', { questionType: 'quantity', name: '雞腿飯' })).pendingCustomerChoice.purpose).toBe('browser-order-quantity')
})

it('distinguishes customized cart rows in the question and the answer passed to Main', async () => {
  const { call, facts, dialogue, answer } = setup('改哪一份')
  Object.assign(facts.cart.lines[0], { description: '加蛋 ×1', configuration: 'private-egg', note: '少飯' })
  facts.cart.lines.push({ ...facts.cart.lines[0], ref: 'other', description: '白飯 ×1', configuration: 'private-rice', note: '少飯' })
  const result = await call('ask_customer_question', { questionType: 'cart-target' })
  expect(result.pendingCustomerChoice.choices[0].description).toContain('加蛋 ×1')
  expect(result.pendingCustomerChoice.choices[1].description).toContain('白飯 ×1')
  expect(JSON.stringify(result)).not.toContain('private-')
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'line:1', provider: 'main' })
  const resolved = await dialogue.answer(facts, '第二個', async () => facts, () => true, 77)
  expect(resolved).toMatchObject({ kind: 'receipt', result: { answeredQuestion: { purpose: 'cart-target', answer: '第二個', selectedChoice: expect.stringContaining('白飯 ×1') } } })
})

// Report: this chat, 2026-11-14 — real Main emitted {parameters:"{}"} for return_to_menu.
it('dispatches fixed menu navigation with Host-owned empty arguments', async () => {
  const { call, execute } = setup('那我不要了')
  expect(await call('return_to_menu', { parameters: '{}' })).toMatchObject({ ok: true })
  expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'browser_return_menu' }), {})
})

// Report: this chat, Nov14 — one recommended dish needs a bound next-step question.
it.each(['recommendation', 'other-recommendations'].flatMap(purpose => ['好', '好 來一份'].map(reply => ({ purpose, reply }))))('offers one serving after $purpose and adds once on $reply', async ({ purpose, reply }) => {
  const { call, client, dialogue, facts, execute } = setup('我想吃魚')
  const shown = await call('point_to_menu_items', { names: ['雞腿飯'], purpose })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_present' }), expect.objectContaining({ mode: purpose }))
  expect(shown).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-service-question', question: '要來一份雞腿飯嗎？' } })
  expect(dialogue.hasPending()).toBe(true)
  expect(facts.cart.lines[0].quantity).toBe(3)
  cleanup.push(beginBrowserCartTask(reply, { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const purchase = await prepareBrowserQuestionAnswer(client)
  expect(purchase).toBeTypeOf('function')
  expect(await purchase!()).toMatchObject({ status: 'verified' })
  expect(facts.cart.lines[0].quantity).toBe(4)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(dialogue.hasPending()).toBe(false)
})

// Report: this chat, Nov15; accepting a one-serving dumpling offer re-asked the product and quantity.
it('adds the base dumpling serving on assent without Main when the only group is optional', async () => {
  const { call, client, dialogue, facts, execute, answer } = setup('那我要吃水餃')
  facts.cart.lines.splice(0)
  const product = facts.products[0]
  product.name = '周氏水餃(最低8顆)'
  product.price = 64
  product.configurations[0].unitPrice = 64
  product.configurations[0].groups = [{ ref: 'extra', name: '加量', required: false, maximum: 100, choices: [{ ref: 'dumpling', name: '水餃1顆', unitPrice: 8, maximum: 100 }] }]
  expect(await call('point_to_menu_items', { names: [product.name], purpose: 'recommendation' })).toMatchObject({ pendingCustomerChoice: { question: '周氏水餃基本每份8顆，最少8顆，可以加量。要來一份周氏水餃嗎？' } })
  expect(dialogue.canAnswerLocally(facts, '好，來十顆')).toBe(false)
  expect(dialogue.canAnswerLocally(facts, '好，來十個')).toBe(false)
  const decide = vi.fn(async () => ({ choice: 'CLARIFY' as const, provider: 'unavailable' as const }))
  cleanup.push(beginBrowserCartTask('好', { utteranceId: 15, intentSource: 'jev', isCurrent: () => true, decide, dialogue }))
  const accept = await prepareBrowserQuestionAnswer(client)
  expect(accept).toBeTypeOf('function')
  expect(await accept!()).toMatchObject({ status: 'verified' })
  expect(facts.cart.lines).toHaveLength(1)
  expect(facts.cart.lines[0].quantity).toBe(1)
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 1, unitPrice: 64, selection: { version: 'config', variantRef: '', choices: [] } }))
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(dialogue.hasPending()).toBe(false)
  expect(answer).not.toHaveBeenCalled()
  expect(decide).not.toHaveBeenCalled()
})

// The same accepted count must work after a quantity question, regardless of the original wording.
it('adds a named dumpling serving after answering quantity without losing the subject at Main handoff', async () => {
  const { call, client, dialogue, facts, execute } = setup('那我要吃水餃')
  facts.cart.lines.splice(0)
  const product = facts.products[0]
  product.name = '周氏水餃(最低8顆)'
  product.price = 64
  product.configurations[0].unitPrice = 64
  product.configurations[0].groups = [{ ref: 'extra', name: '加量', required: false, maximum: 100, choices: [{ ref: 'dumpling', name: '水餃1顆', unitPrice: 8, maximum: 100 }] }]
  dialogue.presentQuantity(facts, product.ref, '那我要吃水餃')
  const decide = vi.fn(async () => ({ choice: 'CLARIFY' as const, provider: 'unavailable' as const }))
  cleanup.push(beginBrowserCartTask('一份', { utteranceId: 18, intentSource: 'jev', isCurrent: () => true, decide, dialogue }))
  const count = await prepareBrowserQuestionAnswer(client)
  expect(await count!()).toMatchObject({ needsAssistant: true, selectedProduct: { name: product.name }, requestedQuantity: 1 })
  expect(facts.cart.lines).toHaveLength(0)
  expect(dialogue.selectionForTurn(facts, 19)).toBeUndefined()
  expect(decide).not.toHaveBeenCalled()
  const admit = vi.fn<Parameters<typeof beginBrowserCartTask>[1]['decide']>(async effect => ({ choice: effect.transcript === '一份' ? 'ALLOW' : 'CLARIFY', provider: 'main', ...(effect.transcript === '一份' ? { admission: 'issued-plan' as const } : {}) }))
  cleanup.push(beginBrowserCartTask('一份', { utteranceId: 18, isCurrent: () => true, decide: admit, dialogue }))
  expect(await readBrowserConversation(client, 'main-handoff', client.tools.value.map(tool => tool.name))).toMatchObject({ sourceUtterance: '一份', providedSlots: { name: product.name, quantity: 1 } })
  expect(await call('add_items_to_cart', { items: [{ name: product.name, quantity: 1 }] })).toMatchObject({ status: 'verified' })
  expect(facts.cart.lines[0].quantity).toBe(1)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(admit).toHaveBeenCalledWith(expect.objectContaining({ transcript: '一份', storeFacts: expect.stringContaining('那我要吃水餃') }), expect.anything())
  expect(dialogue.selectionForTurn(facts, 18)).toBeUndefined()
})

it('keeps the accepted serving in a durable draft and asks only the required group', async () => {
  const { call, client, dialogue, facts, execute, answer } = setup('推薦雞腿飯')
  facts.cart.lines.splice(0)
  const product = facts.products[0]
  product.configurations[0].groups = [{ ref: 'drink', name: '飲料', required: true, maximum: 1, choices: [{ ref: 'tea', name: '紅茶', unitPrice: 10, maximum: 1 }] }]
  await call('point_to_menu_items', { names: [product.name], purpose: 'recommendation' })
  cleanup.push(beginBrowserCartTask('好', { utteranceId: 16, intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const accept = await prepareBrowserQuestionAnswer(client)
  expect(await accept!()).toMatchObject({ status: 'clarification', pendingCustomerChoice: { purpose: 'browser-order-slot' } })
  expect(dialogue.conversation(facts, 16)).toMatchObject({ drafts: [{ name: product.name, quantity: 1 }] })
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(0)
  answer.mockResolvedValue({ kind: 'ANSWER', choiceId: 'option:tea', provider: 'main' })
  const decide = vi.fn<Parameters<typeof beginBrowserCartTask>[1]['decide']>(async effect => ({ choice: effect.transcript === '紅茶' ? 'ALLOW' : 'CLARIFY', provider: 'main', ...(effect.transcript === '紅茶' ? { admission: 'issued-plan' as const } : {}) }))
  cleanup.push(beginBrowserCartTask('紅茶', { utteranceId: 17, intentSource: 'jev', isCurrent: () => true, decide, dialogue }))
  const choose = await prepareBrowserQuestionAnswer(client)
  const completed = await choose!()
  expect(completed, JSON.stringify(completed)).toMatchObject({ status: 'verified' })
  expect(facts.cart.lines[0].quantity).toBe(1)
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ transcript: '紅茶', storeFacts: expect.stringContaining('顧客回答「好」') }), expect.anything())
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ quantity: 1, unitPrice: 110, selection: { version: 'config', variantRef: '', choices: [{ ref: 'tea', quantity: 1 }] } }))
})

// Report: this chat, Nov15 — Jev's multi-dish recommendation stopped without a question.
it.each(['jev', 'main'] as const)('binds only actually recommended dishes and completes the %s selection', async (path) => {
  const { call, client, dialogue, facts, execute, answer } = setup('推薦三樣')
  facts.cart.lines.splice(0)
  for (const [ref, name] of [['pork', '排骨飯'], ['fish', '魚排飯'], ['soup', '蛋花湯']])
    facts.products.push({ ...facts.products[0], ref, name })
  let result: unknown
  if (path === 'main') {
    result = await call('point_to_menu_items', { names: ['魚排飯', '雞腿飯'], purpose: 'recommendation' })
  }
  else {
    const source = createBrowserFastPathSource({ tools: client.tools.value, read: async () => structuredClone(facts), execute: (tool, input) => executeBrowserCartTool(client, tool, input), hasPendingQuestion: dialogue.hasPending, pendingQuestion: raw => dialogue.conversation(raw).waitingFor })
    const observed = vi.fn(async () => {})
    const outcome = await runFastPath({ transcript: '推薦三樣', source, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:recommend', confidence: 0.95 }), isEnabled: async () => true, webMcp: { tools: client.tools.value, execute }, onExecuted: observed })
    // Recommendation facts and the question must reach the normal receipt
    // presenter together, which starts reply-synchronized highlighting.
    expect(outcome.kind).toBe('FAST_ACTION')
    expect(observed).toHaveBeenCalledOnce()
    result = outcome.kind === 'FAST_ACTION' ? outcome.result : undefined
  }
  expect(result).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-product-choice' } })
  const shown = parse(looseObject({ presentation: looseObject({ products: array(looseObject({ name: string() })) }), pendingCustomerChoice: looseObject({ questionId: string() }), customerMessage: string() }), result)
  const names = shown.presentation.products.map(product => product.name)
  expect(names).toHaveLength(path === 'jev' ? 3 : 2)
  expect(shown).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-product-choice' } })
  const question = dialogue.conversation(facts).waitingFor!
  expect(question.questionId).toBe(shown.pendingCustomerChoice.questionId)
  expect(question.question).toBe('您想點哪一道？')
  expect(question.choices.filter(choice => choice.id.startsWith('product:')).map(choice => choice.description)).toEqual(names.map((name, index) => `這組第 ${index + 1} 項「${name}」，單份基本售價 100 元；只選品項，尚未加入。`))
  expect(shown.customerMessage).toContain(question.question)
  expect(facts.cart.lines).toHaveLength(0)
  cleanup.push(beginBrowserCartTask(names[1], { intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const select = await prepareBrowserQuestionAnswer(client)
  expect(select).toBeTypeOf('function')
  expect(await select!()).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-order-quantity' } })
  expect(facts.cart.lines).toHaveLength(0)
  cleanup.push(beginBrowserCartTask('兩份', { intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const purchase = await prepareBrowserQuestionAnswer(client)
  expect(purchase).toBeTypeOf('function')
  expect(await purchase!()).toMatchObject({ status: 'verified' })
  expect(facts.cart.lines).toMatchObject([{ name: names[1], quantity: 2 }])
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(dialogue.hasPending()).toBe(false)
  expect(answer).not.toHaveBeenCalled()
})

it('does not turn an informational menu presentation into a purchase question', async () => {
  const { call, facts, dialogue } = setup('有什麼飯？')
  facts.products.push({ ...facts.products[0], ref: 'pork', name: '排骨飯' })
  const shown = await call('point_to_menu_items', { names: ['雞腿飯', '排骨飯'], purpose: 'information' })
  expect(shown).not.toHaveProperty('pendingCustomerChoice')
  expect(dialogue.hasPending()).toBe(false)
  expect(facts.cart.lines[0].quantity).toBe(3)
})

it('does not substitute the whole catalog when a recommended dish becomes unavailable', () => {
  const { facts, dialogue } = setup('推薦兩樣')
  const result = dialogue.presentProducts(facts, '', '推薦兩樣', ['chicken', 'missing'])
  expect(result).toMatchObject({ ok: false, effect: 'none' })
  expect(result).not.toHaveProperty('pendingCustomerChoice')
  expect(dialogue.hasPending()).toBe(false)
  expect(facts.cart.lines[0].quantity).toBe(3)
})

it('does not choose a dish or purchase on bare assent to multiple recommendations', async () => {
  const { call, client, dialogue, facts, execute } = setup('推薦兩樣')
  facts.products.push({ ...facts.products[0], ref: 'pork', name: '排骨飯' })
  await call('point_to_menu_items', { names: ['雞腿飯', '排骨飯'], purpose: 'recommendation' })
  const question = dialogue.conversation(facts).waitingFor!
  expect(dialogue.canAnswerLocally(facts, '好')).toBe(false)
  cleanup.push(beginBrowserCartTask('好', { intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const respond = await prepareBrowserQuestionAnswer(client)
  expect(respond).toBeTypeOf('function')
  await respond!()
  expect(dialogue.conversation(facts).waitingFor?.questionId).toBe(question.questionId)
  expect(facts.cart.lines[0].quantity).toBe(3)
  expect(execute.mock.calls.some(([tool]) => tool.name === 'browser_cart_add')).toBe(false)
})

it('keeps required customization unresolved after choosing a recommendation and count', async () => {
  const { call, client, dialogue, facts, execute } = setup('推薦兩樣')
  facts.cart.lines.splice(0)
  facts.products[0].configurations[0].groups = [{ ref: 'flavor', name: '口味', required: true, maximum: 1, choices: [{ ref: 'spicy', name: '辣', unitPrice: 0, maximum: 1 }] }]
  facts.products.push({ ...facts.products[0], ref: 'pork', name: '排骨飯' })
  await call('point_to_menu_items', { names: ['雞腿飯', '排骨飯'], purpose: 'recommendation' })
  cleanup.push(beginBrowserCartTask('雞腿飯', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const select = await prepareBrowserQuestionAnswer(client)
  expect(await select!()).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-order-quantity' } })
  cleanup.push(beginBrowserCartTask('兩份', { isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const quantity = await prepareBrowserQuestionAnswer(client)
  expect(await quantity!()).toMatchObject({ status: 'clarification', pendingCustomerChoice: { purpose: 'browser-order-slot', question: expect.stringContaining('口味') } })
  expect(dialogue.conversation(facts)).toMatchObject({ drafts: [{ name: '雞腿飯', quantity: 2 }] })
  expect(facts.cart.lines).toHaveLength(0)
  expect(execute.mock.calls.some(([tool]) => tool.name === 'browser_cart_add')).toBe(false)
})

// Report: this chat, Nov14 — a semantic assent must execute the sealed proposal, not re-ask.
it.each(['好', '不要'])('binds checkout guidance after adding, and handles %s without another purchase', async (reply) => {
  const { call, client, dialogue, facts, execute } = setup('雞腿飯一份')
  const result = await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1 }] })
  const question = await offerCheckout(client, dialogue, result, () => true)
  expect(question).toMatchObject({ question: '要結帳嗎？' })
  expect(facts.cart.lines[0].quantity).toBe(4)
  cleanup.push(beginBrowserCartTask(reply, { intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const respond = await prepareBrowserQuestionAnswer(client)
  expect(respond).toBeTypeOf('function')
  const receipt = await respond!()
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_review')).toHaveLength(reply === '好' ? 1 : 0)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(dialogue.hasPending()).toBe(false)
  expect(await offerCheckout(client, dialogue, receipt, () => true)).toBeUndefined()
})

it.each(['partial', 'stale-cart', 'new-turn', 'read-failed'] as const)('does not issue checkout consent on %s', async (mode) => {
  const { call, client, dialogue, facts, execute } = setup('雞腿飯一份')
  const result = await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1 }] })
  if (mode === 'partial')
    result.effect = 'partial'
  if (mode === 'stale-cart')
    facts.cart.version = 'manual-change'
  if (mode === 'read-failed')
    execute.mockRejectedValueOnce(new Error('Read unavailable'))
  expect(await offerCheckout(client, dialogue, result, () => mode !== 'new-turn')).toBeUndefined()
  expect(dialogue.hasPending()).toBe(false)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
})

it.each(['要', '要啊', '就幫我放進去吧'])('finishes an existing confirmation through Main on %s', async (reply) => {
  const { dialogue, facts, call, answer, execute } = setup(reply)
  dialogue.presentAddition(facts, { productRef: 'chicken', quantity: 1, unitPrice: 100, note: '', selection: { version: 'config', variantRef: '', choices: [] } })
  answer.mockResolvedValue({ kind: 'ANSWER', choiceId: 'confirm', provider: 'system-one' })
  expect(await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1 }] })).toMatchObject({ status: 'verified' })
  expect(facts.cart.lines[0].quantity).toBe(4)
  expect(answer).toHaveBeenCalledOnce()
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
})

// Report: this chat, Nov14 — exercise every published entry through the real compiler.
// Native IO is mocked here; these checks prove routing/parameters, not merchant execution.
const contractCases = {
  select_table: { tableName: 'A3' },
  start_ordering_at_table: { tableName: 'A03' },
  list_menu_items: { criteria: { maxUnitPrice: 100 } },
  get_menu_item_details: { names: ['雞腿飯'] },
  search_menu_items: { query: '雞腿' },
  point_to_menu_items: { names: ['雞腿飯'], purpose: 'information' },
  open_menu_item_details: { name: '雞腿飯' },
  add_items_to_cart: { items: [{ name: '雞腿飯', quantity: 2 }] },
  ask_customer_question: { questionType: 'quantity', name: '雞腿飯' },
  cancel_item_selection: {},
  list_cart_items: {},
  open_cart: {},
  continue_checkout: {},
  choose_invoice_method: { method: 'carrier' },
  set_invoice_notification_phone: { phone: '0912345678' },
  set_cart_item_quantity: { target: { name: '雞腿飯' }, quantity: 2 },
  remove_items_from_cart: { targets: [{ name: '雞腿飯' }] },
  replace_item_in_cart: { target: { name: '雞腿飯' }, replaceQuantity: 1, replacement: { name: '雞腿飯' } },
  return_to_menu: {},
  reply_to_customer: { replyType: 'greeting' },
} satisfies Record<OrderingToolName, Record<string, unknown>>

// Report: this chat, Nov14; verify advertised required fields at the execution boundary too.
it.each(Object.entries(contractCases).flatMap(([name, input]) => {
  const definition = orderingTools[name as OrderingToolName]
  return definition.parameters.required.map(field => ({ name, input, field }))
}))('rejects $name without required $field before website IO', async ({ name, input, field }) => {
  const { call, facts, execute } = setup('A3 桌')
  Object.assign(facts, { page: 'table', code: 'table-selection-required', tableChoices: ['A3 桌'], selectedTable: 'A3 桌' })
  const incomplete: Record<string, unknown> = { ...input }
  delete incomplete[field]
  expect(await call(name, incomplete)).toMatchObject({ ok: false, status: 'rejected', effect: 'none' })
  expect(execute).not.toHaveBeenCalled()
})

it.each([
  { name: 'select_table', input: { tableName: '' } },
  { name: 'start_ordering_at_table', input: { tableName: '' } },
  { name: 'get_menu_item_details', input: { names: [''] } },
  { name: 'point_to_menu_items', input: { names: [''], purpose: 'information' } },
  { name: 'point_to_menu_items', input: { names: ['雞腿飯'], purpose: 'invented' } },
  { name: 'search_menu_items', input: { query: '雞'.repeat(201) } },
  { name: 'add_items_to_cart', input: { items: [] } },
  { name: 'add_items_to_cart', input: { items: [{ name: '雞腿飯', quantity: 0 }] } },
  { name: 'add_items_to_cart', input: { items: [{ name: '雞腿飯', quantity: 1.5 }] } },
  { name: 'add_items_to_cart', input: { items: [{ name: '雞腿飯', quantity: 100 }] } },
  { name: 'add_items_to_cart', input: { items: [{ name: '雞腿飯', quantity: 1, piecesPerServing: 7 }] } },
  { name: 'add_items_to_cart', input: { items: [{ name: '雞腿飯', quantity: 1, options: [{ group: '加購', name: '蛋', quantity: -1 }] }] } },
  { name: 'set_cart_item_quantity', input: { target: { name: '雞腿飯' }, quantity: 0 } },
  { name: 'set_cart_item_quantity', input: { target: { name: '雞腿飯', configuration: '配'.repeat(2001) }, quantity: 2 } },
  { name: 'remove_items_from_cart', input: { targets: [] } },
  { name: 'replace_item_in_cart', input: { target: { name: '雞腿飯' }, replaceQuantity: 1, replacement: {} } },
  { name: 'ask_customer_question', input: { questionType: 'invented' } },
  { name: 'reply_to_customer', input: { replyType: 'invented' } },
] satisfies Array<{ name: OrderingToolName, input: Record<string, unknown> }>)('rejects invalid $name arguments before website IO: $input', async ({ name, input }) => {
  const { call, execute } = setup('雞腿飯兩份')
  expect(await call(name, input)).toMatchObject({ ok: false, status: 'rejected', effect: 'none' })
  expect(execute).not.toHaveBeenCalled()
})

it.each(Object.entries(contractCases))('connects the published %s parameters to its Host operation', async (name, input) => {
  const { call, facts, execute } = setup(name === 'set_invoice_notification_phone' ? '通知手機0912345678' : name === 'ask_customer_question' ? '雞腿飯' : name.includes('table') ? 'A3 桌' : '雞腿飯兩份')
  if (name.includes('table'))
    Object.assign(facts, { page: 'table', code: 'table-selection-required', tableChoices: ['A3 桌'], selectedTable: 'A3 桌', customerMessage: '請選桌。' })
  const result = await call(name, input)
  expect(result.ok).toBe(true)
  expect(result.status).not.toBe('rejected')
  expect(result.status).not.toBe('proposal_rejected')
  if (name === 'select_table' || name === 'start_ordering_at_table')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: name === 'select_table' ? 'browser_table_select' : 'browser_start_ordering' }), { name: 'A3 桌' })
  if (name === 'set_cart_item_quantity')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_quantity' }), expect.objectContaining({ lineRef: 'line', quantity: 2 }))
  if (name === 'replace_item_in_cart')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_replace' }), expect.objectContaining({ lineRef: 'line', quantity: 1, retainQuantity: 2 }))
  if (name === 'ask_customer_question')
    expect(result.pendingCustomerChoice.purpose).toBe('browser-order-quantity')
})

// Report: this chat, Nov14 audit — cart labels may contain long, complete option summaries.
it('targets the full readable cart configuration without confusing it with the private fingerprint', async () => {
  const { call, facts, execute } = setup('雞腿飯改成兩份')
  const description = '配菜說明'.repeat(75)
  Object.assign(facts.cart.lines[0], { description, configuration: 'private-native-fingerprint' })
  expect(await call('set_cart_item_quantity', { target: { name: '雞腿飯', configuration: description }, quantity: 2 })).toMatchObject({ status: 'verified' })
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_quantity' }), expect.objectContaining({ lineRef: 'line', quantity: 2 }))
})

// Report: this chat, Nov14 audit — the same published alias must work across public operations.
it.each(['get_menu_item_details', 'open_menu_item_details', 'point_to_menu_items', 'ask_customer_question', 'set_cart_item_quantity', 'remove_items_from_cart'])('resolves a unique published alias for %s without guessing a SKU', async (name) => {
  const { call, execute } = setup('招牌', false, [{ name: '雞腿飯', aliases: ['招牌'], category: '' }])
  const input = name === 'get_menu_item_details' ? { names: ['招牌'] } : name === 'point_to_menu_items' ? { names: ['招牌'], purpose: 'information' } : name === 'ask_customer_question' ? { questionType: 'quantity', name: '招牌' } : name === 'set_cart_item_quantity' ? { target: { name: '招牌' }, quantity: 2 } : name === 'remove_items_from_cart' ? { targets: [{ name: '招牌' }] } : { name: '招牌' }
  const result = await call(name, input)
  expect(result.ok).toBe(true)
  expect(result.status).not.toBe('rejected')
  expect(result.status).not.toBe('proposal_rejected')
  if (name === 'get_menu_item_details')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_product_get' }), { names: ['雞腿飯'] })
  if (name === 'open_menu_item_details')
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_open_product' }), { name: '雞腿飯' })
  if (name === 'ask_customer_question')
    expect(result.pendingCustomerChoice.purpose).toBe('browser-order-quantity')
})

// Report: this chat, Nov14 A9 rejection was replaced by generic table instructions.
it('preserves the exact unavailable-table explanation when issuing the table question', async () => {
  const { call, facts } = setup('a9')
  Object.assign(facts, { page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'A1 桌'], selectedTable: 'A1 桌', customerMessage: '畫面目前選擇A1 桌。' })
  const result = await call('ask_customer_question', { questionType: 'table' })
  expect(result.customerMessage).toContain('目前沒有')
  expect(result.customerMessage).toContain('A9')
  expect(result.customerMessage).not.toContain('使用這個選擇開始點餐')
  expect(result.pendingCustomerChoice.question).toBe(result.customerMessage)
})

// Report: this chat, Nov14 built Host asked about an item while still selecting a table.
it('returns the table question instead of parsing a table snapshot as a product catalog', async () => {
  const { call, execute } = setup('我要點山')
  execute.mockImplementation(async () => ({ ok: true, source: 'browser', page: 'table', code: 'table-selection-required', tableChoices: ['櫃台取餐', 'A1 桌'], selectedTable: '櫃台取餐', customerMessage: '畫面目前選擇櫃台取餐，要開始點餐嗎？' }))
  const result = await call('ask_customer_question', { questionType: 'item', name: '山', query: '山是什麼餐點？' })
  expect(result.status).toBe('clarification')
  expect(result.effect).toBe('none')
  expect(result.customerMessage).toContain('櫃台取餐')
  expect(execute.mock.calls.every(([tool]) => tool.name === 'browser_cart_get')).toBe(true)
})

// Report: this chat; cases 11/12 must complete Host processing, not just dispatch.
it.each(['quantity', 'product'] as const)('continues Jev %s answers through the real question and cart executors', async (questionType) => {
  const { facts, dialogue, client, execute, answer } = setup('我要炸排骨便當')
  facts.cart.lines.splice(0)
  facts.products[0].name = '炸排骨便當'
  facts.products[0].ref = 'pork'
  facts.products.push({ ...facts.products[0], ref: 'three-cup', name: '三杯雞便當' })
  if (questionType === 'quantity')
    dialogue.presentQuantity(facts, 'pork', '我要炸排骨便當')
  else
    dialogue.presentProducts(facts, '便當', '我要便當')
  const initialQuestion = dialogue.conversation(facts).waitingFor!
  const decide = vi.fn(async () => ({ kind: 'FAST_ACTION' as const, actionId: 'answer:current', confidence: 0.95, answeredQuestionId: dialogue.conversation(facts).waitingFor!.questionId }))
  const runAnswer = async (transcript: string) => {
    const source = createBrowserFastPathSource({ tools: client.tools.value, read: async () => structuredClone(facts), hasPendingQuestion: dialogue.hasPending, pendingQuestion: raw => dialogue.conversation(raw).waitingFor, canAnswerLocally: dialogue.canAnswerLocally, execute: async (tool, input) => {
      expect(tool.name).toBe('browser_answer_question')
      expect(input).toEqual({})
      const dispose = beginBrowserCartTask(transcript, { intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue })
      try {
        const apply = await prepareBrowserQuestionAnswer(client)
        expect(apply).toBeTypeOf('function')
        return await apply!()
      }
      finally {
        dispose()
      }
    } })
    return runFastPath({ transcript, source, decide, isEnabled: async () => true, webMcp: { tools: client.tools.value, execute } })
  }
  if (questionType === 'product') {
    expect(await runAnswer('炸排骨便當')).toMatchObject({ kind: 'FAST_ACTION', result: { pendingCustomerChoice: { question: '請問「炸排骨便當」要幾份？' } } })
    expect(facts.cart.lines).toHaveLength(0)
    expect(dialogue.conversation(facts).waitingFor).toMatchObject({ purpose: 'browser-order-quantity' })
    expect(dialogue.conversation(facts).waitingFor!.questionId).not.toBe(initialQuestion.questionId)
  }
  expect(await runAnswer('兩份')).toMatchObject({ kind: 'FAST_ACTION', result: { status: 'verified' } })
  expect(facts.cart.lines).toMatchObject([{ name: '炸排骨便當', quantity: 2 }])
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'browser_cart_add' }), expect.objectContaining({ productRef: 'pork', quantity: 2 }))
  expect(dialogue.hasPending()).toBe(false)
  expect(answer).not.toHaveBeenCalled()
  expect(decide).toHaveBeenCalledTimes(questionType === 'product' ? 2 : 1)
})

// Report: this chat; resolving a shared name must not erase customization.
it.each(['我要雞腿不要辣', '我要雞腿飯少'])('preserves unparsed conditions after the quantity answer: %s', async (request) => {
  const { facts, dialogue, client, execute } = setup('兩份')
  facts.cart.lines.splice(0)
  dialogue.presentQuantity(facts, 'chicken', request, '雞腿')
  cleanup.push(beginBrowserCartTask('兩份', { intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const apply = await prepareBrowserQuestionAnswer(client)
  expect(await apply!()).toMatchObject({ originalRequest: request, requestedQuantity: 2 })
  expect(facts.cart.lines).toHaveLength(0)
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(0)
})

// Report: this chat; the adapter must not turn a lost native write receipt into effect:none.
it.each(['throw', 'missing', 'empty'])('preserves an uncertain native add and stops the batch when its receipt is %s', async (failure) => {
  const { call, execute, facts } = setup('雞腿飯一份，再一份雞腿飯')
  const original = execute.getMockImplementation()!
  execute.mockImplementation(async (tool, input) => {
    const result = await original(tool, input)
    if (tool.name !== 'browser_cart_add')
      return result
    if (failure === 'throw')
      throw new Error('Native receipt lost after dispatch')
    return failure === 'empty' ? {} : undefined
  })
  const result = await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1 }, { name: '雞腿飯', quantity: 1 }] })
  expect(result).toMatchObject({ ok: false, status: 'unknown', effect: 'unknown' })
  expect(execute.mock.calls.filter(([tool]) => tool.name === 'browser_cart_add')).toHaveLength(1)
  expect(facts.cart.lines[0].quantity).toBe(4)
})

// Report: this chat, Nov15 — confident Jev checkout assent opened cart without its next question.
it('retains cart review after a direct Jev answer to the checkout invitation', async () => {
  const { call, client, dialogue, facts, checkout } = setup('雞腿飯一份')
  Object.assign(facts, { page: 'menu', checkout })
  const result = await call('add_items_to_cart', { items: [{ name: '雞腿飯', quantity: 1 }] })
  expect(await offerCheckout(client, dialogue, result, () => true)).toMatchObject({ question: '要結帳嗎？' })
  cleanup.push(beginBrowserCartTask('好', { intentSource: 'jev', isCurrent: () => true, decide: async () => ({ choice: 'ALLOW', provider: 'main', admission: 'issued-plan' }), dialogue }))
  const respond = await prepareBrowserQuestionAnswer(client)
  const receipt = await respond!()
  expect(receipt).toMatchObject({ pendingCustomerChoice: { question: expect.stringContaining('餐點、份數和金額正確嗎') } })
  const question = dialogue.conversation(facts).waitingFor
  expect(question?.question).toContain('餐點、份數和金額正確嗎')
  expect(dialogue.validate(facts, question!.questionId)).toEqual(question)
})

// Report: this chat, Nov15 — a serving-count query consumed the unanswered cart review.
it('reads item information without resolving the pending cart review as a new request', async () => {
  const { call, client, dialogue, facts, checkout, answer } = setup('一份雞腿飯有什麼？')
  Object.assign(facts, { page: 'cart', checkout })
  await call('open_cart', {})
  const waiting = dialogue.conversation(facts).waitingFor
  expect(waiting?.question).toContain('餐點、份數和金額正確嗎')
  answer.mockResolvedValue({ kind: 'NEW_REQUEST', provider: 'main' })
  const source = createBrowserFastPathSource({ tools: client.tools.value, read: client.execute, execute: (tool, input) => executeBrowserCartTool(client, tool, input), hasPendingQuestion: dialogue.hasPending, pendingQuestion: raw => dialogue.conversation(raw).waitingFor })
  await source.context({ transcript: '一份雞腿飯有什麼？' })
  const result = await source.execute({ candidateId: 'information:chicken' })
  expect(result).toMatchObject({ customerMessage: expect.stringContaining('雞腿飯') })
  expect(answer).not.toHaveBeenCalled()
  expect(dialogue.conversation(facts).waitingFor).toEqual(waiting)
})
