import { expect, it } from 'vitest'

import { createDecisionsRequest, readDecisions } from './decisions'

const request = createDecisionsRequest('gpt-6-luna', '顧客說：開始點餐，畫面B3。', { action: { type: 'choice', instructions: '選完整動作', criteria: { start: '沿用B3開始', HANDOFF: '需要助手' } } })
const answer = { name: 'action', type: 'choice', choice: 'start', confidence: 0.8, probabilities: [{ value: 'start', probability: 0.9 }, { value: 'HANDOFF', probability: 0.1 }] }

it('uses the native Decisions body and preserves separately supplied confidence', () => {
  expect(request).toMatchObject({ model: 'gpt-6-luna', input: expect.stringContaining('B3'), questions: [{ name: 'action', type: 'choice', choices: [{ value: 'start', description: '沿用B3開始' }, { value: 'HANDOFF', description: '需要助手' }] }] })
  expect(readDecisions({ answers: [answer] }, request)).toEqual({ answers: { action: { type: 'choice', choice: 'start', confidence: 0.8, probabilities: { start: 0.9, HANDOFF: 0.1 } } } })
})

it.each([
  [],
  [answer, answer],
  [{ ...answer, name: 'unknown' }],
  [{ name: 'action', type: 'refusal' }],
  [{ ...answer, confidence: 2 }],
  [{ ...answer, choice: 'invented' }],
  [{ ...answer, probabilities: [{ value: 'start', probability: 1 }] }],
  [{ ...answer, probabilities: [{ value: 'start', probability: 0.5 }, { value: 'start', probability: 0.5 }] }],
].map(answers => ({ answers })))('rejects malformed, refused or uncorrelated decisions: %j', ({ answers }) => {
  expect(() => readDecisions({ answers }, request)).toThrow()
})

it('correlates answers by name when the provider returns them in a different order', () => {
  const batch = createDecisionsRequest('gpt-6-luna', 'state', { first: { type: 'choice', instructions: 'first', criteria: ['A', 'B'] }, second: { type: 'choice', instructions: 'second', criteria: ['A', 'B'] } })
  const probabilities = [{ value: 'A', probability: 0.8 }, { value: 'B', probability: 0.2 }]
  const result = readDecisions({ answers: [{ name: 'second', type: 'choice', choice: 'B', confidence: 0.8, probabilities }, { name: 'first', type: 'choice', choice: 'A', confidence: 0.8, probabilities }] }, batch)
  expect(result.answers?.first).toMatchObject({ choice: 'A' })
  expect(result.answers?.second).toMatchObject({ choice: 'B' })
})

it('refuses unsupported question types before sending them upstream', () => {
  expect(() => createDecisionsRequest('gpt-6-luna', 'state', { check: { type: 'noul', instructions: 'ready?' } })).toThrow('finite choice')
})
