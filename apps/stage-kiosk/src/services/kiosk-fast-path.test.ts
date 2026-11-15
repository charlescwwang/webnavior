import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'

import { priceEvidence } from '../../../order-menu/src/domain/pricing'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { conversationDecisionStateFrom, createDecisionFeedback, createIncompleteAsrSession, refreshConversationState, runFastPath, shouldShowDecisionRetry } from './kiosk-fast-path'
import { createKioskUtteranceQueue } from './kioskUtteranceQueue'
import { createVoicePresenceGate } from './voicePresence'

const candidateTool: ServiceTool = {
  description: 'Candidates',
  inputSchema: {},
  name: 'kiosk_fast_path_context',
  origin: 'http://localhost:5166',
}
const executeTool: ServiceTool = {
  description: 'Execute semantic intent',
  inputSchema: {},
  name: 'kiosk_fast_path_execute',
  origin: 'http://localhost:5166',
}
const stateTool: ServiceTool = { ...candidateTool, name: 'kiosk_interaction_state' }

it('refreshes the real Menu contract without confusing neutral constraints with Jev constraints', async () => {
  const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'fresh', transcript: '有100元以內不含豬肉的嗎', expectedMenuRevision: 0, readOnly: true, constraints: { maxPrice: 100, excludeIngredients: ['pork'] } })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const state = refreshConversationState(context, { phase: 'ordering', requireMenuRead: true, interactionState: { screen: 'cart_review', matchingCartLines: 1 }, waitingFor: { questionId: 'old', purpose: 'fulfillment', question: '內用？', expiresAt: Date.now() + 1000, choices: [] } })
  expect(state.constraints).toMatchObject({ exclude: ['pork'], include: [], price: { maxPrice: 100 } })
  expect(state.readOnly).toBe(true)
  expect(state.requireMenuRead).toBe(true)
  expect(state.waitingFor).toBeUndefined()
  expect(state.interactionState).toBeUndefined()
  expect(state.context?.taskId).toBe('fresh')
})

describe('kiosk System One fast path', () => {
  // Report: this chat, 2026-10-26; 44 zero-round failures after iframe tools were revoked.
  it('does not hand disconnected menu speech to Main or call a model', async () => {
    const decide = vi.fn()
    const isEnabled = vi.fn(async () => true)
    const result = await runFastPath({ transcript: '我要水餃', isEnabled, decide, webMcp: { availability: 'unavailable', tools: [], execute: vi.fn() } })
    expect(result.kind).toBe('SERVICE_UNAVAILABLE')
    expect(decide).not.toHaveBeenCalled()
    expect(isEnabled).not.toHaveBeenCalled()
  })
  // Report: this chat, 2026-10-21; attachment 66ed3c26 showed an unanswered customer bubble.
  it('does not admit feedback from a recipient alone after a weak menu route', () => {
    const admit = createDecisionFeedback()
    const stage = { kind: 'DECISION_PROGRESS' as const, continuationId: 'test', expiresAt: 1, durationMs: 1 }
    expect(admit({ ...stage, question: 'route', choice: 'intent:search-menu', confidence: 0.5001 })).toBe(false)
    expect(admit({ ...stage, question: 'recipient', choice: 'KIOSK', confidence: 0.9986 })).toBe(false)
    expect(admit({ ...stage, question: 'menuInquiry', choice: 'QUERY', confidence: 0.594 })).toBe(false)
    expect(admit({ ...stage, question: 'serviceRequest', choice: 'BACKGROUND', confidence: 0.2639 })).toBe(false)
  })

  it('admits feedback only when both service meaning and recipient are confirmed', () => {
    const admit = createDecisionFeedback()
    const stage = { kind: 'DECISION_PROGRESS' as const, continuationId: 'test', expiresAt: 1, durationMs: 1 }
    expect(admit({ ...stage, question: 'route', choice: 'intent:search-menu', confidence: 0.95 })).toBe(false)
    expect(admit({ ...stage, question: 'recipient', choice: 'KIOSK', confidence: 0.95 })).toBe(true)
    expect(admit({ ...stage, question: 'filterRequirement', choice: 'COVERED', confidence: 0.95 })).toBe(true)
    const recover = createDecisionFeedback()
    expect(recover({ ...stage, question: 'service', choice: 'REQUEST', confidence: 0.95 })).toBe(false)
    expect(recover({ ...stage, question: 'serviceRequest', choice: 'REQUEST', confidence: 0.95 })).toBe(true)
    expect(recover({ ...stage, question: 'serviceRequest', choice: 'BACKGROUND', confidence: 0.95 })).toBe(false)
    expect(createDecisionFeedback()({ ...stage, question: 'recipient', choice: 'KIOSK', confidence: 0.95 })).toBe(false)
  })

  it('uses the combined staged admission for scored Jev and unscored SLM progress only', () => {
    const stage = { kind: 'DECISION_PROGRESS' as const, continuationId: 'test', expiresAt: 1, durationMs: 1, question: 'admission' }
    expect(createDecisionFeedback()({ ...stage, choice: 'SERVICE', confidence: 0.95 })).toBe(true)
    expect(createDecisionFeedback()({ ...stage, choice: 'SERVICE', selectionMode: 'unscored' })).toBe(true)
    expect(createDecisionFeedback()({ ...stage, choice: 'SERVICE' })).toBe(false)
    expect(createDecisionFeedback()({ ...stage, choice: 'BACKGROUND', selectionMode: 'unscored' })).toBe(false)
    expect(createDecisionFeedback()({ ...stage, choice: 'UNCERTAIN', selectionMode: 'unscored' })).toBe(false)
  })

  it.each(['IGNORE', 'INCOMPLETE', 'GREET'])('does not mistake a confident %s for a service request', (choice) => {
    const admit = createDecisionFeedback()
    const stage = { kind: 'DECISION_PROGRESS' as const, continuationId: 'test', expiresAt: 1, durationMs: 1 }
    expect(admit({ ...stage, question: 'route', choice, confidence: 0.95 })).toBe(false)
    expect(admit({ ...stage, question: 'recipient', choice: 'KIOSK', confidence: 0.95 })).toBe(false)
  })

  it.each([Number.NaN, 1.1, -0.1, 0.59, undefined])('rejects invalid or weak relevance confidence %s', (confidence) => {
    expect(createDecisionFeedback()({ kind: 'DECISION_PROGRESS', continuationId: 'test', expiresAt: 1, durationMs: 1, question: 'serviceRequest', choice: 'REQUEST', confidence })).toBe(false)
  })

  // Report: this chat, 2026-10-21: a weak greeting IGNORE produced a retry prompt for 「哈哈哈 好啊好啊」.
  it('keeps social uncertainty and unfinished speech silent while preserving real decision errors', () => {
    expect(shouldShowDecisionRetry({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_GREETING' })).toBe(false)
    expect(shouldShowDecisionRetry({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_RECIPIENT' })).toBe(false)
    expect(shouldShowDecisionRetry({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_SERVICE_REQUEST' })).toBe(false)
    expect(shouldShowDecisionRetry({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' })).toBe(false)
    expect(shouldShowDecisionRetry({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_REVIEW' })).toBe(false)
    expect(shouldShowDecisionRetry({ kind: 'IGNORE' })).toBe(false)
    expect(shouldShowDecisionRetry({ kind: 'INCOMPLETE' })).toBe(false)
    expect(shouldShowDecisionRetry({ kind: 'UNAVAILABLE', reason: 'INVALID_CHOICE' })).toBe(true)
    expect(shouldShowDecisionRetry({ kind: 'UNAVAILABLE', reason: 'PROVIDER_FAILURE' })).toBe(true)
  })

  // Report: this chat, 2026-10-20; a visitor can leave while Jev is deciding.
  it('rejects a late voice action after local presence expires before execution', async () => {
    const gate = createVoicePresenceGate()
    gate.observe(0, { centre: { x: 0.5, y: 0.5 }, poseQuality: 1, bodyScale: 0.2, attention: 'unknown' }, { x: 0, y: 0, width: 1, height: 1 })
    let now = 100
    const execute = vi.fn(async () => ({ phase: 'ordering', candidates: [{ id: 'intent:add-item', description: '新增餐點' }] }))
    const result = await runFastPath({ transcript: '一份水餃', isEnabled: async () => true, isCurrent: () => gate.allows({ enabled: true, observing: true, nowMs: now }), decide: async () => {
      now = 1601
      return { kind: 'FAST_ACTION', actionId: 'intent:add-item' }
    }, webMcp: { tools: [candidateTool, executeTool], execute } })
    expect(result.kind).toBe('DEFERRED')
    expect(execute.mock.calls).toHaveLength(1)
  })

  it('retains an accepted receipt when presence expires during an issued mutation', async () => {
    const gate = createVoicePresenceGate()
    gate.observe(0, { centre: { x: 0.5, y: 0.5 }, poseQuality: 1, bodyScale: 0.2, attention: 'unknown' }, { x: 0, y: 0, width: 1, height: 1 })
    let now = 100
    const onExecuted = vi.fn()
    const execute = vi.fn(async (tool: ServiceTool) => {
      if (tool.name === candidateTool.name)
        return { phase: 'ordering', candidates: [{ id: 'intent:add-item', description: '新增餐點' }] }
      now = 1601
      return { customerMessage: '已加入水餃一份。' }
    })
    const result = await runFastPath({ transcript: '一份水餃', isEnabled: async () => true, isCurrent: () => gate.allows({ enabled: true, observing: true, nowMs: now }), onExecuted, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:add-item' }), webMcp: { tools: [candidateTool, executeTool], execute } })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', result: { customerMessage: '已加入水餃一份。' } })
    expect(onExecuted).toHaveBeenCalledOnce()
    expect(execute.mock.calls).toHaveLength(2)
  })

  // Report: this chat, Oct 8 — admin disables Fast Path but voice ordering stops.
  it('bypasses even application-resolved actions when disabled, preserving the pending question', async () => {
    const waitingFor = { questionId: 'party', purpose: 'party-size', question: '請問幾位？', expiresAt: Date.now() + 30_000, choices: [{ id: 'one', description: '一位' }] }
    const decide = vi.fn()
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === stateTool.name
      ? { phase: 'ordering', waitingFor, interactionState: { screen: 'cart_review', matchingCartLines: 1 } }
      : { phase: 'ordering', resolvedCandidateId: 'one', candidates: waitingFor.choices })
    const session = createIncompleteAsrSession()
    session.retain('我要一份', { phase: 'ordering' })
    const fragment = session.snapshot()
    const result = await runFastPath({ isEnabled: async () => false, decide, session, transcript: '一位', webMcp: { tools: [candidateTool, executeTool, stateTool], execute } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'SYSTEM_ONE_DISABLED', decisionState: { waitingFor } })
    expect(conversationDecisionStateFrom(result.decisionState)).toMatchObject({ waitingFor, interactionState: { screen: 'cart_review' } })
    expect(execute).toHaveBeenCalledExactlyOnceWith(stateTool, {})
    expect(decide).not.toHaveBeenCalled()
    expect(session.snapshot()).toEqual(fragment)
  })

  it.each([true, false])('retains scope touch choices when semantic service is unavailable (enabled=%s)', async (enabled) => {
    const waitingFor = { questionId: 'scope-1', purpose: 'menu-query-scope', question: '請選擇查詢範圍', expiresAt: Date.now() + 30_000, choices: [{ id: 'SHOWN', description: '剛才推薦的' }, { id: 'CATALOG', description: '整份菜單' }] }
    const execute = vi.fn(async (_tool: ServiceTool) => ({ phase: 'query_scope', candidates: [], waitingFor }))
    const result = await runFastPath({ isEnabled: async () => enabled, decide: async () => {
      throw new Error('provider unavailable')
    }, transcript: '好', webMcp: { tools: [candidateTool, executeTool, stateTool], execute } })
    expect(result).toMatchObject({ kind: 'CLARIFICATION', question: waitingFor })
    expect(execute.mock.calls.every(([tool]) => tool.name !== executeTool.name)).toBe(true)
  })

  it('checks activation again on each turn so re-enabling restores Fast Path without reloading', async () => {
    const isEnabled = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const decide = vi.fn(async () => ({ kind: 'FAST_ACTION' as const, actionId: 'intent:add-item' }))
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { phase: 'ordering', candidates: [{ id: 'intent:add-item', description: '新增水餃' }] }
      : { customerMessage: '已加入水餃' })
    const input = { isEnabled, decide, transcript: '水餃一份', webMcp: { execute, tools: [candidateTool, executeTool] } }
    expect(await runFastPath(input)).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'SYSTEM_ONE_DISABLED' })
    expect(execute).not.toHaveBeenCalled()
    expect(await runFastPath(input)).toMatchObject({ kind: 'FAST_ACTION' })
    expect(isEnabled).toHaveBeenCalledTimes(2)
    expect(decide).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it.each(['returned', 'thrown', 'status'] as const)('hands off %s provider failures without executing or deleting context', async (failure) => {
    const waitingFor = { questionId: 'quantity', purpose: 'quantity', question: '幾份？', expiresAt: Date.now() + 30_000, choices: [] }
    const execute = vi.fn(async (_tool: ServiceTool) => ({ phase: 'configuration', waitingFor, candidates: [{ id: 'intent:set-quantity', description: '設定數量' }] }))
    const decide = vi.fn(async () => {
      if (failure === 'thrown')
        throw new Error('HTTP 504')
      return { kind: 'UNAVAILABLE' as const, reason: 'PROVIDER_FAILURE' as const }
    })
    const session = createIncompleteAsrSession()
    session.retain('我要一', { phase: 'configuration' })
    const fragment = session.snapshot()
    const result = await runFastPath({ isEnabled: async () => {
      if (failure === 'status')
        throw new Error('Network timeout')
      return true
    }, decide, session, transcript: '兩份', webMcp: { tools: [candidateTool, executeTool, stateTool], execute } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'PROVIDER_FAILURE', decisionState: { waitingFor } })
    expect(execute.mock.calls.every(([tool]) => tool.name !== executeTool.name)).toBe(true)
    expect(session.snapshot()).toEqual(fragment)
  })

  it('does not hand an obsolete ticket to the assistant after a status lookup', async () => {
    let current = true
    const execute = vi.fn()
    const decide = vi.fn()
    const result = await runFastPath({ isEnabled: async () => {
      current = false
      return false
    }, isCurrent: () => current, decide, transcript: '水餃一份', webMcp: { execute, tools: [candidateTool, executeTool, stateTool] } })
    expect(result.kind).toBe('DEFERRED')
    expect(execute).not.toHaveBeenCalled()
    expect(decide).not.toHaveBeenCalled()
  })

  it('keeps semantic uncertainty blocked instead of treating it as a provider fault', async () => {
    const execute = vi.fn(async () => ({ phase: 'ordering', candidates: [{ id: 'intent:add-item', description: '新增餐點' }] }))
    const result = await runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION' }), transcript: '那份吧', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(result).toMatchObject({ kind: 'UNAVAILABLE' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('hands off a failed Jev read review with its accepted receipt instead of repeating the lookup', async () => {
    const continuation = { answer: '有水餃。', observation: '已查詢', candidates: [{ id: 'read:recommend', description: '推薦' }] }
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { phase: 'ordering', menuRevision: 1, candidates: [{ id: 'intent:search-menu', description: '查詢' }] }
      : { customerMessage: '有水餃。', continuation, decisionTrace: { operationPlan: { toolName: 'menu_get' } } })
    const decide = vi.fn().mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelQuestions: 1 }).mockRejectedValueOnce(new Error('Jev timeout'))
    const result = await runFastPath({ isEnabled: async () => true, decide, transcript: '有水餃嗎，也推薦一下', webMcp: { tools: [candidateTool, executeTool, { ...executeTool, name: 'kiosk_fast_path_continue' }], execute } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'PROVIDER_FAILURE', decisionState: { completedReads: [{ toolName: 'menu_get', customerMessage: '有水餃。' }] } })
    expect(conversationDecisionStateFrom(result.decisionState)?.completedReads).toEqual([{ toolName: 'menu_get', customerMessage: '有水餃。' }])
    expect(execute).toHaveBeenCalledTimes(2)
    expect(decide).toHaveBeenCalledTimes(2)
  })

  it('never retries or hands off an unknown mutation result as permission to replay it', async () => {
    const execute = vi.fn(async (tool: ServiceTool) => {
      if (tool.name === executeTool.name)
        throw new Error('Result lost after submission')
      return { phase: 'ordering', candidates: [{ id: 'intent:start-checkout', description: '開始結帳' }] }
    })
    const result = await runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:start-checkout' }), transcript: '結帳', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(result).toMatchObject({ kind: 'EXECUTION_FAILED', uncertain: true })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('submits later queued ASR results to decision after an earlier decision request rejects with HTTP 500', async () => {
    const decide = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue({ kind: 'IGNORE' })
    const execute = vi.fn(async () => ({ phase: 'ordering', candidates: [{ id: 'intent:search-menu', description: '查詢菜單' }] }))
    const results: string[] = []
    const queue = createKioskUtteranceQueue({ process: async (utterance, ticket) => {
      const result = await runFastPath({ isEnabled: async () => true, decide, isCurrent: ticket.isCurrent, transcript: utterance.text, webMcp: { execute, tools: [candidateTool, executeTool] } })
      results.push(result.kind)
    } })
    queue.submit({ source: 'asr', text: '第一句' })
    queue.submit({ source: 'asr', text: '有水餃嗎' })
    await queue.idle()
    expect(results).toEqual(['NEEDS_ASSISTANT', 'IGNORE'])
    expect(decide).toHaveBeenCalledTimes(2)
    expect(decide).toHaveBeenNthCalledWith(2, expect.objectContaining({ transcript: '有水餃嗎' }))
    queue.submit({ source: 'asr', text: '有便當嗎' })
    await queue.idle()
    expect(decide).toHaveBeenCalledTimes(3)
    expect(decide).toHaveBeenNthCalledWith(3, expect.objectContaining({ transcript: '有便當嗎' }))
    expect(execute).toHaveBeenCalledTimes(3)
  })
  it('forwards issued price choice IDs and retains verified conditions in handoff receipts', async () => {
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { phase: 'ordering', priceEvidence: priceEvidence('100元以下'), constraints: { exclude: [], unresolvedPrice: true }, candidates: [{ id: 'intent:search-menu', description: '查詢' }] }
      : { customerMessage: '推薦便當', appliedPriceConditions: { maxPrice: 100 }, appliedFilters: { includeIngredients: [], excludeIngredients: [] }, decisionTrace: { operationPlan: { toolName: 'menu_recommend' } } })
    const result = await runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', priceChoiceId: 'UPPER_INCLUSIVE' }), transcript: '100元以下', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(execute).toHaveBeenLastCalledWith(executeTool, { candidateId: 'intent:search-menu', priceChoiceId: 'UPPER_INCLUSIVE' })
    expect(result).toMatchObject({ kind: 'FAST_ACTION', decisionState: { constraints: { price: { maxPrice: 100 }, unresolvedPrice: false } } })
    expect(conversationDecisionStateFrom(result.decisionState)).toMatchObject({ constraints: { price: { maxPrice: 100 } }, priceEvidence: { amounts: [{ amount: 100 }] } })
  })
  it('clarifies unsupported price needs without executing or clearing the order question', async () => {
    const execute = vi.fn(async () => ({ phase: 'ordering', priceEvidence: priceEvidence('100元左右'), candidates: [{ id: 'intent:recommend', description: '推薦' }], waitingFor: { questionId: 'q', purpose: 'party-size', question: '幾位？', expiresAt: Date.now() + 30000, choices: [] } }))
    const result = await runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'NEEDS_ASSISTANT', reason: 'UNSUPPORTED_PRICE', priceChoiceId: 'UNSUPPORTED' }), transcript: '100元左右', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(result).toMatchObject({ kind: 'CLARIFICATION', prompt: expect.stringContaining('單份'), decisionState: { waitingFor: { questionId: 'q' }, constraints: { unresolvedPrice: true } } })
    expect(execute).toHaveBeenCalledOnce()
  })
  it('hands off a rejected understanding without replaying the accepted read or imposing its filters', async () => {
    const continueTool = { ...executeTool, name: 'kiosk_fast_path_continue' }
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { phase: 'ordering', candidates: [{ id: 'intent:search-menu', description: '查詢' }] }
      : { customerMessage: '含蝦便當', appliedFilters: { includeIngredients: ['shrimp'], excludeIngredients: [] }, decisionTrace: { operationPlan: { toolName: 'menu_get' } }, continuation: { answer: '含蝦便當', observation: '已查詢', candidates: [] } })
    const decide = vi.fn().mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelQuestions: 1 }).mockResolvedValueOnce({ kind: 'NEEDS_ASSISTANT', reason: 'DEVIATED' })
    const result = await runFastPath({ isEnabled: async () => true, decide, transcript: '有蝦捲嗎', webMcp: { execute, tools: [candidateTool, executeTool, continueTool] } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', decisionState: { completedReads: [{ customerMessage: '含蝦便當' }] } })
    expect(result.decisionState?.constraints).toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(decide).toHaveBeenCalledTimes(2)
  })
  it('keeps an accepted receipt when its history observer fails without retrying the operation', async () => {
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name ? { phase: 'ordering', candidates: [{ id: 'intent:add-item', description: '加入餐點' }] } : { customerMessage: '已加入兩份蝦捲' })
    const onExecuted = vi.fn(async () => {
      throw new Error('History unavailable')
    })
    expect(await runFastPath({ isEnabled: async () => true, transcript: '我要兩份蝦捲', decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:add-item' }), webMcp: { execute, tools: [candidateTool, executeTool] }, onExecuted })).toMatchObject({ kind: 'FAST_ACTION', result: { customerMessage: '已加入兩份蝦捲' } })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(onExecuted).toHaveBeenCalledOnce()
  })
  it('keeps background speech from consuming a clarification answer', async () => {
    const execute = vi.fn(async () => ({ phase: 'clarification', candidates: [{ id: 'clarify:c1:0', description: '第一筆' }, { id: 'clarify:c1:cancel', description: '取消' }] }))
    expect(await runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'IGNORE' }), transcript: '走走走', webMcp: { execute, tools: [candidateTool, executeTool] } })).toMatchObject({ kind: 'IGNORE' })
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('re-resolves related fragments separately and rejects continuation after a state change', async () => {
    const session = createIncompleteAsrSession(() => 1000)
    const state = { phase: 'ordering', revisions: { cart: 0, checkout: 0, selectedItem: 0 } }
    session.retain('我要兩份', state)
    const execute = vi.fn(async () => ({ ...state, candidates: [{ id: 'intent:add-item', description: '加入蝦捲' }] }))
    const decide = vi.fn().mockResolvedValueOnce({ kind: 'CONTINUE_INCOMPLETE', modelQuestions: 1 }).mockResolvedValueOnce({ kind: 'IGNORE', modelQuestions: 1 })
    await runFastPath({ isEnabled: async () => true, decide, session, transcript: '蝦捲', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(execute).toHaveBeenNthCalledWith(2, candidateTool, { transcript: '蝦捲', previousTranscript: '我要兩份' })
    expect(decide).toHaveBeenLastCalledWith(expect.objectContaining({ transcript: '蝦捲', decisionState: expect.objectContaining({ incompleteSpeech: expect.objectContaining({ related: true }) }) }))
    expect(session.snapshot()).toBeUndefined()
  })
  it('does not report a rejected browser operation as completed', async () => {
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { phase: 'ordering', candidates: [{ id: 'intent:start-checkout', description: '進入結帳' }] }
      : { ok: false, error: 'Checkout rejected' })
    const onExecuted = vi.fn()
    const result = await runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:start-checkout' }), onExecuted, transcript: '我要結帳', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(result).toMatchObject({ kind: 'EXECUTION_FAILED', uncertain: false })
    expect(onExecuted).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  // Report: this chat; an explicit lost/partial receipt is not a confirmed refusal.
  it.each([{ status: 'unknown' }, { effect: 'unknown' }, { effect: 'partial' }, { partial: true }])('keeps an unsettled native result uncertain: %j', async (receipt) => {
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { phase: 'ordering', candidates: [{ id: 'intent:add-item', description: '加入已指定的餐點' }] }
      : { ok: false, ...receipt, customerMessage: '操作結果仍待核對。' })
    const onExecuted = vi.fn()
    const result = await runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'FAST_ACTION', actionId: 'intent:add-item' }), onExecuted, transcript: '雞腿飯兩份', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(result).toMatchObject({ kind: 'EXECUTION_FAILED', uncertain: true })
    expect(onExecuted).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(2)
  })
  it('reroutes a new request once without cancelling an unfinished meal merely to query', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ phase: 'configuration', waitingFor: { questionId: 'q1', purpose: 'item-configuration', question: '辣度？', expiresAt: Date.now() + 30_000, choices: [] }, candidates: [{ id: 'configure:q1:cancel', description: '取消這筆需求' }] })
      .mockResolvedValueOnce({ phase: 'ordering', candidates: [{ id: 'intent:search-menu', description: '查詢便當' }] })
      .mockResolvedValueOnce({ customerMessage: '我找到便當。' })
    const decide = vi.fn()
      .mockResolvedValueOnce({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', modelQuestions: 2 })
      .mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelQuestions: 1 })
    expect(await runFastPath({ isEnabled: async () => true, decide, transcript: '有便當嗎', webMcp: { execute, tools: [candidateTool, executeTool] } })).toMatchObject({ kind: 'FAST_ACTION', decisionState: { phase: 'ordering' } })
    expect(execute).toHaveBeenNthCalledWith(2, candidateTool, { transcript: '有便當嗎', newRequestQuestionId: 'q1' })
    expect(execute).toHaveBeenNthCalledWith(3, executeTool, { candidateId: 'intent:search-menu' })
    expect(decide.mock.calls[1]?.[0].maxQuestions).toBe(22)
  })
  it('passes the visible cart screen to Jev and preserves it for Agent handoff', async () => {
    const execute = vi.fn(async () => ({ phase: 'ordering', interactionState: { matchingCartLines: 0, screen: 'cart_review' }, candidates: [] }))
    const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const }))
    const result = await runFastPath({ isEnabled: async () => true, decide, transcript: '我還要點菜', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ interactionState: { matchingCartLines: 0, screen: 'cart_review' } }) }))
    expect(conversationDecisionStateFrom(result.decisionState)).toMatchObject({ interactionState: { screen: 'cart_review' } })
  })
  it.each([
    { transcript: '先等一下，你們幾點關門？', reason: 'GENERAL_QUESTION', requireMenuRead: false },
    { transcript: '先幫我看看飲料', reason: 'MENU_QUERY', requireMenuRead: true },
  ] as const)('preserves a topic change into $reason without executing an old or guessed action', async ({ transcript, reason, requireMenuRead }) => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ phase: 'configuration', candidates: [], waitingFor: { questionId: 'q1', purpose: 'item-configuration', question: '水餃要幾份？', expiresAt: Date.now() + 30000, choices: [] } })
      .mockResolvedValueOnce({ phase: 'ordering', candidates: [], catalogEvidence: { products: [], categories: [] } })
    const decide = vi.fn()
      .mockResolvedValueOnce({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', modelQuestions: 2 })
      .mockResolvedValueOnce({ kind: 'NEEDS_ASSISTANT', reason, modelQuestions: 1 })
    const result = await runFastPath({ isEnabled: async () => true, decide, transcript, webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason, decisionState: { phase: 'ordering' } })
    expect(conversationDecisionStateFrom(result.decisionState, result)?.requireMenuRead === true).toBe(requireMenuRead)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenLastCalledWith(candidateTool, { transcript, newRequestQuestionId: 'q1' })
    expect(decide.mock.calls[1]?.[0]).toMatchObject({ transcript, maxQuestions: 22 })
  })
  it('returns greeting without invoking an ordering tool or consuming a pending question', async () => {
    const execute = vi.fn(async () => ({ phase: 'ordering', candidates: [], waitingFor: { questionId: 'q1', question: '要結帳嗎？', purpose: 'checkout-entry', choices: [], expiresAt: Date.now() + 30_000 } }))
    const decide = vi.fn(async () => ({ kind: 'GREET' as const, confidence: 0.95 }))
    const result = await runFastPath({ isEnabled: async () => true, decide, transcript: '你好', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(result.kind).toBe('GREET')
    expect(result.decisionState?.waitingFor?.questionId).toBe('q1')
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('revokes the exact pending confirmation before handing off a new request', async () => {
    const stateTool = { ...candidateTool, name: 'kiosk_interaction_state' }
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { phase: 'pending_confirmation', candidates: [{ id: 'intent:confirm:c1', description: '確認清空' }, { id: 'intent:cancel-confirmation:c1', description: '取消清空' }] }
      : tool.name === stateTool.name ? { phase: 'ordering' } : { customerMessage: '取消了' })
    const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const, reason: 'NEW_REQUEST' as const }))
    expect(await runFastPath({ isEnabled: async () => true, decide, transcript: '不要清空，幫我加水餃', webMcp: { execute, tools: [candidateTool, executeTool, stateTool] } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', decisionState: { phase: 'ordering' } })
    expect(execute).toHaveBeenNthCalledWith(2, executeTool, { candidateId: 'intent:cancel-confirmation:c1' })
    expect(execute).toHaveBeenCalledTimes(3)
  })
  it('hands off verified constraints and the completed read, not only the original transcript', async () => {
    const continueTool = { ...executeTool, name: 'kiosk_fast_path_continue' }
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { phase: 'ordering', menuRevision: 7, candidates: [{ id: 'intent:search-menu', description: '查詢' }] }
      : { customerMessage: '找到雞肉便當。', appliedFilters: { excludeIngredients: ['pork'], includeIngredients: [] }, decisionTrace: { operationPlan: { toolName: 'menu_get' } }, continuation: { answer: '找到雞肉便當。', observation: '已查詢', candidates: [{ id: 'read:recommend', description: '補充推薦' }] } })
    const decide = vi.fn().mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelQuestions: 1 }).mockResolvedValueOnce({ kind: 'NEEDS_ASSISTANT' })
    const result = await runFastPath({ isEnabled: async () => true, decide, transcript: '找不要豬肉的，並比較價格', webMcp: { execute, tools: [candidateTool, executeTool, continueTool] } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', decisionState: { menuRevision: 7, constraints: { exclude: ['pork'] }, completedReads: [{ toolName: 'menu_get', customerMessage: '找到雞肉便當。' }] } })
    expect(conversationDecisionStateFrom(result.decisionState)).toMatchObject({ constraints: { exclude: ['pork'] }, completedReads: [{ toolName: 'menu_get' }] })
  })
  it('preserves unavailable condition references when handing the complete request to Agent', async () => {
    const execute = vi.fn(async () => ({ phase: 'ordering', unavailableConditionReferences: [{ id: 'sodium', label: '鈉含量（沒有營養數據）' }], candidates: [{ id: 'intent:search-menu', description: '查成分' }] }))
    const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const }))
    const result = await runFastPath({ isEnabled: async () => true, decide, transcript: '低鈉又不要豬肉', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ unavailableConditionReferences: [{ id: 'sodium', label: '鈉含量（沒有營養數據）' }] }) }))
    expect(result.kind).toBe('NEEDS_ASSISTANT')
    expect(conversationDecisionStateFrom(result.decisionState)).toMatchObject({ unavailableConditionReferences: [{ id: 'sodium' }] })
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('classifies an information request during payment lock without offering any mutation', async () => {
    const execute = vi.fn(async () => ({ phase: 'payment_locked', paymentState: 'pending', candidates: [] }))
    const decide = vi.fn(async () => ({ kind: 'NEEDS_ASSISTANT' as const }))
    expect(await runFastPath({ isEnabled: async () => true, decide, transcript: '信用卡多久會完成', webMcp: { execute, tools: [candidateTool, executeTool] } })).toMatchObject({ kind: 'NEEDS_ASSISTANT', decisionState: { phase: 'payment_locked' } })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ candidates: [], decisionState: expect.objectContaining({ paymentState: 'pending' }) }))
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('uses the same normalized utterance for application references and Jev without losing the original trace', async () => {
    const execute = vi.fn(async () => ({ phase: 'ordering', candidates: [{ id: 'intent:search-menu', description: '查菜單' }] }))
    const decide = vi.fn(async () => ({ kind: 'IGNORE' as const }))
    const onTrace = vi.fn()
    await runFastPath({ isEnabled: async () => true, decide, onTrace, transcript: ' \u0000三杯雞\n這個\u200B ', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(execute).toHaveBeenCalledWith(candidateTool, { transcript: '三杯雞 這個' })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ transcript: '三杯雞 這個' }))
    expect(onTrace).toHaveBeenCalledWith(expect.objectContaining({ rawTranscript: ' \u0000三杯雞\n這個\u200B ', transcript: '三杯雞 這個' }))
  })
  it('keeps a completed read when the initial decision has exhausted its question budget', async () => {
    const continueTool = { ...executeTool, name: 'kiosk_fast_path_continue' }
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name ? { candidates: [{ id: 'intent:search-menu', description: '查菜單' }] } : { customerMessage: '有水餃。', continuation: { candidates: [{ id: 'read:recommend', description: '補充推薦' }], answer: '有水餃。', observation: '成功' } })
    const decide = vi.fn(async () => ({ kind: 'FAST_ACTION' as const, actionId: 'intent:search-menu', modelQuestions: 24 }))
    expect(await runFastPath({ isEnabled: async () => true, decide, transcript: '有賣什麼', webMcp: { execute, tools: [candidateTool, executeTool, continueTool] } })).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    expect(decide).toHaveBeenCalledTimes(1)
  })
  it('passes finite ingredient choices to Jev and forwards only its verified filters to the browser', async () => {
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name ? { phase: 'ordering', ingredientReferences: [{ id: 'pork', label: '豬肉' }], candidates: [{ id: 'intent:search-menu', description: '搜尋' }] } : { customerMessage: '找到雞肉便當。' })
    const decide = vi.fn(async () => ({ kind: 'FAST_ACTION' as const, actionId: 'intent:search-menu', ingredientFilters: { excludeIngredients: ['pork'], includeIngredients: [] } }))
    await runFastPath({ isEnabled: async () => true, decide, transcript: '不要豬肉', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ ingredientReferences: [{ id: 'pork', label: '豬肉' }] }) }))
    expect(execute).toHaveBeenLastCalledWith(executeTool, { candidateId: 'intent:search-menu', ingredientFilters: { excludeIngredients: ['pork'], includeIngredients: [] } })
  })
  it('preserves current dine-in person count and table question for Agent escalation', () => {
    expect(conversationDecisionStateFrom({ phase: 'ordering', interactionState: { matchingCartLines: 0, seating: { partySize: 5, ready: false, question: '是否同意分桌？', tableHoldId: 'must-not-leak' } } })).toEqual({ phase: 'ordering', interactionState: { matchingCartLines: 0, seating: { partySize: 5, ready: false, question: '是否同意分桌？' } } })
  })
  it('lets System One finish a completed lookup without an extra tool or loop', async () => {
    const continueTool = { ...executeTool, name: 'kiosk_fast_path_continue' }
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { candidates: [{ id: 'intent:search-menu', description: '瀏覽菜單' }], phase: 'ordering' }
      : { customerMessage: '有水餃、牛肉麵。', continuation: { answer: '有水餃、牛肉麵。', observation: '菜單查詢成功', candidates: [{ id: 'read:recommend', description: '補充推薦' }] } })
    const decide = vi.fn().mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelQuestions: 1 }).mockResolvedValueOnce({ kind: 'COMPLETE' })
    const onExecuted = vi.fn(async () => {})
    const result = await runFastPath({ isEnabled: async () => true, decide, onExecuted, transcript: '有賣什麼', webMcp: { execute, tools: [candidateTool, executeTool, continueTool] } })
    expect(result.kind).toBe('FAST_ACTION')
    expect(decide).toHaveBeenCalledTimes(2)
    expect(decide).toHaveBeenLastCalledWith(expect.objectContaining({ review: { answer: '有水餃、牛肉麵。', observation: JSON.stringify({ actualResult: '菜單查詢成功', understanding: { intent: 'intent:search-menu' } }) } }))
    expect(execute).toHaveBeenCalledTimes(2)
    expect(onExecuted).toHaveBeenCalledOnce()
  })

  it('keeps the successful first answer if an optional read fails', async () => {
    const continueTool = { ...executeTool, name: 'kiosk_fast_path_continue' }
    const first = { customerMessage: '有水餃。', continuation: { answer: '有水餃。', observation: '查詢成功', candidates: [{ id: 'read:recommend', description: '推薦' }] } }
    const execute = vi.fn(async (tool: ServiceTool) => {
      if (tool.name === candidateTool.name)
        return { candidates: [{ id: 'intent:search-menu', description: '菜單' }] }
      if (tool.name === continueTool.name)
        throw new Error('Stale read')
      return first
    })
    const decide = vi.fn().mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelQuestions: 1 }).mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'read:recommend' })
    const result = await runFastPath({ isEnabled: async () => true, decide, transcript: '有賣什麼，推薦一下', webMcp: { execute, tools: [candidateTool, executeTool, continueTool] } })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('executes only one offered read continuation even if its result offers another', async () => {
    const continueTool = { ...executeTool, name: 'kiosk_fast_path_continue' }
    const continuation = { answer: '有水餃。', observation: '查詢成功', candidates: [{ id: 'read:recommend', description: '推薦' }] }
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name ? { candidates: [{ id: 'intent:search-menu', description: '菜單' }] } : { customerMessage: '有水餃。', continuation })
    const decide = vi.fn().mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'intent:search-menu', modelQuestions: 1 }).mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: 'read:recommend', modelQuestions: 1 }).mockResolvedValueOnce({ kind: 'COMPLETE', modelQuestions: 1 })
    const onExecuted = vi.fn(async () => {})
    await runFastPath({ isEnabled: async () => true, decide, onExecuted, transcript: '有賣什麼，推薦一下', webMcp: { execute, tools: [candidateTool, executeTool, continueTool] } })
    expect(execute).toHaveBeenLastCalledWith(continueTool, { candidateId: 'read:recommend' })
    expect(execute).toHaveBeenCalledTimes(3)
    expect(decide).toHaveBeenCalledTimes(3)
    expect(decide).toHaveBeenLastCalledWith(expect.objectContaining({ candidates: [], review: expect.any(Object) }))
    expect(onExecuted).toHaveBeenCalledTimes(2)
  })
  it('executes only the browser-produced candidate selected by Dasein', async () => {
    const execute = vi.fn(async (tool: ServiceTool) => tool.name === candidateTool.name
      ? { candidates: [{ description: 'Add shrimp roll.', id: 'intent:add:shrimp' }] }
      : { customerMessage: '已加入蝦捲。' })
    const decide = vi.fn(async () => ({ actionId: 'intent:add:shrimp' as const, confidence: 0.93, kind: 'FAST_ACTION' as const }))

    const onActionSelected = vi.fn()
    await expect(runFastPath({ isEnabled: async () => true, decide, onActionSelected, transcript: '我要蝦捲', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toEqual({
      action: { description: 'Add shrimp roll.', id: 'intent:add:shrimp' },
      kind: 'FAST_ACTION',
      result: { customerMessage: '已加入蝦捲。' },
    })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [{ description: 'Add shrimp roll.', id: 'intent:add:shrimp' }],
      transcript: '我要蝦捲',
    }))
    expect(execute).toHaveBeenNthCalledWith(1, candidateTool, { transcript: '我要蝦捲' })
    expect(onActionSelected).toHaveBeenCalledWith({ description: 'Add shrimp roll.', id: 'intent:add:shrimp' })
    expect(execute).toHaveBeenNthCalledWith(2, executeTool, { candidateId: 'intent:add:shrimp' })
  })

  it('does not execute a tool when System One asks for the explicit assistant route', async () => {
    const execute = vi.fn(async () => ({ candidates: [{ description: 'Add shrimp roll.', id: 'intent:add:shrimp' }] }))

    await expect(runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'NEEDS_ASSISTANT' }), transcript: '幫我推薦不辣又適合兩個人吃的餐', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toEqual({ kind: 'NEEDS_ASSISTANT' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('preserves the browser checkout phase for a payment utterance escalated to Main Agent', async () => {
    const execute = vi.fn(async () => ({
      candidates: [{ description: '使用信用卡付款。', id: 'intent:select-payment:card' }],
      phase: 'checkout_payment_select',
      paymentState: 'idle',
      allowedPaymentMethods: ['card', 'mobile'],
      interactionState: { matchingCartLines: 0 },
    }))
    await expect(runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'NEEDS_ASSISTANT' }), transcript: '信用卡', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toMatchObject({ kind: 'NEEDS_ASSISTANT', decisionState: { phase: 'checkout_payment_select', paymentState: 'idle', allowedPaymentMethods: ['card', 'mobile'] } })
  })

  it('omits raw checkout identifiers from the Main Agent screen hint', () => {
    expect(conversationDecisionStateFrom({
      phase: 'checkout_payment_select',
      paymentState: 'idle',
      allowedPaymentMethods: ['card', 'mobile'],
      checkoutSnapshot: { taxId: '12345678', carrierCode: 'secret' },
      references: [{ label: '顧客', refId: 'cart:L1' }],
      interactionState: { matchingCartLines: 1, pendingAction: 'SELECT_PAYMENT', selectedItemName: '水餃' },
    })).toEqual({
      phase: 'checkout_payment_select',
      paymentState: 'idle',
      allowedPaymentMethods: ['card', 'mobile'],
      interactionState: { matchingCartLines: 1, pendingAction: 'SELECT_PAYMENT', selectedItemName: '水餃' },
    })
  })

  it('keeps incomplete ASR only briefly and never uses it to extend the next decision', async () => {
    let now = 1_000
    const session = createIncompleteAsrSession(() => now)
    const execute = vi.fn(async () => ({ candidates: [{ description: 'Add shrimp roll.', id: 'intent:add:shrimp' }] }))
    await runFastPath({ isEnabled: async () => true, decide: async () => ({ kind: 'INCOMPLETE' }), session, transcript: '我要一份', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(session.snapshot()).toEqual({ expiresAt: 4_000, transcript: '我要一份' })

    const decide = vi.fn(async () => ({ kind: 'IGNORE' as const }))
    await runFastPath({ isEnabled: async () => true, decide, session, transcript: '背景聲音', webMcp: { execute, tools: [candidateTool, executeTool] } })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ transcript: '背景聲音' }))
    expect(session.snapshot()).toBeUndefined()

    session.retain('還沒說完')
    now = 4_001
    expect(session.snapshot()).toBeUndefined()
  })

  it('does not let System One create a free-form clarification', async () => {
    const execute = vi.fn(async () => ({
      candidates: [{ description: 'Set cart shrimp roll to two.', id: 'intent:set-quantity:cart:L2:2' }],
      clarificationPrompt: '你是要操作目前選的水餃，還是購物車裡的蝦捲？',
    }))
    const input = {
      isEnabled: async () => true,
      decide: async () => ({ kind: 'CLARIFICATION' as const }),
      transcript: '改成兩份',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    }
    await expect(runFastPath(input)).resolves.toEqual({ kind: 'UNAVAILABLE' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenNthCalledWith(1, candidateTool, { transcript: '改成兩份' })
  })

  // Report: this chat, 2026-10-19 — a verified unclear answer must remain answerable by voice.
  it('retains the owned clarification without cancelling it or requiring touch', async () => {
    const question = { questionId: 'clarification-1', purpose: 'item-clarification', question: '您指的是小辣水餃還是不辣水餃？', expiresAt: Date.now() + 30_000, choices: [{ id: 'clarify:0', description: '小辣水餃' }, { id: 'clarify:1', description: '不辣水餃' }, { id: 'clarify:cancel', description: '取消這次修改' }] }
    const execute = vi.fn(async (tool: ServiceTool, args?: Record<string, unknown>) => tool === executeTool ? { customerMessage: '已修改不辣水餃。' } : { phase: 'clarification', waitingFor: question, candidates: question.choices, ...(args?.transcript === '第二筆' ? { resolvedCandidateId: 'clarify:1' } : {}) })
    const decide = vi.fn(async () => ({ kind: 'CLARIFICATION' as const }))
    await expect(runFastPath({ isEnabled: async () => true, decide, transcript: '那個', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toMatchObject({ kind: 'CLARIFICATION', prompt: question.question, question })
    expect(execute).toHaveBeenCalledTimes(1)
    await expect(runFastPath({ isEnabled: async () => true, decide, transcript: '第二筆', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toMatchObject({ kind: 'FAST_ACTION', action: { id: 'clarify:1' } })
    expect(decide).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenLastCalledWith(executeTool, { candidateId: 'clarify:1' })
  })

  it('executes a uniquely resolved bound reference without another model call', async () => {
    const decide = vi.fn(async () => ({ kind: 'IGNORE' as const }))
    const execute = vi.fn(async (tool: typeof candidateTool) => tool.name === candidateTool.name
      ? { phase: 'clarification', resolvedCandidateId: 'clarify:1', candidates: [{ id: 'clarify:0', description: '第一筆水餃' }, { id: 'clarify:1', description: '第二筆水餃' }] }
      : { customerMessage: '已移除第二筆水餃。' })
    await expect(runFastPath({ isEnabled: async () => true, decide, transcript: '第二筆', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toMatchObject({ kind: 'FAST_ACTION', action: { id: 'clarify:1' } })
    expect(decide).not.toHaveBeenCalled()
    expect(execute).toHaveBeenNthCalledWith(2, executeTool, { candidateId: 'clarify:1' })
  })

  it('returns unavailable without inventing a fallback when browser candidates fail', async () => {
    await expect(runFastPath({
      isEnabled: async () => true,
      decide: async () => ({ actionId: 'intent:add:shrimp', kind: 'FAST_ACTION' }),
      transcript: '我要蝦捲',
      webMcp: { execute: async () => {
        throw new Error('WebMCP disconnected')
      }, tools: [candidateTool, executeTool] },
    })).resolves.toEqual({ kind: 'UNAVAILABLE' })
  })

  it('hands off to Main Agent when WebMCP context tools are missing or unsupported', async () => {
    const decide = vi.fn()
    const execute = vi.fn()
    const result = await runFastPath({
      isEnabled: async () => true,
      decide,
      transcript: '我要一個招牌便當',
      webMcp: { execute, tools: [] },
    })
    expect(result.kind).toBe('NEEDS_ASSISTANT')
    expect(result.reason).toBe('SERVICE_CAPABILITY_UNAVAILABLE')
    expect(decide).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('can classify an active Agent follow-up without a legal menu action', async () => {
    const decide = vi.fn(async () => ({ kind: 'FOLLOW_UP_ACTIVE' as const }))
    const execute = vi.fn(async () => ({ candidates: [], phase: 'ordering' }))
    await expect(runFastPath({ isEnabled: async () => true, activeRequest: { stage: 'thinking', text: '我要招牌便當' }, decide, transcript: '不要辣', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toMatchObject({ kind: 'FOLLOW_UP_ACTIVE' })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ activeRequest: { stage: 'thinking', text: '我要招牌便當' } }) }))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('defers a selected mutation when the previous Agent tool has crossed the safe interruption point', async () => {
    const execute = vi.fn(async () => ({ candidates: [{ description: 'Add shrimp roll.', id: 'intent:add:shrimp' }] }))
    await expect(runFastPath({ isEnabled: async () => true, decide: async () => ({ actionId: 'intent:add:shrimp', kind: 'FAST_ACTION' }), onActionSelected: () => 'DEFER' as const, transcript: '再一份', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toMatchObject({ kind: 'DEFERRED' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not execute an issued browser candidate after its visitor session was reset', async () => {
    const execute = vi.fn(async () => ({ candidates: [{ description: 'Clear the cart.', id: 'intent:clear-cart' }] }))
    let current = true
    await expect(runFastPath({
      isEnabled: async () => true,
      decide: async () => ({ actionId: 'intent:clear-cart', kind: 'FAST_ACTION' }),
      isCurrent: () => current,
      onActionSelected: () => {
        current = false
      },
      transcript: '清空購物車',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    })).resolves.toMatchObject({ kind: 'DEFERRED' })
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

// Report: this chat, Nov15 — direct checkout assent lost the next cart question
// because a receipt without product visuals became a bare clarification string.
it('preserves a structured cart confirmation on the normal reply presentation path', async () => {
  const question = { questionId: 'review-cart', purpose: 'browser-service-question', question: '餐點、份數和金額正確嗎？', expiresAt: Date.now() + 120_000, choices: [{ id: 'yes', description: '確認購物車，選擇發票方式' }, { id: 'no', description: '先修改餐點' }] }
  const receipt = { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前購物車：水餃一份。', pendingCustomerChoice: question }
  const onExecuted = vi.fn()
  const result = await runFastPath({ isEnabled: async () => true, transcript: '好', decide: async () => ({ kind: 'FAST_ACTION', actionId: 'yes' }), source: { context: async () => ({ phase: 'ordering', candidates: [{ id: 'yes', description: '開啟購物車' }] }), execute: async () => receipt }, webMcp: { tools: [], execute: vi.fn() }, onExecuted })
  expect(result).toMatchObject({ kind: 'FAST_ACTION', result: receipt })
  expect(onExecuted).toHaveBeenCalledOnce()
})
