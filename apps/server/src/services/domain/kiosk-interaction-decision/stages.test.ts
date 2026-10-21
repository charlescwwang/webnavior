import { afterEach, describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'
import { createRecommendationInvitation } from './contracts'
import { createDecisionStages } from './stages'

describe('segmented bounded decisions', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps the raw weak handoff checkpoint but finishes unavailable without superseding the invitation', async () => {
    const stages = createDecisionStages()
    const owner = { deviceId: 'weak-handoff', visitorSessionId: 's1' }
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'MULTI_ACTION', confidence: 0.2911 } } }))
    const first = await stages.start(owner, checkpoint => decideInteraction({ transcript: '你這樣跑掉 你要從這邊', candidates: [], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) }, policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true, invoke: checkpoint(invoke) }))
    expect(first).toMatchObject({ kind: 'DECISION_PROGRESS', choice: 'MULTI_ACTION', confidence: 0.2911 })
    if (first.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected a route checkpoint')
    const scope = await stages.next(owner, first.continuationId)
    expect(scope).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'recipient' })
    if (scope.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected recipient checkpoint')
    const result = await stages.next(owner, scope.continuationId)
    expect(result).toMatchObject({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', modelCalls: 2, modelQuestions: 2, trace: { rawAnswer: { choice: 'MULTI_ACTION', confidence: 0.2911 } } })
    if (result.kind === 'DECISION_PROGRESS' || result.kind === 'SERVICE_RECOVERY_PROGRESS')
      throw new Error('Expected scope to finish without granting an action')
    expect(result.supersededQuestionId).toBeUndefined()
    expect(result.answeredQuestionId).toBeUndefined()
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('starts at route and finishes a new order without a question-context checkpoint', async () => {
    const stages = createDecisionStages()
    const owner = { deviceId: 'question-routing', visitorSessionId: 's1' }
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => questions.requestPurpose
      ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 } } }
      : questions.cartRequest
        ? { answers: { requestPurpose: { choice: 'OPERATION', confidence: 0.95 }, cartRequest: { choice: 'SINGLE', confidence: 0.95 } } }
        : { answers: { route: { choice: 'intent:add-item', confidence: 0.95 } } })
    const first = await stages.start(owner, checkpoint => decideInteraction({ transcript: '排骨便當一份', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [{ id: 'intent:add-item', description: '新增炸排骨便當' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) }, includeTrace: true, invoke: checkpoint(invoke) }))
    expect(first).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'route' })
    if (first.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected a checkpoint')
    const purpose = await stages.next(owner, first.continuationId)
    expect(purpose).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'requestPurpose' })
    if (purpose.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected purpose checkpoint')
    const coverage = await stages.next(owner, purpose.continuationId)
    expect(coverage).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'cartRequest' })
    if (coverage.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected purchase-authority checkpoint')
    expect(await stages.next(owner, coverage.continuationId)).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:add-item', supersededQuestionId: 'I1', modelCalls: 3, modelQuestions: 3 })
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  // Report: local attachment eda15e0f-3084-41f3-91e4-d711b23d04e1; no public URL.
  it('resumes a weak invitation route through concrete answer and filter checkpoints', async () => {
    const stages = createDecisionStages()
    const owner = { deviceId: 'concrete-answer', visitorSessionId: 's1' }
    const invoke = vi.fn()
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, route: { choice: 'intent:recommend', confidence: 0.5289 } } })
      .mockResolvedValueOnce({ answers: { relation: { choice: 'intent:recommend', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { recipient: { choice: 'KIOSK', confidence: 0.95 }, service: { choice: 'REQUEST', confidence: 0.95 }, filterRequirement: { choice: 'COVERED', confidence: 0.95 } } })
      .mockResolvedValueOnce({ answers: { filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } })
    let result = await stages.start(owner, checkpoint => decideInteraction({ transcript: '好啊', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [{ id: 'intent:recommend', description: '推薦三項，不新增訂購' }], decisionState: { phase: 'ordering', waitingFor: createRecommendationInvitation('I1', Date.now()) }, includeTrace: true, invoke: checkpoint(invoke) }))
    const questions: string[] = []
    while (result.kind === 'DECISION_PROGRESS') {
      questions.push(result.question)
      result = await stages.next(owner, result.continuationId)
    }
    expect(questions).toEqual(['route', 'relation', 'filterRequirement', 'filterPresence'])
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:recommend', confidence: 0.95, answeredQuestionId: 'I1', modelCalls: 4, modelQuestions: 4 })
  })

  it('expires a suspended request without starting the next forward', async () => {
    vi.useFakeTimers()
    const stages = createDecisionStages()
    const owner = { deviceId: 'expiry', visitorSessionId: 's1' }
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'IGNORE', confidence: 0.95 } } }))
    const first = await stages.start(owner, checkpoint => decideInteraction({ transcript: '走走走', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [], invoke: checkpoint(invoke) }))
    if (first.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected a checkpoint')
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(stages.next(owner, first.continuationId)).rejects.toThrow('unavailable')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('replaces a suspended decision without consuming another session checkpoint', async () => {
    const stages = createDecisionStages()
    const owner = { deviceId: 'replace', visitorSessionId: 's1' }
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'IGNORE', confidence: 0.95 } } }))
    const run = (checkpoint: Parameters<Parameters<typeof stages.start>[1]>[0]) => decideInteraction({ transcript: '走走走', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [], invoke: checkpoint(invoke) })
    const first = await stages.start(owner, run)
    const second = await stages.start(owner, run)
    if (first.kind !== 'DECISION_PROGRESS' || second.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected checkpoints')
    await expect(stages.next({ ...owner, visitorSessionId: 's2' }, second.continuationId)).rejects.toThrow('unavailable')
    await expect(stages.next(owner, first.continuationId)).rejects.toThrow('unavailable')
    expect(await stages.next(owner, second.continuationId)).toMatchObject({ kind: 'IGNORE' })
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('returns the route before evaluating read conditions and refuses replay or another owner', async () => {
    const stages = createDecisionStages()
    const invoke = vi.fn(async (_state: string, questions: Record<string, unknown>) => ({ answers: questions.route
      ? { route: { choice: 'intent:search-menu', confidence: 0.95 } }
      : questions.recipient
        ? { recipient: { choice: 'KIOSK', confidence: 0.95 } }
        : questions.filterRequirement
          ? { filterRequirement: { choice: 'COVERED', confidence: 0.95 } }
          : { filterPresence: { choice: 'NO_FILTER', confidence: 0.95 } } }))
    const owner = { deviceId: 'd1', visitorSessionId: 's1' }
    let result = await stages.start(owner, checkpoint => decideInteraction({ transcript: '有賣什麼', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [{ id: 'intent:search-menu', description: '查菜單' }], decisionState: { phase: 'ordering' }, includeTrace: true, invoke: checkpoint(invoke) }))
    expect(result).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'route', choice: 'intent:search-menu' })
    expect(invoke).toHaveBeenCalledTimes(1)
    if (result.kind !== 'DECISION_PROGRESS')
      throw new Error('Expected a checkpoint')
    const firstId = result.continuationId
    await expect(stages.next({ deviceId: 'd2', visitorSessionId: 's1' }, firstId)).rejects.toThrow('unavailable')
    result = await stages.next(owner, firstId)
    expect(result).toMatchObject({ kind: 'DECISION_PROGRESS', question: 'recipient' })
    await expect(stages.next(owner, firstId)).rejects.toThrow('unavailable')
    while (result.kind === 'DECISION_PROGRESS')
      result = await stages.next(owner, result.continuationId)
    expect(result).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelQuestions: 4 })
  })
  it('does not evaluate food filters for an unrelated utterance', async () => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'IGNORE', confidence: 0.95 } } }))
    const result = await decideInteraction({ transcript: '走走走去那邊', policy: { decisionInstruction: '', storeInstruction: '' }, candidates: [{ id: 'intent:search-menu', description: '查菜單' }], decisionState: { phase: 'ordering', ingredientReferences: [{ id: 'pork', label: '豬肉' }] }, invoke })
    expect(result.kind).toBe('IGNORE')
    expect(invoke.mock.calls[0]).toHaveLength(2)
    expect(invoke).toHaveBeenCalledWith(expect.any(String), { route: expect.any(Object) })
  })
})
