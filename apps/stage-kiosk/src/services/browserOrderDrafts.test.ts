import type { AnswerDecision } from '../../../server/src/services/domain/browser-ordering/contracts'

import { expect, it, vi } from 'vitest'

import { createBrowserDialogue } from './browserDialogue'

function setup() {
  const answer = vi.fn(async (): Promise<AnswerDecision> => ({ kind: 'ANSWER', choiceId: 'confirm', provider: 'main' }))
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'page', answer })
  const facts = { ok: true, source: 'browser', cart: { version: 'cart', lines: [] }, products: [
    { ref: 'p-1', name: '水餃', price: 64, configurations: [{ version: 'cfg-1', variantRef: '', name: '水餃', unitPrice: 64, groups: [{ ref: 'g-1', name: '加量', required: false, maximum: 10, choices: [{ ref: 'a-1', name: '加水餃', unitPrice: 8, maximum: 10 }] }] }] },
    { ref: 'p-2', name: '便當', price: 100, configurations: [{ version: 'cfg-2', variantRef: '', name: '便當', unitPrice: 100, groups: [] }] },
  ] }
  const line = (productRef: string, evidence: string, quantity: number | null, choices: { ref: string, quantity: number | null }[] = []) => ({ productRef, evidence, quantity, choices, askGroups: [], note: '' })
  const respond = (text: string) => dialogue.answer(facts, text, async () => facts, () => true)
  return { dialogue, facts, answer, line, respond }
}

// Report: this chat, Nov19 — dumpling answers use total pieces, including multiple serving configurations.
it.each([
  { text: '10顆', counts: [[10, 1]] },
  { text: '12顆', counts: [[12, 1]] },
  { text: '10顆2份', counts: [[10, 2]] },
  { text: '12顆3份', counts: [[12, 3]] },
  { text: '一份十顆、一份12顆', counts: [[10, 1], [12, 1]] },
  { text: '一份十顆、一份正常', counts: [[10, 1], [8, 1]] },
])('completes the bound dumpling request from $text without another serving question', async ({ text, counts }) => {
  const { dialogue, facts, respond, answer } = setup()
  const product = facts.products[0]
  product.name = '周氏水餃(最低8顆)'
  product.configurations[0].groups[0].maximum = 100
  Object.assign(product.configurations[0].groups[0].choices[0], { name: '水餃1顆', maximum: 100 })
  dialogue.presentQuantity(facts, product.ref, '我要周氏水餃')
  expect(dialogue.canAnswerLocally(facts, text)).toBe(true)
  const result = await respond(text)
  expect(result).toMatchObject({ kind: 'receipt', result: { completeOrder: { proposals: counts.map(([pieces, quantity]) => ({ productRef: product.ref, quantity, unitPrice: pieces * 8, selection: { choices: pieces === 8 ? [] : [{ ref: 'a-1', quantity: pieces - 8 }] } })), evidence: { request: '我要周氏水餃', answers: [{ answer: text }] } } } })
  expect(dialogue.hasPending()).toBe(false)
  expect(answer).not.toHaveBeenCalled()
})

// Report: this chat, Nov12; Main used the spoken PB name, then repeatedly rejected its draft.
it('recognizes the unique customer-facing PB name and completes its configured purchase', () => {
  const { dialogue, facts, line } = setup()
  facts.products[0].name = '周氏水餃(最低8顆)'
  facts.products[0].configurations[0].groups[0].choices[0].name = '水餃'
  const text = '我要周氏水餃兩份，每份加兩顆水餃'
  expect(dialogue.collectOrder(facts, { lines: [line('p-1', text, 2, [{ ref: 'a-1', quantity: 2 }])] }, text)).toMatchObject({ completeOrder: { proposals: [{ productRef: 'p-1', quantity: 2, unitPrice: 80, selection: { choices: [{ ref: 'a-1', quantity: 2 }] } }] } })
  facts.products.push({ ...facts.products[0], ref: 'p-other', name: '周氏水餃' })
  dialogue.reset()
  expect(dialogue.collectOrder(facts, { lines: [line('p-1', text, 2)] }, text)).toMatchObject({ status: 'proposal_rejected', effect: 'none' })
})

// Report: this chat, Nov12; real Main and Jev+Main both refused rather than asking an undecided add-on count.
it('asks an undecided add-on count, preserves servings and prices the completed configuration', async () => {
  const { dialogue, facts, line, respond, answer } = setup()
  const text = '我要水餃一份，加水餃還沒決定幾顆'
  const question = dialogue.collectOrder(facts, { lines: [line('p-1', text, 1, [{ ref: 'a-1', quantity: null }])] }, text)
  expect(('pendingCustomerChoice' in question ? question.pendingCustomerChoice.question : '')).toContain('幾個')
  const result = await respond('加兩顆')
  expect(result).toMatchObject({ kind: 'receipt', result: { completeOrder: { proposals: [{ productRef: 'p-1', quantity: 1, unitPrice: 80, selection: { choices: [{ ref: 'a-1', quantity: 2 }] } }] } } })
  expect(dialogue.hasPending()).toBe(false)
  expect(answer).not.toHaveBeenCalled()
})

// Report: this chat, Nov12; two meals with missing serving counts only displayed products.
it('retains both incomplete dishes and completes once both serving counts are answered', async () => {
  const { dialogue, facts, line, respond } = setup()
  const text = '我要水餃和便當，份數等一下說'
  expect(dialogue.collectOrder(facts, { lines: [line('p-1', text, null), line('p-2', text, null)] }, text)).toMatchObject({ pendingCustomerChoice: { question: expect.stringContaining('水餃') } })
  expect(await respond('兩份')).toMatchObject({ kind: 'receipt', result: { pendingCustomerChoice: { question: expect.stringContaining('便當') } } })
  expect(dialogue.conversation(facts).drafts).toHaveLength(2)
  expect(await respond('另一個也要一份')).toMatchObject({ kind: 'receipt', result: { completeOrder: { proposals: [{ productRef: 'p-1', quantity: 2, unitPrice: 64 }, { productRef: 'p-2', quantity: 1, unitPrice: 100 }] } } })
  expect(dialogue.hasPending()).toBe(false)
})

// Report: this chat, Nov12; one plain plus one configured serving left only the configured serving in the real cart.
it('keeps two configurations of the same meal as distinct priced proposals', async () => {
  const { dialogue, facts, line } = setup()
  const text = '水餃兩份，一份不加料，另一份加兩顆加水餃'
  const result = dialogue.collectOrder(facts, { lines: [line('p-1', '一份不加料', 1), line('p-1', '另一份加兩顆加水餃', 1, [{ ref: 'a-1', quantity: 2 }])] }, text)
  expect(result).toMatchObject({ completeOrder: { proposals: [{ quantity: 1, unitPrice: 64, selection: { choices: [] } }, { quantity: 1, unitPrice: 80, selection: { choices: [{ ref: 'a-1', quantity: 2 }] } }] } })
  expect(dialogue.hasPending()).toBe(false)
})

it('does not accept a model-defaulted serving count absent from customer evidence', () => {
  const { dialogue, facts, line } = setup()
  expect(dialogue.collectOrder(facts, { lines: [line('p-2', '我要便當', 1)] }, '我要便當')).toMatchObject({ pendingCustomerChoice: { question: expect.stringContaining('幾份') } })
})

it('collects two required groups in order and derives the final price', async () => {
  const { dialogue, facts, line, respond, answer } = setup()
  facts.products[1].configurations[0].groups.push(
    { ref: 'g-2', name: '主食', required: true, maximum: 1, choices: [{ ref: 'a-2', name: '白飯', unitPrice: 0, maximum: 1 }] },
    { ref: 'g-3', name: '飲料', required: true, maximum: 1, choices: [{ ref: 'a-3', name: '紅茶', unitPrice: 10, maximum: 1 }] },
  )
  expect(dialogue.collectOrder(facts, { lines: [line('p-2', '便當一份', 1)] }, '便當一份')).toMatchObject({ pendingCustomerChoice: { question: expect.stringContaining('主食') } })
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'option:a-2', provider: 'main' })
  expect(await respond('白飯')).toMatchObject({ kind: 'receipt', result: { pendingCustomerChoice: { question: expect.stringContaining('飲料') } } })
  answer.mockResolvedValueOnce({ kind: 'ANSWER', choiceId: 'option:a-3', provider: 'main' })
  expect(await respond('紅茶')).toMatchObject({ kind: 'receipt', result: { completeOrder: { proposals: [{ productRef: 'p-2', quantity: 1, unitPrice: 110, selection: { choices: [{ ref: 'a-2', quantity: 1 }, { ref: 'a-3', quantity: 1 }] } }] } } })
})

it.each(['cart', 'configuration', 'owner'])('invalidates all queued fields when the %s changes', async (change) => {
  let owner = 'visitor'
  const { facts, line } = setup()
  const dialogue = createBrowserDialogue({ owner: () => owner, documentId: () => 'page', answer: async () => ({ kind: 'UNCERTAIN', provider: 'main' }) })
  dialogue.collectOrder(facts, { lines: [line('p-2', '我要便當', null)] }, '我要便當')
  if (change === 'cart')
    facts.cart.version = 'manual'
  if (change === 'configuration')
    facts.products[1].configurations[0].version = 'new'
  if (change === 'owner')
    owner = 'next'
  expect(dialogue.conversation(facts).waitingFor).toBeUndefined()
  expect(dialogue.conversation(facts).drafts).toBeUndefined()
})

it('rejects made-up option references and evidence before replacing an existing draft', () => {
  const { dialogue, facts, line } = setup()
  const result = dialogue.collectOrder(facts, { lines: [line('p-1', '虛構內容', 1, [{ ref: 'missing', quantity: 1 }])] }, '水餃一份')
  expect(result).toMatchObject({ status: 'proposal_rejected', effect: 'none' })
  expect(dialogue.hasPending()).toBe(false)
})

it('asks rather than accepting a model-defaulted add-on quantity', () => {
  const { dialogue, facts, line } = setup()
  const text = '水餃一份，加水餃還沒決定幾顆'
  expect(dialogue.collectOrder(facts, { lines: [line('p-1', text, 1, [{ ref: 'a-1', quantity: 1 }])] }, text)).toMatchObject({ pendingCustomerChoice: { purpose: 'browser-order-slot', question: expect.stringContaining('幾個') } })
})

// Report: this chat, Nov12 live D01; Main supplied both a selected add-on and its pending group.
it('does not ask a selected option group again after filling its missing count', async () => {
  const { dialogue, facts, line, respond } = setup()
  const text = '水餃一份，加水餃還沒決定幾顆'
  const draft = { ...line('p-1', text, 1, [{ ref: 'a-1', quantity: null }]), askGroups: ['g-1'] }
  dialogue.collectOrder(facts, { lines: [draft] }, text)
  expect(await respond('加兩顆')).toMatchObject({ kind: 'receipt', result: { completeOrder: { proposals: [{ productRef: 'p-1', quantity: 1, unitPrice: 80, selection: { choices: [{ ref: 'a-1', quantity: 2 }] } }] } } })
})

// Report: Nov12 live Jev D01; evidence covered only the meal count while the immutable utterance also named the add-on.
it('uses the complete single-dish utterance to retain a named add-on despite narrow count evidence', () => {
  const { dialogue, facts, line } = setup()
  const text = '水餃一份，加水餃還沒決定幾顆'
  expect(dialogue.collectOrder(facts, { lines: [{ ...line('p-1', '水餃一份', 1, [{ ref: 'a-1', quantity: null }]), askGroups: ['g-1'] }] }, text)).toMatchObject({ pendingCustomerChoice: { question: expect.stringContaining('幾個') } })
})

// Report: this chat, Nov19 — native「加量」wording trapped customers in an unclear question.
it.each([
  { text: '10顆', quantity: 2, pieces: 10 },
  { text: '正常', quantity: 2, pieces: 8 },
  { text: '12顆3份', quantity: 3, pieces: 12 },
])('asks total dumpling pieces and accepts $text while preserving stated servings', async ({ text, quantity, pieces }) => {
  const { dialogue, facts, line, respond, answer } = setup()
  const product = facts.products[0]
  product.name = '周氏水餃(最低8顆)'
  product.configurations[0].groups[0].choices[0].name = '水餃1顆'
  const request = '我要周氏水餃兩份'
  const result = dialogue.collectOrder(facts, { lines: [{ ...line('p-1', request, 2), askGroups: ['g-1'] }] }, request)
  expect(result).toMatchObject({ pendingCustomerChoice: { question: '周氏水餃已選2份，每份要幾顆？例如10顆；正常是8顆。' } })
  expect(dialogue.canAnswerLocally(facts, text)).toBe(true)
  expect(await respond(text)).toMatchObject({ kind: 'receipt', result: { completeOrder: { proposals: [{ quantity, unitPrice: pieces * 8, selection: { choices: pieces === 8 ? [] : [{ ref: 'a-1', quantity: pieces - 8 }] } }] } } })
  expect(answer).not.toHaveBeenCalled()
  expect(dialogue.hasPending()).toBe(false)
})

// Report: this chat, Nov19 — a natural refusal retires only an unfinished selection.
it('cancels an unanswered slot locally without changing the cart and accepts a new task', async () => {
  const { dialogue, facts, line, respond, answer } = setup()
  dialogue.collectOrder(facts, { lines: [line('p-2', '我要便當', null)] }, '我要便當')
  expect(dialogue.canAnswerLocally(facts, '先不要了')).toBe(true)
  expect(await respond('先不要了')).toMatchObject({ result: { customerMessage: '已取消這次選餐，購物車保持不變。' } })
  expect(facts.cart).toEqual({ version: 'cart', lines: [] })
  expect(dialogue.hasPending()).toBe(false)
  expect(answer).not.toHaveBeenCalled()
  expect(dialogue.collectOrder(facts, { lines: [line('p-2', '便當兩份', 2)] }, '便當兩份')).toMatchObject({ completeOrder: { proposals: [{ quantity: 2 }] } })
})

// Report: this chat, Nov19 — a plain-language piece question must still support split servings.
it('retains separate dumpling configurations when a draft answer requests two different servings', async () => {
  const { dialogue, facts, line, respond } = setup()
  facts.products[0].name = '周氏水餃(最低8顆)'
  facts.products[0].configurations[0].groups[0].choices[0].name = '水餃1顆'
  const request = '我要周氏水餃'
  expect(dialogue.collectOrder(facts, { lines: [line('p-1', request, null)] }, request)).toMatchObject({ pendingCustomerChoice: { question: '周氏水餃每份至少8顆，您要幾顆、幾份？例如10顆2份。' } })
  expect(await respond('一份十顆、一份正常')).toMatchObject({ result: { completeOrder: { proposals: [{ quantity: 1, unitPrice: 80 }, { quantity: 1, unitPrice: 64 }] } } })
})

// Report: this chat, Nov19 — changing topics must retire the old slot rather than repeat it.
it('releases an unfinished question when Main identifies a new request', async () => {
  const { dialogue, facts, line, answer, respond } = setup()
  answer.mockResolvedValueOnce({ kind: 'NEW_REQUEST', provider: 'main' })
  dialogue.collectOrder(facts, { lines: [line('p-2', '我要便當', null)] }, '我要便當')
  expect(await respond('先問一下有沒有湯')).toBeUndefined()
  expect(dialogue.hasPending()).toBe(false)
  expect(facts.cart.lines).toEqual([])
})

// Report: this chat, Nov19 — an unrecognized reply must explain how to leave the question safely.
it('reasks once without requiring the customer to learn a special cancellation command', async () => {
  const { dialogue, facts, line, answer, respond } = setup()
  answer.mockResolvedValueOnce({ kind: 'UNCERTAIN', provider: 'main' })
  dialogue.collectOrder(facts, { lines: [line('p-2', '我要便當', null)] }, '我要便當')
  expect(await respond('我聽不懂')).toMatchObject({ result: { customerMessage: '請問「便當」要幾份？' } })
  expect(dialogue.hasPending()).toBe(true)
  expect(facts.cart.lines).toEqual([])
})
