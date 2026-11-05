import type { PriceEvidence } from './priceContracts'

import { expect, it, vi } from 'vitest'

import { resolvePriceHandoff } from './priceResolution'

const evidence: PriceEvidence = { amounts: [{ text: '100', amount: 100 }], choices: [
  { id: 'INFORMATION', kind: 'information', description: '詢問售價' },
  { id: 'UPPER_INCLUSIVE', kind: 'condition', conditions: { maxPrice: 100 }, description: '單份100元以下' },
  { id: 'UNSUPPORTED', kind: 'unsupported', description: '無法完整表示' },
] }

it.each(['INFORMATION', 'UPPER_INCLUSIVE', 'UNSUPPORTED'])('accepts only issued Main price semantics: %s', async (choice) => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_price_choice', arguments: JSON.stringify({ choice }) } }] } }] }))
  const result = await resolvePriceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', modelCalls: 7, modelQuestions: 7, trace: {} }, '有水餃或牛肉麵嗎？多少錢？', evidence, complete)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', priceChoiceId: choice, modelCalls: 7, modelQuestions: 7, trace: { priceResolution: { choice } } })
  expect(result).not.toHaveProperty('actionId')
  expect(result).not.toHaveProperty('confidence')
  expect(result.reason).toBe(choice === 'UNSUPPORTED' ? 'UNSUPPORTED_PRICE' : 'UNCERTAIN_FILTER')
  expect(complete.mock.calls[0]![0]).toMatchObject({ tools: [{ function: { name: 'resolve_price_choice' } }], messages: expect.arrayContaining([{ role: 'user', content: JSON.stringify({ customerUtterance: '有水餃或牛肉麵嗎？多少錢？', amounts: evidence.amounts, choices: evidence.choices }) }]) })
})

it.each([
  { name: 'menu_get', arguments: '{"choice":"INFORMATION"}' },
  { name: 'resolve_price_choice', arguments: '{"choice":"invented"}' },
  { name: 'resolve_price_choice', arguments: '{"choice":"INFORMATION","maxPrice":200}' },
  { name: 'resolve_price_choice', arguments: 'invalid' },
])('preserves unresolved admission after an invalid Main proposal: $arguments', async (call) => {
  const result = await resolvePriceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER' }, '100元以下', evidence, async () => Response.json({ choices: [{ message: { tool_calls: [{ function: call }] } }] }))
  expect(result).not.toHaveProperty('priceChoiceId')
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER' })
})

it('keeps the guard after a Main failure and skips Main for an already resolved choice', async () => {
  const complete = vi.fn(async () => {
    throw new Error('offline')
  })
  expect(await resolvePriceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER' }, '多少錢', evidence, complete)).not.toHaveProperty('priceChoiceId')
  expect(await resolvePriceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER', priceChoiceId: 'INFORMATION' }, '多少錢', evidence, complete)).toHaveProperty('priceChoiceId', 'INFORMATION')
  expect(complete).toHaveBeenCalledOnce()
})

it('qualifies an admitted recovery without changing its meaning or read authority', async () => {
  const recovery = { status: 'completed' as const, admission: 'service' as const, disposition: 'assistant' as const, readOnly: true }
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_price_choice', arguments: '{"choice":"UPPER_INCLUSIVE"}' } }] } }] }))
  const result = await resolvePriceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', recovery }, '100元以下', evidence, complete)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', priceChoiceId: 'UPPER_INCLUSIVE', recovery })
  expect(complete).toHaveBeenCalledOnce()
  expect(result).not.toHaveProperty('actionId')
})

it('does not qualify a provider failure or repeat an existing price decision', async () => {
  const complete = vi.fn(async () => Response.json({}))
  expect(await resolvePriceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'PROVIDER_FAILURE' }, '100元以下', evidence, complete)).not.toHaveProperty('priceChoiceId')
  expect(await resolvePriceHandoff({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', priceChoiceId: 'UPPER_INCLUSIVE', recovery: { status: 'completed', admission: 'service' } }, '100元以下', evidence, complete)).toHaveProperty('priceChoiceId', 'UPPER_INCLUSIVE')
  expect(complete).not.toHaveBeenCalled()
})

it.each(['UNCERTAIN_OPERATION', 'NEW_REQUEST', 'MENU_QUERY', 'UNRESOLVED_FILTER'] as const)('qualifies admitted semantic handoff %s without granting operation authority', async (reason) => {
  const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_price_choice', arguments: '{"choice":"UPPER_INCLUSIVE"}' } }] } }] }))
  const result = await resolvePriceHandoff({ kind: 'NEEDS_ASSISTANT', reason }, '100元以下', evidence, complete)
  expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason, priceChoiceId: 'UPPER_INCLUSIVE' })
  expect(result).not.toHaveProperty('actionId')
  expect(complete).toHaveBeenCalledOnce()
})
