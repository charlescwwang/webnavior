import { safeParse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { decideAnswer, decideEffect, findPresentedQuestion } from '.'
import { browserEffectSchema } from './contracts'

const effect = { transcript: '每日新品兩份有嗎？', action: 'add' as const, description: '新增每日新品兩份', completedEffects: [], storeFacts: '', note: '', deltas: [{ name: '每日新品', kind: 'product' as const, mode: 'increase' as const, quantity: 1 }] }

// Report: this chat, Nov15; a follow-up answer was rewritten into a combined utterance and rejected by admission.
it('keeps the current utterance and verified order answers separate during semantic admission', async () => {
  const facts = '原始點餐需求：推薦雞腿飯。已確認的問題與顧客回答：問題「要來一份雞腿飯嗎？」，顧客回答「好」；問題「飲料要哪一項？」，顧客回答「紅茶」。'
  const finite = vi.fn(async (_state: string) => ({ answers: { purpose: { choice: 'UNCERTAIN', confidence: 0.99 } } }))
  const complete = vi.fn(async () => {
    throw new Error('Finite uncertainty must remain uncertainty.')
  })
  expect(await decideEffect({ ...effect, transcript: '紅茶', storeFacts: facts }, { finite, complete })).toMatchObject({ choice: 'CLARIFY' })
  expect(JSON.parse(finite.mock.calls[0][0])).toMatchObject({ customerUtterance: '紅茶', storeFacts: facts })
  expect(complete).not.toHaveBeenCalled()
})

// Report: this chat, Nov15 — checkout assent must reference the presented question.
it('finds a final checkout question after the completed add and revokes it after another write', () => {
  type Entry = Parameters<typeof findPresentedQuestion>[0][number]
  const entry = (kind: Entry['kind'], value: unknown, sequence: number): Entry => ({ id: String(sequence), visitorSessionId: 'visitor', sequence, kind, content: typeof value === 'string' ? value : JSON.stringify(value), metadata: { name: 'add_items_to_cart' }, createdAt: new Date() })
  const question = { questionId: 'checkout-1', purpose: 'browser-service-question', question: '要結帳嗎？', expiresAt: Date.now() + 30_000, choices: [{ id: 'yes', description: '開啟購物車核對餐點，不送單。' }, { id: 'no', description: '繼續點餐。' }] }
  const added = entry('tool_result', { source: 'browser', status: 'verified' }, 1)
  const presented = entry('service_event', { kind: 'browser_question_presented', source: 'browser', pendingCustomerChoice: question }, 2)
  const user = entry('user_text', '好，幫我結帳吧', 3)
  expect(findPresentedQuestion([added, presented, user], question.questionId)).toEqual(question)
  expect(findPresentedQuestion([added, entry('assistant_text', question.question, 2), user], question.questionId)).toBeUndefined()
  expect(findPresentedQuestion([presented, added, user], question.questionId)).toBeUndefined()
  expect(findPresentedQuestion([added, entry('service_event', { kind: 'unrelated', source: 'browser', pendingCustomerChoice: question }, 2), user], question.questionId)).toBeUndefined()
})

function withPurpose(choice: string, complete: (body: Record<string, unknown>) => Promise<Response>) {
  return async (body: Record<string, unknown>) => JSON.stringify(body.tools).includes('judge_browser_purpose')
    ? Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_purpose', arguments: JSON.stringify({ choice, reason: '獨立理解完整原句' }) } }] } }] })
    : complete(body)
}

// Report: output/playwright/pb-electron/restored-S06-current-sequence.json.
it('recognizes preservation only at a quantity proposal that would leave the observed count unchanged', async () => {
  const complete = vi.fn(async (_body: Record<string, unknown>) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_preservation', arguments: '{"choice":"PRESERVE","reason":"整句只要求本人兩份保留"}' } }] } }] }))
  const result = await decideEffect({ ...effect, transcript: '小明說他不要了，我的兩份先保留。', action: 'quantity', cartContext: { version: 'fresh', lines: [{ name: '雞腿便當', quantity: 2 }] }, cartTarget: { selected: { name: '雞腿便當', quantity: 2, description: '' }, others: [] }, deltas: [{ name: '雞腿便當', kind: 'cart_line', mode: 'set', quantity: 2 }] }, { complete })
  expect(result).toMatchObject({ choice: 'PRESERVE', provider: 'main' })
  expect(complete).toHaveBeenCalledOnce()
  expect(JSON.stringify(complete.mock.calls[0]![0])).toContain('judge_browser_preservation')
})

it.each(['add', 'remove', 'replace', 'quantity'] as const)('keeps real %s changes out of preservation classification', async (action) => {
  const complete = vi.fn(async (_body: Record<string, unknown>) => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_purpose', arguments: '{"choice":"UNCERTAIN"}' } }] } }] }))
  const result = await decideEffect({ ...effect, action, cartContext: { version: 'fresh', lines: [{ name: '原餐', quantity: 2 }] }, cartTarget: { selected: { name: '原餐', quantity: 2, description: '' }, others: [] }, deltas: [{ name: '原餐', kind: 'cart_line', mode: 'set', quantity: action === 'quantity' ? 3 : 2 }] }, { complete })
  expect(result.choice).toBe('CLARIFY')
  expect(complete).toHaveBeenCalledOnce()
  expect(JSON.stringify(complete.mock.calls[0]![0].tools)).toContain('judge_browser_purpose')
  expect(JSON.stringify(complete.mock.calls[0]![0].tools)).not.toContain('KEEP')
})

it('continues original operation classification when a zero-change proposal does not cover the utterance', async () => {
  const complete = vi.fn(async (body: Record<string, unknown>) => {
    const preservation = JSON.stringify(body.tools).includes('judge_browser_preservation')
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: preservation ? 'judge_browser_preservation' : 'judge_browser_purpose', arguments: JSON.stringify({ choice: preservation ? 'CONTINUE' : 'ADD' }) } }] } }] })
  })
  const result = await decideEffect({ ...effect, transcript: '原餐不動，再加新餐一份', action: 'quantity', cartContext: { version: 'fresh', lines: [{ name: '原餐', quantity: 2 }] }, cartTarget: { selected: { name: '原餐', quantity: 2, description: '' }, others: [] }, deltas: [{ name: '原餐', kind: 'cart_line', mode: 'set', quantity: 2 }] }, { complete })
  expect(result).toMatchObject({ choice: 'DIFFERENT_OPERATION', requiredAction: 'add' })
  expect(complete).toHaveBeenCalledTimes(2)
})

// Report: output/playwright/pb-electron/restored-S04-explicit-partial.json.
it('does not let a confident finite quantity classification authorize a partial configuration replacement', async () => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_purpose', arguments: '{"choice":"REPLACE","reason":"改其中一份配置，不是減少餐點"}' } }] } }] }))
  const result = await decideEffect({ ...effect, transcript: '三份原餐中一份改不加配菜，另外兩份維持', action: 'quantity', cartTarget: { selected: { name: '原餐', quantity: 3, description: '配菜 ×1' }, others: [] } }, { finite: async () => ({ answers: { purpose: { choice: 'QUANTITY', confidence: 0.99 } } }), complete })
  expect(result).toMatchObject({ choice: 'DIFFERENT_OPERATION', requiredAction: 'replace', provider: 'main' })
  expect(complete).toHaveBeenCalledOnce()
})

// Report: output/playwright/pb-electron/restored-S04-final-policy-initial.json.
it('provides the verified empty cart when distinguishing an initial split order from a replacement', async () => {
  const cartContext = { version: 'fresh-empty-cart', lines: [] }
  const complete = vi.fn(withPurpose('ADD', async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 1, scope: 'target' }], targetMatches: true, noteMatches: true, reason: '新增其中一組' }) } }] } }] })))
  expect(await decideEffect({ ...effect, transcript: '三份每日新品，其中一份加配菜', cartContext }, { complete })).toMatchObject({ choice: 'ALLOW' })
  expect(JSON.stringify(complete.mock.calls[0][0].messages)).toContain('fresh-empty-cart')
})

// Report: output/playwright/pb-electron/restored-S04-cart-context.json.
it('provides this turn’s completed additions to purpose classification before admitting the remaining configuration', async () => {
  const completedEffects = ['已加入每日新品 2 份，本輪已核實。']
  const complete = vi.fn(withPurpose('ADD', async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 1, scope: 'target' }], targetMatches: true, noteMatches: true, reason: '繼續原新增需求' }) } }] } }] })))
  expect(await decideEffect({ ...effect, transcript: '三份每日新品，其中一份加配菜', completedEffects, cartContext: { version: 'after-first-configuration', lines: [{ name: '每日新品', quantity: 2 }] } }, { complete })).toMatchObject({ choice: 'ALLOW' })
  expect(JSON.stringify(complete.mock.calls[0][0].messages)).toContain('本輪已核實')
})

// Report: output/playwright/pb-electron/restored-S04-completed-context.json.
it.each([
  { currentRice: false, completedRice: false, note: '', completedNote: '', requested: 2, completed: 2, choice: 'REVISE' },
  { currentRice: true, completedRice: false, note: '', completedNote: '', requested: 1, completed: 2, choice: 'ALLOW' },
  { currentRice: false, completedRice: false, note: '不要辣', completedNote: '飯少', requested: 1, completed: 1, choice: 'ALLOW' },
  { currentRice: false, completedRice: false, note: '飯少', completedNote: '飯少', requested: 1, completed: 1, choice: 'REVISE' },
])('subtracts verified additions only from the exact configuration and note (%j)', async ({ currentRice, completedRice, note, completedNote, requested, completed, choice }) => {
  const serving = { productName: '每日新品', variantName: '', options: currentRice ? [{ name: '配菜', quantity: 1 }] : [] }
  const complete = async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ groups: [{ ...serving, quantity: requested, note }] }) } }] } }] })
  expect(await decideEffect({ ...effect, transcript: '按原需求分組新增', serving, servingKey: currentRice ? 'rice' : 'plain', note, completedEffects: ['本輪已核實新增'], completedAdditions: [{ servingKey: completedRice ? 'rice' : 'plain', note: completedNote, quantity: completed }], deltas: [{ name: '每日新品', kind: 'product', mode: 'increase', quantity: requested }] }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice })
})

it('does not infer addition completion from prose without structured verified evidence', async () => {
  const complete = async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: '{"groups":[{"productName":"每日新品","variantName":"","options":[],"quantity":1,"note":""}]}' } }] } }] })
  expect(await decideEffect({ ...effect, completedEffects: ['已加入每日新品一份'], serving: { productName: '每日新品', variantName: '', options: [] } }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice: 'CLARIFY', provider: 'unavailable' })
})

// Report: output/playwright/pb-electron/restored-S04-structured-progress.json.
it.each([{ proposed: 1, choice: 'ALLOW' }, { proposed: 2, choice: 'REVISE' }])('compares extracted option configurations in code instead of trusting a matching boolean (%j)', async ({ proposed, choice }) => {
  const complete = async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ groups: [{ productName: '每日新品', variantName: '', options: [], note: '', quantity: 2 }, { productName: '每日新品', variantName: '', options: [{ name: '配菜', quantity: 1 }], note: '', quantity: 1 }] }) } }] } }] })
  expect(await decideEffect({ ...effect, transcript: '每日新品三份，其中一份加配菜，兩份不加', serving: { productName: '每日新品', variantName: '', options: [{ name: '配菜', quantity: 1 }] }, deltas: [{ name: '每日新品', kind: 'product', mode: 'increase', quantity: proposed }] }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice })
})

it('refuses matching booleans that omit the actual requested configuration', async () => {
  const complete = async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: '{"groups":[{"quantity":2,"matchesServing":true,"note":""}]}' } }] } }] })
  expect(await decideEffect({ ...effect, serving: { productName: '每日新品', variantName: '', options: [{ name: '配菜', quantity: 1 }] }, deltas: [{ name: '每日新品', kind: 'product', mode: 'increase', quantity: 2 }] }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice: 'CLARIFY', provider: 'unavailable' })
})

it('accepts a bounded completed receipt with configuration labels instead of dropping them before the next step', () => {
  expect(safeParse(browserEffectSchema, { ...effect, completedEffects: [`已加入每日新品（${'配菜、'.repeat(200)}）1 份。`] }).success).toBe(true)
  expect(safeParse(browserEffectSchema, { ...effect, completedEffects: ['字'.repeat(4_001)] }).success).toBe(false)
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, S09.
it.each([{ proposed: 14, choice: 'ALLOW' }, { proposed: 27, choice: 'REVISE' }])('converts a requested product total to the selected row while retaining the other thirteen (%j)', async ({ proposed, choice }) => {
  const proposal = { ...effect, action: 'quantity' as const, transcript: '原餐總共改成二十七份', cartTarget: { selected: { name: '原餐', quantity: 17 }, others: [{ name: '原餐', quantity: 13, sameConfiguration: true }] }, deltas: [{ name: '原餐', kind: 'cart_line' as const, mode: 'set' as const, quantity: proposed }] }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 27, scope: 'product' }], targetMatches: true, noteMatches: true, reason: '要求整個品項共二十七份' }) } }] } }] }))
  expect(await decideEffect(proposal, { finite: async () => ({ answers: { purpose: { choice: 'QUANTITY', confidence: 0.95 } } }), complete: withPurpose('QUANTITY', complete) })).toMatchObject({ choice })
})

it('rejects the wrong configuration even when the requested removal quantity matches', async () => {
  const proposal = { ...effect, action: 'remove' as const, transcript: '把加白飯的那份取消', cartTarget: { selected: { name: '原餐', quantity: 1, description: '' }, others: [{ name: '原餐', quantity: 1, description: '白飯 ×1', sameConfiguration: false }] }, deltas: [{ name: '原餐', kind: 'cart_line' as const, mode: 'remove' as const, quantity: 1 }] }
  expect(await decideEffect(proposal, { finite: async () => ({ answers: { purpose: { choice: 'REMOVE', confidence: 0.95 } } }), complete: withPurpose('REMOVE', async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 1, scope: 'target' }], targetMatches: false, noteMatches: true, reason: '指定列不是加飯配置' }) } }] } }] })) })).toMatchObject({ choice: 'REVISE' })
})

// Report: output/playwright/pb-electron/restored-S04-partial-after.json.
it('distinguishes replacement servings and new option units from the servings that keep their old options', async () => {
  const proposal = { ...effect, action: 'replace' as const, transcript: '原來三份加配菜，其中一份改不加，另外兩份維持加配菜', serving: { productName: '每日新品', variantName: '', options: [] }, cartTarget: { selected: { name: '每日新品', quantity: 3, description: '配菜 ×1' }, others: [] }, deltas: [{ name: '配菜', kind: 'option' as const, mode: 'increase' as const, quantity: 0 }, { name: '每日新品', kind: 'product' as const, mode: 'increase' as const, quantity: 1 }, { name: '每日新品', kind: 'cart_line' as const, mode: 'remove' as const, quantity: 1 }] }
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ replacementServings: 1, changedOriginalServings: 1, targetMatches: true, noteMatches: true, reason: '只轉換一份配置，保留的兩份不是新增配菜' }) } }] } }] }))
  expect(await decideEffect(proposal, { finite: async () => ({ answers: { purpose: { choice: 'REPLACE', confidence: 0.95 } } }), complete: withPurpose('REPLACE', complete) })).toMatchObject({ choice: 'ALLOW' })
  expect(await decideEffect({ ...proposal, deltas: proposal.deltas.map(delta => ({ ...delta, quantity: delta.kind === 'option' ? 2 : delta.quantity })) }, { finite: async () => ({ answers: { purpose: { choice: 'REPLACE', confidence: 0.95 } } }), complete: withPurpose('REPLACE', complete) })).toMatchObject({ choice: 'REVISE' })
  const messages = complete.mock.calls[0][0].messages
  // The live checker timed out after 30s without producing a tool result.
  // Bound output and avoid repeating the full policy in the tool description.
  expect(complete.mock.calls[0][0].max_tokens).toBe(448)
  expect(complete.mock.calls[0][0].tools).toEqual([{ type: 'function', function: expect.objectContaining({ description: '讀取原句要求的各目標數量、範圍及配置／備註是否吻合。' }) }])
  expect(messages).toEqual([
    expect.objectContaining({ role: 'system' }),
    { role: 'assistant', content: JSON.stringify({ action: 'replace', candidateNote: '' }) },
    { role: 'user', content: proposal.transcript },
  ])
})

it.each([
  { replacementServings: 1, changedOriginalServings: 1, targetMatches: true, noteMatches: true, choice: 'ALLOW' },
  { replacementServings: 2, changedOriginalServings: 1, targetMatches: true, noteMatches: true, choice: 'REVISE' },
  { replacementServings: 1, changedOriginalServings: 3, targetMatches: true, noteMatches: true, choice: 'REVISE' },
  { replacementServings: 1, changedOriginalServings: 1, targetMatches: false, noteMatches: true, choice: 'REVISE' },
  { replacementServings: 1, changedOriginalServings: 1, targetMatches: true, noteMatches: false, choice: 'REVISE' },
])('checks replacement counts and per-serving options independently of the proposed totals (%j)', async ({ choice, ...extracted }) => {
  const proposal = { ...effect, action: 'replace' as const, transcript: '三份原餐裡，一份改成每份加兩份配菜，另兩份維持原樣', serving: { productName: '每日新品', variantName: '', options: [{ name: '配菜', quantity: 2 }] }, cartTarget: { selected: { name: '每日新品', quantity: 3 }, others: [] }, deltas: [{ name: '配菜', kind: 'option' as const, mode: 'increase' as const, quantity: 2 }, { name: '每日新品', kind: 'product' as const, mode: 'increase' as const, quantity: 1 }, { name: '每日新品', kind: 'cart_line' as const, mode: 'remove' as const, quantity: 1 }] }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ ...extracted, reason: '讀取原句指定的配置變更' }) } }] } }] }))
  expect(await decideEffect(proposal, { finite: async () => ({ answers: { purpose: { choice: 'REPLACE', confidence: 0.95 } } }), complete: withPurpose('REPLACE', complete) })).toMatchObject({ choice })
})

it.each([
  { scope: 'configuration', requested: 5, proposed: 2, choice: 'ALLOW' },
  { scope: 'product', requested: 5, proposed: 2, choice: 'REVISE' },
  { scope: 'product', requested: 2, proposed: 1, choice: 'REVISE' },
  { scope: 'target', requested: 5, proposed: 5, choice: 'ALLOW' },
])('retains only rows in the explicitly requested count scope (%j)', async ({ scope, requested, proposed, choice }) => {
  const proposal = { ...effect, action: 'quantity' as const, transcript: '依指定配置調整份數', cartTarget: { selected: { name: '原餐', quantity: 7 }, others: [{ name: '原餐', quantity: 3, sameConfiguration: true }, { name: '原餐', quantity: 2, description: '白飯 ×1', sameConfiguration: false }] }, deltas: [{ name: '原餐', kind: 'cart_line' as const, mode: 'set' as const, quantity: proposed }] }
  expect(await decideEffect(proposal, { finite: async () => ({ answers: { purpose: { choice: 'QUANTITY', confidence: 0.95 } } }), complete: withPurpose('QUANTITY', async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: requested, scope }], targetMatches: true, noteMatches: true, reason: '已抽取範圍' }) } }] } }] })) })).toMatchObject({ choice })
})

it('explains when a requested configuration total requires a grouped edit instead of a negative single-row quantity', async () => {
  const proposal = { ...effect, transcript: '不加配菜的總共改一份，加配菜的兩份不要動', action: 'quantity' as const, cartTarget: { selected: { name: '原餐', quantity: 1 }, others: [{ name: '原餐', quantity: 2, sameConfiguration: true }, { name: '原餐', quantity: 2, description: '配菜 ×1', sameConfiguration: false }] }, deltas: [{ name: '原餐', kind: 'cart_line' as const, mode: 'set' as const, quantity: 0 }] }
  const complete = withPurpose('QUANTITY', async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 1, scope: 'configuration' }], targetMatches: true, noteMatches: true, reason: '不加配菜合計一份' }) } }] } }] }))
  const result = await decideEffect(proposal, { complete })
  expect(result.choice).toBe('REVISE')
  expect(result.checks?.at(-1)?.reason).toContain('lineRefs')
})

// Report: output/playwright/pb-electron/restored-S04-nov4-group-prose-fixed.json.
it.each([
  { scope: 'configuration', selected: 1, other: 2, choice: 'REVISE' },
  { scope: 'target', selected: 2, other: 1, choice: 'ALLOW' },
])('checks quantity scope separately from add/replace notes (%j)', async ({ scope, selected, other, choice }) => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 1, scope }], targetMatches: true }) } }] } }] }))
  const result = await decideEffect({ ...effect, transcript: scope === 'configuration' ? '不加配菜的總共一份，加配菜兩份不動' : '兩份那一列改一份，其他都不動', action: 'quantity', cartTarget: { selected: { name: '原餐', quantity: selected }, others: [{ name: '原餐', quantity: other, sameConfiguration: true }, { name: '原餐', quantity: 2, description: '配菜 ×1', sameConfiguration: false }] }, deltas: [{ name: '原餐', kind: 'cart_line', mode: 'set', quantity: 1 }] }, { complete: withPurpose('QUANTITY', complete) })
  expect(result.choice).toBe(choice)
  const messages = complete.mock.calls[0][0].messages
  expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: expect.stringContaining('"configuration":3') })]))
  if (choice === 'REVISE')
    expect(result.checks?.at(-1)?.reason).toContain('lineRefs')
})

it('provides serving configuration but hides proposed totals when validating a split initial order', async () => {
  const serving = { productName: '每日新品', variantName: '', options: [] }
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ groups: [{ productName: '每日新品', variantName: '', options: [], quantity: 2, note: '' }, { productName: '每日新品', variantName: '', options: [{ name: '白飯', quantity: 1 }], quantity: 1, note: '' }], reason: '三份中一份加飯，原配置兩份' }) } }] } }] }))
  expect(await decideEffect({ ...effect, transcript: '每日新品三份，其中一份加飯', serving, deltas: [{ name: '每日新品', kind: 'product', mode: 'increase', quantity: 2 }] }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice: 'ALLOW' })
  const messages = complete.mock.calls[0][0].messages
  expect(messages).toEqual([
    expect.objectContaining({ role: 'system', content: expect.stringContaining(JSON.stringify(serving)) }),
    { role: 'assistant', content: JSON.stringify({ action: 'add', targets: [{ id: 'target:1', name: '每日新品', kind: 'product', mode: 'increase' }], candidateNote: '' }) },
    { role: 'user', content: '每日新品三份，其中一份加飯' },
  ])
})

// Report: output/playwright/pb-electron/restored-S05-notes-initial.json.
it.each([
  { perServing: 0, proposedOption: 0, targetMatches: true, choice: 'ALLOW' },
  { perServing: 2, proposedOption: 2, targetMatches: true, choice: 'ALLOW' },
  { perServing: 0, proposedOption: 1, targetMatches: true, choice: 'REVISE' },
  { perServing: 1, proposedOption: 1, targetMatches: false, choice: 'REVISE' },
])('derives add-on totals from independently checked meal counts and serving consent (%j)', async ({ perServing, proposedOption, targetMatches, choice }) => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ groups: [{ productName: '每日新品', variantName: '', options: targetMatches && perServing ? [{ name: '配菜', quantity: perServing }] : [], quantity: 1, note: '飯少' }, { productName: '每日新品', variantName: '', options: targetMatches && perServing ? [{ name: '配菜', quantity: perServing }] : [], quantity: 1, note: '不要辣' }], reason: '兩種備註各一份；加購依每份配置核對' }) } }] } }] }))
  expect(await decideEffect({ ...effect, transcript: `兩份每日新品，一份飯少，另一份不要辣，${targetMatches && perServing ? `每份加${perServing}份配菜` : '不加配菜'}`, note: '飯少', serving: { productName: '每日新品', variantName: '', options: perServing ? [{ name: '配菜', quantity: perServing }] : [] }, deltas: [{ name: '配菜', kind: 'option', mode: 'increase', quantity: proposedOption }, { name: '每日新品', kind: 'product', mode: 'increase', quantity: 1 }] }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice })
  expect(complete.mock.calls[0][0].messages).toEqual(expect.arrayContaining([{ role: 'assistant', content: JSON.stringify({ action: 'add', targets: [{ id: 'target:2', name: '每日新品', kind: 'product', mode: 'increase' }], candidateNote: '飯少' }) }]))
})

it('requires all addition group fields without requiring non-authorizing model prose', async () => {
  const proposal = { ...effect, transcript: '每日新品一份不要辣', note: '不要辣', serving: { productName: '每日新品', variantName: '', options: [] } }
  const complete = async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ groups: [{ ...proposal.serving, quantity: 1, note: '不要辣' }] }) } }] } }] })
  expect(await decideEffect(proposal, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice: 'ALLOW' })
})

it.each([{ productName: '每日新品', variantName: '', options: [], note: '不要辣' }, { productName: '每日新品', variantName: '', options: [], quantity: 1 }, { productName: '每日新品', variantName: '', quantity: 1, note: '不要辣' }])('rejects an incomplete independent addition group (%j)', async (group) => {
  const complete = async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ groups: [group] }) } }] } }] })
  expect(await decideEffect({ ...effect, transcript: '每日新品一份不要辣', note: '不要辣', serving: { productName: '每日新品', variantName: '', options: [] } }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice: 'CLARIFY', provider: 'unavailable' })
})

it('does not infer missing scope or target consent from an otherwise valid quantity response', async () => {
  expect(await decideEffect({ ...effect, transcript: '每日新品一份' }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete: async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 1 }], noteMatches: true, reason: '不完整' }) } }] } }] }) })).toMatchObject({ choice: 'CLARIFY' })
})

// Report: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov2 S04/S12.
it('provides current cart facts when distinguishing a cart removal from cancelling a pending choice', async () => {
  const question = { questionId: 'q', purpose: 'browser-product-choice', question: '甲餐、乙餐，哪一項？', expiresAt: 200, choices: [{ id: 'product:1', description: '甲餐' }, { id: 'cancel', description: '取消這次選餐' }] }
  const cartContext = { version: 'current-cart', lines: [{ name: '甲餐', quantity: 1, description: '白飯 ×1', note: '' }] }
  const finite = vi.fn(async (_state: string, _questions: Record<string, unknown>) => ({ answers: { answer_relation: { choice: 'NEW_REQUEST', confidence: 0.95 } } }))
  expect(await decideAnswer({ questionId: 'q', transcript: '把加白飯的那份取消', cartContext }, question, { finite, complete: vi.fn() }, 100)).toMatchObject({ kind: 'NEW_REQUEST' })
  const state = JSON.parse(finite.mock.calls[0][0])
  expect(state.customerUtterance).toBe('把加白飯的那份取消')
  expect(state.currentCart).toEqual(cartContext)
})

it('retains an inquiry decision without granting the planner any executable tools', async () => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_purpose', arguments: '{"choice":"INFORMATION","reason":"只詢問資訊"}' } }] } }] }))
  expect(await decideEffect(effect, { complete })).toMatchObject({ choice: 'READ_ONLY', provider: 'main' })
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0, tools: [{ type: 'function', function: expect.objectContaining({ name: 'judge_browser_purpose' }) }] }))
})

it('uses confident Jev or adapter-validated SLM decisions without another Main call', async () => {
  const complete = vi.fn(async () => Response.json({}))
  expect(await decideEffect(effect, { complete, finite: async () => ({ answers: { purpose: { choice: 'INFORMATION', confidence: 0.95 } } }) })).toMatchObject({ choice: 'READ_ONLY', provider: 'system-one' })
  expect(await decideEffect(effect, { complete, finite: async () => ({ selectionMode: 'unscored', answers: { purpose: { choice: 'UNCERTAIN' } } }) })).toMatchObject({ choice: 'CLARIFY', provider: 'system-one' })
  expect(complete).not.toHaveBeenCalled()
})

it('falls back from a weak finite answer and refuses malformed Main output', async () => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'browser_cart_add', arguments: '{"choice":"ALLOW"}' } }] } }] }))
  expect(await decideEffect(effect, { complete, finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.2 } } }) })).toMatchObject({ choice: 'CLARIFY', provider: 'unavailable' })
  expect(complete).toHaveBeenCalledOnce()
})

it('cannot authorize writes after provider failures', async () => {
  expect(await decideEffect(effect, {
    complete: async () => { throw new Error('offline') },
    finite: async () => { throw new Error('offline') },
  })).toMatchObject({ choice: 'CLARIFY', provider: 'unavailable' })
})

// Report: output/playwright/pb-electron/restored-S04-nov4-group.json.
it('bounds finite Main output and preserves a purpose timeout without authorizing a write', async () => {
  const complete = vi.fn(async () => {
    throw new Error('Semantic provider request timed out')
  })
  const result = await decideEffect(effect, { complete })
  expect(result).toMatchObject({ choice: 'CLARIFY', provider: 'unavailable' })
  expect(result.checks?.[0].reason).toContain('timed out')
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 512 }))
})

// Report: output/playwright/pb-electron/restored-S04-nov4-group-bounded.json.
it('does not require diagnostic prose before independently checking a strict quantity label', async () => {
  const complete = vi.fn()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_purpose', arguments: '{"choice":"QUANTITY"}' } }] } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: '{"quantities":[{"id":"target:1","quantity":1,"scope":"target"}],"targetMatches":true,"noteMatches":true,"reason":"要求一份"}' } }] } }] }))
  expect(await decideEffect({ ...effect, transcript: '原餐改一份', action: 'quantity', cartTarget: { selected: { name: '原餐', quantity: 3 }, others: [] }, deltas: [{ name: '原餐', kind: 'cart_line', mode: 'set', quantity: 1 }] }, { complete })).toMatchObject({ choice: 'ALLOW', provider: 'main' })
  expect(complete).toHaveBeenCalledTimes(2)
})

it.each([{ choice: 'invented' }, {}])('still rejects missing or invalid finite authority labels (%j)', async (args) => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_purpose', arguments: JSON.stringify(args) } }] } }] }))
  expect(await decideEffect(effect, { complete })).toMatchObject({ choice: 'CLARIFY', provider: 'unavailable' })
  expect(complete).toHaveBeenCalledOnce()
})

// Report: this chat, 2026-10-29; real Main attempted D13 as remove followed by add.
it('rejects both partial replacement proposals before checking or dispatching their effects', async () => {
  const finite = vi.fn(async (_state: string, _questions: Record<string, unknown>) => ({ answers: { purpose: { choice: 'REPLACE', confidence: 0.95 } } }))
  const complete = vi.fn(async () => Response.json({}))
  for (const action of ['remove', 'add'] as const) {
    expect(await decideEffect({ ...effect, action, transcript: '原餐不要，改每日新品一份' }, { finite, complete })).toMatchObject({ choice: 'DIFFERENT_OPERATION', requiredAction: 'replace', provider: 'system-one' })
  }
  expect(finite).toHaveBeenCalledTimes(2)
  expect(finite.mock.calls[0]?.[0]).not.toContain('proposedEffect')
  expect(complete).not.toHaveBeenCalled()
})

it('uses SLM for whole-demand routing and independently verifies free-form effect parameters with Main', async () => {
  const finite = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ selectionMode: 'unscored' as const, answers: Object.hasOwn(questions, 'purpose') ? { purpose: { choice: 'REPLACE' } } : { effect: { choice: 'ALLOW' } } }))
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: '{"quantities":[{"id":"target:1","quantity":1,"scope":"target"}],"targetMatches":true,"noteMatches":true,"reason":"完整替換與原句相符"}' } }] } }] }))
  expect(await decideEffect({ ...effect, action: 'replace' }, { finite, complete })).toMatchObject({ choice: 'ALLOW', provider: 'main' })
  expect(finite).toHaveBeenCalledTimes(1)
  expect(complete).toHaveBeenCalledTimes(1)
  expect(Object.keys(finite.mock.calls[0]![1])).toEqual(['purpose'])
})

// Report: this chat, 2026-10-30; a weak finite purpose must not return to finite ALLOW after Main adjudication.
it('passes full definitions to Main and keeps effect validation with Main after weak finite purpose', async () => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_purpose', arguments: '{"choice":"REPLACE","reason":"測試替換判斷"}' } }] } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: '{"quantities":[{"id":"target:1","quantity":0,"scope":"target"}],"targetMatches":true,"noteMatches":true,"reason":"原句要求保留原餐"}' } }] } }] }))
  const finite = vi.fn(async () => ({ answers: { purpose: { choice: 'QUANTITY', confidence: 0.5171 } } }))
  const result = await decideEffect({ ...effect, action: 'replace', transcript: '每日新品改兩份，不要換原餐' }, { complete, finite })
  expect(result).toMatchObject({ choice: 'REVISE', provider: 'main' })
  expect(complete).toHaveBeenCalledTimes(2)
  expect(finite).toHaveBeenCalledTimes(1)
  expect(complete.mock.calls[0]?.[0]).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('只改原餐點最後總份數，保留商品及每份原規格／加購／備註') })]) })
})

it('returns a repairable no-effect decision for an explicit quantity mismatch instead of asking the customer to repeat it', async () => {
  const result = await decideEffect({ ...effect, action: 'replace', transcript: '原餐不要了，改新餐一份', deltas: [{ name: '新餐', kind: 'product', mode: 'increase', quantity: 2 }] }, {
    finite: async () => ({ answers: { purpose: { choice: 'REPLACE', confidence: 0.95 } } }),
    complete: async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: '{"quantities":[{"id":"target:1","quantity":1,"scope":"target"}],"targetMatches":true,"noteMatches":true,"reason":"原句指定一份"}' } }] } }] }),
  })
  expect(result).toMatchObject({ choice: 'REVISE', provider: 'main', checks: expect.arrayContaining([expect.objectContaining({ stage: 'effect', reason: expect.stringContaining('新餐：顧客尚需 1，提案 2') })]) })
})

// Report: this chat, 2026-10-30; qwen36 quoted candidate quantities as the customer utterance.
it('withholds proposed quantities and prose while keeping the literal customer sentence as the final user message', async () => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: '{"quantities":[{"id":"target:1","quantity":1,"scope":"target"}],"targetMatches":true,"noteMatches":true,"reason":"顧客一份"}' } }] } }] }))
  await decideEffect({ ...effect, transcript: '每日新品一份', description: '新增每日新品兩份' }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })
  const body = complete.mock.calls[0]![0]
  expect(JSON.stringify(body.messages)).not.toContain('新增每日新品兩份')
  expect(JSON.stringify(body.messages)).not.toContain('proposedQuantityEffects')
  expect(body.messages).toEqual([
    expect.objectContaining({ role: 'system' }),
    expect.objectContaining({ role: 'assistant', content: expect.stringContaining('每日新品') }),
    { role: 'user', content: '每日新品一份' },
  ])
})

// Report: this chat, 2026-10-30; valid qwen36 replacement verdict carried a 477-character diagnostic.
it('bounds diagnostic prose without discarding a valid finite verdict', async () => {
  const result = await decideEffect({ ...effect, action: 'replace' }, {
    finite: async () => ({ answers: { purpose: { choice: 'REPLACE', confidence: 0.95 } } }),
    complete: async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 1, scope: 'target' }], targetMatches: true, noteMatches: true, reason: '已核對實際餐點與數量。'.repeat(50) }) } }] } }] }),
  })
  expect(result.choice).toBe('ALLOW')
  expect(result.checks?.at(-1)?.reason.length).toBeLessThanOrEqual(240)
})

it('separates fresh verified cart facts from the unexecuted candidate plan', async () => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: '{"quantities":[{"id":"target:1","quantity":1,"scope":"target"}],"targetMatches":true,"noteMatches":true,"reason":"原行兩份全移除，新餐依顧客指定加一份"}' } }] } }] }))
  await decideEffect({ ...effect, action: 'replace', transcript: '原餐不要了，改新餐一份', storeFacts: 'PB 原行確有兩份', description: '移除原行兩份，新增新餐一份' }, { finite: async () => ({ answers: { purpose: { choice: 'REPLACE', confidence: 0.95 } } }), complete })
  expect(complete.mock.calls[0]![0].messages).toEqual([
    expect.objectContaining({ role: 'system', content: expect.stringContaining('PB 原行確有兩份') }),
    expect.objectContaining({ role: 'assistant', content: expect.not.stringContaining('PB 原行確有兩份') }),
    { role: 'user', content: '原餐不要了，改新餐一份' },
  ])
})

// Report: this chat, 2026-10-30; the live guard treated one add as an incomplete two-meal order.
it.each([{ completedEffects: [] }, { completedEffects: ['已加入甲餐 1 份。'] }])('allows one remaining requested meal without exposing candidate quantities (completed=%j)', async ({ completedEffects }) => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 1, scope: 'target' }], targetMatches: true, noteMatches: true, reason: '乙餐尚需一份' }) } }] } }] }))
  expect(await decideEffect({ ...effect, transcript: '甲餐、乙餐各一份', completedEffects, deltas: [{ name: '乙餐', kind: 'product', mode: 'increase', quantity: 1 }] }, { finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }), complete })).toMatchObject({ choice: 'ALLOW' })
  const messages = complete.mock.calls[0]![0].messages
  expect(messages).toEqual([
    expect.objectContaining({ role: 'system' }),
    { role: 'assistant', content: JSON.stringify({ action: 'add', targets: [{ id: 'target:1', name: '乙餐', kind: 'product', mode: 'increase' }], candidateNote: '' }) },
    { role: 'user', content: '甲餐、乙餐各一份' },
  ])
})

it.each([
  { quantities: [{ id: 'target:1', quantity: 1, scope: 'target' }], targetMatches: true, noteMatches: true, choice: 'REVISE' },
  { quantities: [{ id: 'target:1', quantity: 2, scope: 'target' }], targetMatches: true, noteMatches: false, choice: 'REVISE' },
  { quantities: [{ id: 'target:1', quantity: 0, scope: 'target' }], targetMatches: true, noteMatches: true, choice: 'REVISE' },
  { quantities: [{ id: 'target:1', quantity: 2, scope: 'target' }, { id: 'target:1', quantity: 2, scope: 'target' }], targetMatches: true, noteMatches: true, choice: 'CLARIFY' },
  { quantities: [{ id: 'invented', quantity: 2, scope: 'target' }], targetMatches: true, noteMatches: true, choice: 'CLARIFY' },
])('compares exact extracted quantities and rejects malformed targets: %j', async ({ quantities, noteMatches, choice }) => {
  expect(await decideEffect({ ...effect, transcript: '每日新品兩份', deltas: [{ name: '每日新品', kind: 'product', mode: 'increase', quantity: 2 }] }, {
    finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }),
    complete: async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities, targetMatches: true, noteMatches, reason: '逐目標抽取' }) } }] } }] }),
  })).toMatchObject({ choice })
})

it('uses finite question IDs for a short answer and cannot return executable parameters', async () => {
  const complete = vi.fn(async () => Response.json({}))
  const question = { questionId: 'q', purpose: 'browser-product-choice', question: '甲餐、乙餐，哪一項？', expiresAt: 200, choices: [{ id: 'product:1', description: '甲餐' }, { id: 'product:2', description: '乙餐' }] }
  expect(await decideAnswer({ transcript: '第二個', questionId: question.questionId }, question, { complete, finite: async (_state, questions) => ({ answers: Object.hasOwn(questions, 'answer_relation') ? { answer_relation: { choice: 'ANSWER', confidence: 0.95 } } : { answer: { choice: 'product:2', confidence: 0.95 } } }) }, 100)).toMatchObject({ kind: 'ANSWER', choiceId: 'product:2', provider: 'system-one' })
  expect(complete).not.toHaveBeenCalled()
  expect(await decideAnswer({ transcript: '第二個', questionId: question.questionId }, question, { complete }, 201)).toEqual({ kind: 'UNCERTAIN', provider: 'unavailable' })
  expect(complete).not.toHaveBeenCalled()
})

it.each(['NEW_REQUEST', 'UNCERTAIN', 'confirm'])('validates bounded Main answers after a weak finite answer: %s', async (choice) => {
  const question = { questionId: 'q', purpose: 'browser-confirm-add', question: '確認甲餐一份10元嗎？', expiresAt: 200, choices: [{ id: 'confirm', description: '同意這份完整提案' }, { id: 'cancel', description: '取消未加入餐點' }] }
  expect(await decideAnswer({ transcript: '對，但改兩份', questionId: question.questionId }, question, {
    finite: async (_state, questions) => ({ answers: Object.hasOwn(questions, 'answer_relation') ? { answer_relation: { choice: 'ANSWER', confidence: 0.95 } } : { answer: { choice: 'confirm', confidence: 0.1 } } }),
    complete: async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_answer', arguments: JSON.stringify({ choice, reason: 'Test finite relation' }) } }] } }] }),
  }, 100)).toMatchObject(choice === 'confirm' ? { kind: 'ANSWER', choiceId: 'confirm', provider: 'main' } : { kind: choice, provider: 'main' })
})

// Report: this chat, 2026-10-30; actual Jev selected the ordinal and dropped its attached quantity.
it('checks whole-answer relation before showing tempting product candidates', async () => {
  const finite = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: Object.hasOwn(questions, 'answer_relation') ? { answer_relation: { choice: 'NEW_REQUEST', confidence: 0.95 } } : { answer: { choice: 'product:2', confidence: 0.99 } } }))
  const complete = vi.fn(async () => Response.json({}))
  const question = { questionId: 'q', purpose: 'browser-product-choice', question: '甲餐、乙餐，哪一項？', expiresAt: 200, choices: [{ id: 'product:1', description: '甲餐' }, { id: 'product:2', description: '乙餐' }] }
  expect(await decideAnswer({ transcript: '第二個兩份', questionId: question.questionId }, question, { finite, complete }, 100)).toMatchObject({ kind: 'NEW_REQUEST', checks: [{ stage: 'relation', choice: 'NEW_REQUEST' }] })
  expect(finite).toHaveBeenCalledOnce()
  expect(finite.mock.calls[0]![0]).not.toContain('product:2')
  expect(complete).not.toHaveBeenCalled()
})

it('lets bounded Main resolve a finite uncertain answer without treating uncertainty as consent', async () => {
  const question = { questionId: 'q', purpose: 'browser-product-choice', question: '甲餐、乙餐，哪一項？', expiresAt: 200, choices: [{ id: 'product:1', description: '甲餐' }, { id: 'cancel', description: '取消選餐' }] }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'judge_browser_answer', arguments: JSON.stringify({ choice: 'cancel', reason: '明確說先不要了' }) } }] } }] }))
  const finite = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: Object.hasOwn(questions, 'answer_relation') ? { answer_relation: { choice: 'ANSWER', confidence: 0.95 } } : { answer: { choice: 'UNCERTAIN', confidence: 0.95 } } }))
  expect(await decideAnswer({ transcript: '先不要了', questionId: question.questionId }, question, { finite, complete }, 100)).toMatchObject({ kind: 'ANSWER', choiceId: 'cancel', provider: 'main' })
  expect(complete).toHaveBeenCalledOnce()
})

// Report: this chat, 2026-10-30; refusing an option still permits the requested base meal.
it.each(['option', 'product'] as const)('allows a zero omission constraint only for options: %s', async (kind) => {
  expect(await decideEffect({ ...effect, transcript: '每日新品一份，不要配菜', deltas: [{ name: '配菜', kind, mode: 'increase', quantity: 0 }] }, {
    finite: async () => ({ answers: { purpose: { choice: 'ADD', confidence: 0.95 } } }),
    complete: async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'read_requested_quantities', arguments: JSON.stringify({ quantities: [{ id: 'target:1', quantity: 0, scope: 'target' }], targetMatches: true, noteMatches: true, reason: '明確拒絕配菜' }) } }] } }] }),
  })).toMatchObject({ choice: kind === 'option' ? 'ALLOW' : 'REVISE' })
})

// Report: this chat, 2026-11-14 — 排骨便當 was extracted correctly but rejected against 炸排骨便當.
it.each([false, true])('normalizes only unique published aliases during independent group extraction (ambiguous=%s)', async (ambiguous) => {
  const complete = vi.fn(async (body: Record<string, unknown>) => {
    const purpose = JSON.stringify(body.tools).includes('judge_browser_purpose')
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: purpose ? 'judge_browser_purpose' : 'read_requested_quantities', arguments: JSON.stringify(purpose ? { choice: 'ADD' } : { groups: [{ productName: '排骨便當', variantName: '', options: [], quantity: 1, note: '' }] }) } }] } }] })
  })
  const result = await decideEffect({ ...effect, transcript: '我要一份排骨便當', deltas: [{ name: '炸排骨便當', kind: 'product', mode: 'increase', quantity: 1 }], serving: { productName: '炸排骨便當', variantName: '', options: [] } }, {
    complete,
    catalogLabels: [{ name: '炸排骨便當', aliases: ['排骨便當'], category: '' }, ...(ambiguous ? [{ name: '滷排骨便當', aliases: ['排骨便當'], category: '' }] : [])],
  })
  expect(result.choice).toBe(ambiguous ? 'REVISE' : 'ALLOW')
})
