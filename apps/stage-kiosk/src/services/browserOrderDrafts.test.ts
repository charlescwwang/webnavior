import { expect, it, vi } from 'vitest'

import { createBrowserDialogue } from './browserDialogue'

function setup() {
  const answer = vi.fn(async () => ({ kind: 'ANSWER' as const, choiceId: 'confirm', provider: 'main' as const }))
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'page', answer })
  const facts = { ok: true, source: 'browser', cart: { version: 'cart', lines: [] }, products: [
    { ref: 'p-1', name: '水餃', price: 64, configurations: [{ version: 'cfg-1', variantRef: '', name: '水餃', unitPrice: 64, groups: [{ ref: 'g-1', name: '加量', required: false, maximum: 10, choices: [{ ref: 'a-1', name: '加水餃', unitPrice: 8, maximum: 10 }] }] }] },
    { ref: 'p-2', name: '便當', price: 100, configurations: [{ version: 'cfg-2', variantRef: '', name: '便當', unitPrice: 100, groups: [] }] },
  ] }
  const line = (productRef: string, evidence: string, quantity: number | null, choices: { ref: string, quantity: number | null }[] = []) => ({ productRef, evidence, quantity, choices, askGroups: [], note: '' })
  const respond = (text: string) => dialogue.answer(facts, text, async () => facts, () => true)
  return { dialogue, facts, answer, line, respond }
}

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
