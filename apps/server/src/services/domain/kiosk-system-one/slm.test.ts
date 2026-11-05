import { describe, expect, it } from 'vitest'

import { createChoiceRequest, readChoice } from './slm'

const question = { type: 'choice' as const, instructions: 'Choose.', criteria: { SERVICE: 'Service request', BACKGROUND: 'Background' } }
const request = createChoiceRequest('local-qwen', 'new utterance', question)

describe('slm finite wire contract', () => {
  it('uses one token, disables thinking and never supplies execution tools or confidence', () => {
    expect(request.body).toMatchObject({ model: 'local-qwen', max_tokens: 1, stream: false, temperature: 0, chat_template_kwargs: { enable_thinking: false } })
    expect(request.body).not.toHaveProperty('tools')
    expect(request.body).not.toHaveProperty('logprobs')
    expect(request.body.messages[1]?.content).toContain('new utterance')
    expect(readChoice({ choices: [{ finish_reason: 'length', message: { content: 'B' } }] }, request)).toBe('BACKGROUND')
  })

  it.each(['A\n', ' A', 'SERVICE', 'A because', '<think>A</think>', 'Z', ''])('rejects an inexact or unavailable label %j', (content) => {
    expect(() => readChoice({ choices: [{ finish_reason: 'stop', message: { content } }] }, request)).toThrow('SLM_CONTRACT_INVALID')
  })

  it.each([
    { content: 'A', reasoning_content: 'I think' },
    { content: 'A', reasoning: 'I think' },
    { content: 'A', tool_calls: [{ function: { name: 'cart_clear' } }] },
  ])('rejects reasoning and tool output even with a legal label', (message) => {
    expect(() => readChoice({ choices: [{ finish_reason: 'stop', message }] }, request)).toThrow('SLM_CONTRACT_INVALID')
  })

  it('rejects multiple results and non-choice or oversized questions without truncating', () => {
    const answer = { finish_reason: 'stop', message: { content: 'A' } }
    expect(() => readChoice({ choices: [answer, answer] }, request)).toThrow('SLM_CONTRACT_INVALID')
    expect(() => createChoiceRequest('local', '', { type: 'noul', instructions: 'Ready?' })).toThrow('choice')
    expect(() => createChoiceRequest('local', '', { ...question, criteria: Array.from({ length: 7 }, (_, i) => String(i)) })).toThrow('truncation')
  })
})
