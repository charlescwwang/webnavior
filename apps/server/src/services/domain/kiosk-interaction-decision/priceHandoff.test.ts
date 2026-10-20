import type { SystemOneQuestion } from '../kiosk-system-one'
import type { PriceEvidence } from './priceContracts'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'

const priceEvidence: PriceEvidence = { amounts: [{ text: '120', amount: 120 }], choices: [
  { id: 'UPPER_INCLUSIVE', kind: 'condition', conditions: { maxPrice: 120 }, description: '單份120以下，包含120' },
  { id: 'UPPER_EXCLUSIVE', kind: 'condition', conditions: { maxPrice: 120, maxPriceExclusive: true }, description: '單份不到120，不含120' },
  { id: 'UNSUPPORTED', kind: 'unsupported', description: '無法完整表示的價格要求' },
] }

describe('price-qualified menu handoffs', () => {
  // Report: this chat, visitor session KW8V27ebW…, 2026-10-19.
  it('qualifies a fresh budget without replaying previous budgets or scope answers', async () => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => ({ answers: questions.price
      ? { price: { choice: 'UPPER_INCLUSIVE', confidence: 0.95 } }
      : { route: { choice: 'MENU_QUERY', confidence: 0.95 } } }))
    const transcript = '一百三以下呢？'
    const result = await decideInteraction({ transcript, policy: { decisionInstruction: '', storeInstruction: '' }, invoke, candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }], conversation: { messages: [{ role: 'user', content: '有一百二以下的嗎' }, { role: 'assistant', content: '剛才推薦的：目前沒有符合條件的餐點。' }, { role: 'user', content: '那整份的有嗎？' }, { role: 'assistant', content: '推薦一項：水餃。' }] }, decisionState: { phase: 'ordering', priceEvidence: { amounts: [{ text: '一百三', amount: 130 }], choices: [{ id: 'UPPER_INCLUSIVE', kind: 'condition', conditions: { maxPrice: 130 }, description: '單份130以下，包含130' }] } } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', priceChoiceId: 'UPPER_INCLUSIVE' })
    const priceCall = invoke.mock.calls.find(([, questions]) => questions.price)
    expect(priceCall).toBeDefined()
    expect(JSON.parse(priceCall![0])).toEqual({ customerUtterance: transcript, amounts: [{ text: '一百三', amount: 130 }] })
  })

  // Report: this chat, visitor session wu0beMfO… entries26–30, 2026-10-19.
  it.each([
    { transcript: '一百三以下的呢？', routeConfidence: 0.5906 },
    { transcript: '一百三以下呢？', routeConfidence: 0.5351 },
  ])('recovers a pure inquiry misrouted as weak recommendation continuation: $transcript', async ({ transcript, routeConfidence }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      const answers: Record<string, unknown> = {}
      if (questions.route)
        answers.route = { choice: 'intent:recommend-more', confidence: routeConfidence }
      if (questions.recipient)
        answers.recipient = { choice: 'KIOSK', confidence: 0.9997 }
      if (questions.menuInquiry)
        answers.menuInquiry = { choice: 'QUERY', confidence: 0.95 }
      if (questions.filterRequirement)
        answers.filterRequirement = { choice: 'OPEN_REQUEST', confidence: 0.527 }
      if (questions.price)
        answers.price = { choice: 'UPPER_INCLUSIVE', confidence: 0.95 }
      return { answers }
    })
    const result = await decideInteraction({ transcript, policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true, invoke, candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }, { id: 'intent:recommend-more', description: '沿用120以下條件換批' }], decisionState: { phase: 'ordering', priceEvidence: { amounts: [{ text: '一百三', amount: 130 }], choices: [{ id: 'UPPER_INCLUSIVE', kind: 'condition', conditions: { maxPrice: 130 }, description: '單份130以下，包含130' }] }, constraints: { exclude: [], include: [], unresolvedPrice: true } } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'MENU_QUERY', priceChoiceId: 'UPPER_INCLUSIVE' })
    expect(result).not.toHaveProperty('actionId')
    expect(invoke.mock.calls.filter(([, questions]) => questions.menuInquiry)).toHaveLength(1)
    expect(invoke.mock.calls.filter(([, questions]) => questions.filterRequirement)).toHaveLength(0)
  })

  // Report: this chat, session -_n4bX6MRFcoRGilxK9-_ entries22–23, 2026-10-19.
  it.each([
    { recipient: 'KIOSK', inquiry: 'QUERY', inquiryConfidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { recipient: 'OTHER', inquiry: 'QUERY', inquiryConfidence: 0.95, kind: 'IGNORE' },
    { recipient: 'KIOSK', inquiry: 'OTHER', inquiryConfidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { recipient: 'KIOSK', inquiry: 'UNCERTAIN', inquiryConfidence: 0.95, kind: 'NEEDS_ASSISTANT' },
    { recipient: 'KIOSK', inquiry: 'QUERY', inquiryConfidence: 0.4, kind: 'NEEDS_ASSISTANT' },
  ].flatMap(scenario => ['intent:search-menu', 'intent:recommend', 'intent:recommend-more'].map(route => ({ ...scenario, route }))))('independently verifies weak $route before read-only handoff: $recipient/$inquiry/$inquiryConfidence', async ({ recipient, inquiry, inquiryConfidence, kind, route }) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      const answers: Record<string, unknown> = {}
      if (questions.route)
        answers.route = { choice: route, confidence: 0.597 }
      if (questions.recipient)
        answers.recipient = { choice: recipient, confidence: 0.9992 }
      if (questions.menuInquiry)
        answers.menuInquiry = { choice: inquiry, confidence: inquiryConfidence }
      if (questions.filterRequirement)
        answers.filterRequirement = { choice: 'OPEN_REQUEST', confidence: 0.3999 }
      if (questions.price)
        answers.price = { choice: 'UPPER_INCLUSIVE', confidence: 0.95 }
      return { answers }
    })
    const result = await decideInteraction({ transcript: '120以下有什麼？', policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true, invoke, candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }, { id: 'intent:recommend', description: '推薦餐點' }, { id: 'intent:recommend-more', description: '換批推薦' }], decisionState: { phase: 'ordering', priceEvidence, constraints: { exclude: [], include: [], unresolvedPrice: true } } })
    expect(result.kind).toBe(kind)
    expect(result).not.toHaveProperty('actionId')
    if (kind === 'NEEDS_ASSISTANT' && inquiry === 'QUERY' && inquiryConfidence >= 0.6) {
      expect(result).toMatchObject({ reason: 'MENU_QUERY', priceChoiceId: 'UPPER_INCLUSIVE' })
      expect(invoke.mock.calls.filter(([, questions]) => questions.menuInquiry)).toHaveLength(1)
      expect(invoke.mock.calls.filter(([, questions]) => questions.price)).toHaveLength(1)
    }
    else {
      expect(invoke.mock.calls.filter(([, questions]) => questions.price)).toHaveLength(0)
      expect(result).not.toHaveProperty('priceChoiceId')
      if (kind === 'NEEDS_ASSISTANT')
        expect(result).toHaveProperty('reason', 'UNCERTAIN_OPERATION')
    }
  })

  // Report: this chat, session 7hsfZq4mzTs1YZvCTCdXg entries24–34, 2026-10-19.
  it.each(['direct', 'open-preference', 'uncertain-scope', 'uncertain-covered', 'weak-inquiry'] as const)('carries this turn\'s price interpretation through the %s handoff', async (path) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => {
      const answers: Record<string, unknown> = {}
      if (questions.route)
        answers.route = { choice: ['open-preference', 'uncertain-scope', 'uncertain-covered'].includes(path) ? 'intent:search-menu' : 'MENU_QUERY', confidence: path === 'weak-inquiry' ? 0.4 : 0.95 }
      if (questions.recipient)
        answers.recipient = { choice: 'KIOSK', confidence: 0.95 }
      if (questions.menuInquiry)
        answers.menuInquiry = { choice: 'QUERY', confidence: 0.95 }
      if (questions.filterRequirement)
        answers.filterRequirement = { choice: path === 'uncertain-covered' ? 'COVERED' : 'OPEN_REQUEST', confidence: path === 'uncertain-covered' ? 0.271 : path === 'uncertain-scope' ? 0.4 : 0.95 }
      if (questions.price)
        answers.price = { choice: 'UPPER_INCLUSIVE', confidence: 0.95 }
      return { answers }
    })
    const result = await decideInteraction({ transcript: '120以下有什麼', policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true, invoke, candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }, { id: 'intent:recommend-more', description: '沿用上一批99以下條件換批' }], decisionState: { phase: 'ordering', priceEvidence, constraints: { exclude: [], include: [], unresolvedPrice: true } } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: ['uncertain-scope', 'uncertain-covered'].includes(path) ? 'UNCERTAIN_FILTER' : 'MENU_QUERY', priceChoiceId: 'UPPER_INCLUSIVE' })
    expect(result).not.toHaveProperty('actionId')
    expect(invoke.mock.calls.filter(([, questions]) => questions.price)).toHaveLength(1)
    expect(result).toMatchObject({ trace: { priceAnswer: { choice: 'UPPER_INCLUSIVE' } } })
  })

  it.each([
    { choice: 'UNSUPPORTED', confidence: 0.95 },
    { choice: 'invented', confidence: 0.95 },
    { choice: 'UPPER_INCLUSIVE', confidence: 0.4 },
    { choice: 'UPPER_INCLUSIVE', confidence: Number.NaN },
    { choice: 'UPPER_INCLUSIVE', confidence: 1.1 },
  ])('requires clarification rather than handing an unresolved price to Agent: $choice/$confidence', async (price) => {
    const result = await decideInteraction({ transcript: '120以下有什麼', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [], decisionState: { phase: 'ordering', priceEvidence }, invoke: async () => ({ answers: { route: { choice: 'MENU_QUERY', confidence: 0.95 }, price } }) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_PRICE' })
    expect(result).not.toHaveProperty('actionId')
  })
})
