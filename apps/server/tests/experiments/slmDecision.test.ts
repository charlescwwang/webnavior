import type { SystemOneQuestion } from '../../src/services/domain/kiosk-system-one'

import { expect, it, vi } from 'vitest'

import { choose } from './slmDecision'

const question: SystemOneQuestion = { type: 'choice', instructions: '查詢不是購買。', criteria: { SEARCH: '詢問有沒有販售', ADD: '明確購買', UNCERTAIN: '不能確定' } }
const target = { baseURL: 'http://127.0.0.1:12434/engines/v1', modelId: 'local/test', timeoutMs: 1000 }
const completion = (content: string, extra: Record<string, unknown> = {}) => Response.json({ choices: [{ finish_reason: 'stop', message: { content, ...extra } }], usage: { prompt_tokens: 30, completion_tokens: 1 }, timings: { cache_n: 0, prompt_n: 30, prompt_ms: 100, predicted_ms: 20 } })

it('maps a bounded label to the original choice without inventing confidence', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => completion('B'))
  const result = await choose({ ...target, format: 'label', state: '我要水餃', question, fetchImpl })
  expect(result.choice).toBe('ADD')
  expect(result).not.toHaveProperty('confidence')
  expect(result.timings?.cache_n).toBe(0)
  const [url, init] = fetchImpl.mock.calls[0]!
  expect(url).toBe(`${target.baseURL}/chat/completions`)
  const body = JSON.parse(String(init?.body))
  expect(body.max_tokens).toBe(1)
  expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
  expect(body).not.toHaveProperty('tools')
  expect(body).not.toHaveProperty('response_format')
})

it('accepts the one-token budget boundary only for an exact label', async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: 'A' } }] })
  expect((await choose({ ...target, state: '有水餃嗎', question, format: 'label', fetchImpl })).choice).toBe('SEARCH')
})

it('keeps a reusable question prefix while sending only the new state in each full-corpus request', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => completion('A'))
  await choose({ ...target, state: '有水餃嗎', question, format: 'label', questionFirst: true, cachePrompt: true, fetchImpl })
  await choose({ ...target, state: '有紅茶嗎', question, format: 'label', questionFirst: true, cachePrompt: true, fetchImpl })
  const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
  expect(bodies[0].messages[1].content.split('<state>')[0]).toBe(bodies[1].messages[1].content.split('<state>')[0])
  expect(bodies[1].messages[1].content).toContain('有紅茶嗎')
  expect(bodies[1].messages[1].content).not.toContain('有水餃嗎')
  expect(bodies[1].cache_prompt).toBe(true)
  expect(bodies[1].messages).toHaveLength(2)
})

it('requests a constrained JSON choice and validates it independently', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => completion('{"choice":"SEARCH"}'))
  expect((await choose({ ...target, state: '有水餃嗎', question, format: 'json', fetchImpl })).choice).toBe('SEARCH')
  const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))
  expect(body.response_format.json_schema.schema.properties.choice.enum).toEqual(['SEARCH', 'ADD', 'UNCERTAIN'])
})

it.each(['A B', 'A.', '<think>選A</think>A', 'Z', ''])('rejects a non-single or unavailable label: %s', async (content) => {
  await expect(choose({ ...target, state: '有水餃嗎', question, format: 'label', fetchImpl: async () => completion(content) })).rejects.toThrow('SLM_CONTRACT_INVALID')
})

it.each(['{"choice":"SEARCH","confidence":1}', '{"choice":"FAKE"}', '文字{"choice":"SEARCH"}', '{"choice":'])('rejects invalid JSON contracts instead of repairing or extracting them: %s', async (content) => {
  await expect(choose({ ...target, state: '有水餃嗎', question, format: 'json', fetchImpl: async () => completion(content) })).rejects.toThrow('SLM_CONTRACT_INVALID')
})

it.each([{ reasoning_content: '先思考' }, { reasoning: '思考過程' }, { tool_calls: [{ function: { name: 'order_add_item' } }] }])('rejects thought or tool output even when the choice looks valid: %j', async (extra) => {
  await expect(choose({ ...target, state: '有水餃嗎', question, format: 'label', fetchImpl: async () => completion('A', extra) })).rejects.toThrow('SLM_CONTRACT_INVALID')
})

it('does not treat multiple completions, a truncated JSON or a missing content as a decision', async () => {
  for (const payload of [
    { choices: [{ finish_reason: 'length', message: { content: '{"choice":"SEARCH"}' } }] },
    { choices: [{ finish_reason: 'stop', message: {} }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{"choice":"SEARCH"}' } }, { finish_reason: 'stop', message: { content: '{"choice":"ADD"}' } }] },
  ]) {
    await expect(choose({ ...target, state: '有水餃嗎', question, format: 'json', fetchImpl: async () => Response.json(payload) })).rejects.toThrow('SLM_CONTRACT_INVALID')
  }
})

it('keeps an upstream failure distinct from semantic abstention, with no retry', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }))
  await expect(choose({ ...target, state: '有水餃嗎', question, format: 'label', fetchImpl })).rejects.toThrow('HTTP 503')
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

it('does not call the provider for a cancelled request or an unsupported question', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => completion('A'))
  await expect(choose({ ...target, state: '有水餃嗎', question, format: 'label', fetchImpl, signal: AbortSignal.abort() })).rejects.toThrow()
  await expect(choose({ ...target, state: 'ready', question: { type: 'noul', instructions: 'ready?' }, format: 'label', fetchImpl })).rejects.toThrow('choice')
  expect(fetchImpl).not.toHaveBeenCalled()
})
