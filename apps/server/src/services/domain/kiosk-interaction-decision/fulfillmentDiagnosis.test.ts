import { describe, expect, it } from 'vitest'

import { decideInteraction } from '.'

function replay(routeChoice: string, routeConfidence: number, relationChoice = 'intent:defer-question', relationConfidence = 0.3911) {
  let routeCalls = 0
  return decideInteraction({
    transcript: '還是內用好了',
    policy: { decisionInstruction: '', storeInstruction: '' },
    includeTrace: true,
    candidates: [
      { id: 'intent:set-fulfillment:dine-in', description: '這筆訂單設為內用，接著詢問用餐人數與選桌。', requiresHighConfidence: true },
      { id: 'intent:start-checkout', description: '開始結帳', requiresHighConfidence: true },
      { id: 'intent:defer-question', description: '暫緩目前問題，沒有其他需求', requiresHighConfidence: true },
    ],
    decisionState: { phase: 'ordering', interactionState: { screen: 'cart_review', matchingCartLines: 0 }, waitingFor: { questionId: 'Q1', purpose: 'checkout-entry', question: '要進入結帳流程嗎？', expiresAt: Date.now() + 30000, choices: [{ id: 'intent:start-checkout', description: '開始結帳' }, { id: 'intent:defer-question', description: '暫緩目前問題，沒有其他需求' }] } },
    invoke: async (_state: string, questions: Record<string, unknown>) => questions.route
      ? { answers: { route: routeCalls++ === 0 ? { choice: routeChoice, confidence: routeConfidence } : { choice: 'intent:set-fulfillment:dine-in', confidence: 0.95 } } }
      : { answers: { relation: { choice: relationChoice, confidence: relationConfidence } } },
  })
}

describe('fulfillment change mistaken for checkout answer diagnosis', () => {
  // Report: local customer attachment 1842461e-a2d1-496e-8991-955d94b29918, no public URL.
  // NOTICE: Recorded provider choices isolate application recovery, not live
  // semantic accuracy. The expected recovery is opt-in red, not a completed fix.
  it.skipIf(process.env.KIOSK_FULFILLMENT_DIAGNOSIS !== '1')('recovers the explicit dine-in change rather than losing it to checkout relation', async () => {
    expect(await replay('intent:start-checkout', 0.4665)).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:set-fulfillment:dine-in' })
  })

  it('reproduces the refusal with no previous dialogue or missing fulfillment candidate', async () => {
    const result = await replay('intent:start-checkout', 0.4665)
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', modelCalls: 2, modelQuestions: 2 })
    expect(result).toHaveProperty('trace.candidateIntents', expect.arrayContaining([expect.objectContaining({ id: 'intent:set-fulfillment:dine-in' })]))
    expect(result).toHaveProperty('trace.rawAnswer', expect.objectContaining({ choice: 'intent:start-checkout', confidence: 0.4665 }))
    expect(result).toHaveProperty('trace.questionRelation', expect.objectContaining({ choice: 'intent:defer-question', confidence: 0.3911 }))
  })

  it('routes the independent dine-in change without interpreting the checkout question when the first choice is correct', async () => {
    expect(await replay('intent:set-fulfillment:dine-in', 0.95)).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:set-fulfillment:dine-in', modelCalls: 1, modelQuestions: 1 })
  })

  it('hands off instead of recovering dine-in even when the relation correctly recognizes a new request', async () => {
    expect(await replay('intent:start-checkout', 0.4665, 'NEW_REQUEST', 0.95)).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', modelCalls: 2, modelQuestions: 2 })
  })
})
