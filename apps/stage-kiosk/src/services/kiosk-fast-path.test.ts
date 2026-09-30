import type { WebMcpTool } from '@proj-airi/stage-ui/services/webmcp-adapter'

import { describe, expect, it, vi } from 'vitest'

import { conversationDecisionStateFrom, createIncompleteAsrSession, runFastPath } from './kiosk-fast-path'

const candidateTool: WebMcpTool = {
  description: 'Candidates',
  inputSchema: {},
  name: 'kiosk_fast_path_context',
  origin: 'http://localhost:5166',
}
const executeTool: WebMcpTool = {
  description: 'Execute semantic intent',
  inputSchema: {},
  name: 'kiosk_fast_path_execute',
  origin: 'http://localhost:5166',
}

describe('kiosk System One fast path', () => {
  it('executes only the browser-produced candidate selected by Dasein', async () => {
    const execute = vi.fn(async (tool: WebMcpTool) => tool.name === candidateTool.name
      ? { candidates: [{ description: 'Add shrimp roll.', id: 'intent:add:shrimp' }] }
      : { customerMessage: '已加入蝦捲。' })
    const decide = vi.fn(async () => ({ actionId: 'intent:add:shrimp' as const, confidence: 0.93, kind: 'FAST_ACTION' as const }))

    const onActionSelected = vi.fn()
    await expect(runFastPath({ decide, onActionSelected, transcript: '我要蝦捲', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toEqual({
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

    await expect(runFastPath({
      decide: async () => ({ kind: 'NEEDS_ASSISTANT' }),
      transcript: '幫我推薦不辣又適合兩個人吃的餐',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    })).resolves.toEqual({ kind: 'NEEDS_ASSISTANT' })
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
    await expect(runFastPath({
      decide: async () => ({ kind: 'NEEDS_ASSISTANT' }),
      transcript: '信用卡',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    })).resolves.toMatchObject({ kind: 'NEEDS_ASSISTANT', decisionState: { phase: 'checkout_payment_select', paymentState: 'idle', allowedPaymentMethods: ['card', 'mobile'] } })
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
    await runFastPath({
      decide: async () => ({ kind: 'INCOMPLETE' }),
      session,
      transcript: '我要一份',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    })
    expect(session.snapshot()).toEqual({ expiresAt: 4_000, transcript: '我要一份' })

    const decide = vi.fn(async () => ({ kind: 'IGNORE' as const }))
    await runFastPath({ decide, session, transcript: '背景聲音', webMcp: { execute, tools: [candidateTool, executeTool] } })
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
      decide: async () => ({ kind: 'CLARIFICATION' as const }),
      transcript: '改成兩份',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    }
    await expect(runFastPath(input)).resolves.toEqual({ kind: 'UNAVAILABLE' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenNthCalledWith(1, candidateTool, { transcript: '改成兩份' })
  })

  it('returns a touch instruction after an unresolved clarification response', async () => {
    const execute = vi.fn(async () => ({ phase: 'clarification', candidates: [{ id: 'clarify:0', description: '第一筆水餃' }, { id: 'clarify:1', description: '第二筆水餃' }] }))
    await expect(runFastPath({
      decide: async () => ({ kind: 'IGNORE' }),
      transcript: '那個',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    })).resolves.toMatchObject({ kind: 'CLARIFICATION', prompt: expect.stringContaining('螢幕') })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('executes a uniquely resolved bound reference without another model call', async () => {
    const decide = vi.fn(async () => ({ kind: 'IGNORE' as const }))
    const execute = vi.fn(async (tool: typeof candidateTool) => tool.name === candidateTool.name
      ? { phase: 'clarification', resolvedCandidateId: 'clarify:1', candidates: [{ id: 'clarify:0', description: '第一筆水餃' }, { id: 'clarify:1', description: '第二筆水餃' }] }
      : { customerMessage: '已移除第二筆水餃。' })
    await expect(runFastPath({ decide, transcript: '第二筆', webMcp: { execute, tools: [candidateTool, executeTool] } })).resolves.toMatchObject({ kind: 'FAST_ACTION', action: { id: 'clarify:1' } })
    expect(decide).not.toHaveBeenCalled()
    expect(execute).toHaveBeenNthCalledWith(2, executeTool, { candidateId: 'clarify:1' })
  })

  it('returns unavailable without inventing a fallback when browser candidates fail', async () => {
    await expect(runFastPath({
      decide: async () => ({ actionId: 'intent:add:shrimp', kind: 'FAST_ACTION' }),
      transcript: '我要蝦捲',
      webMcp: { execute: async () => { throw new Error('WebMCP disconnected') }, tools: [candidateTool, executeTool] },
    })).resolves.toEqual({ kind: 'UNAVAILABLE' })
  })

  it('can classify an active Agent follow-up without a legal menu action', async () => {
    const decide = vi.fn(async () => ({ kind: 'FOLLOW_UP_ACTIVE' as const }))
    const execute = vi.fn(async () => ({ candidates: [], phase: 'ordering' }))
    await expect(runFastPath({
      activeRequest: { stage: 'thinking', text: '我要招牌便當' },
      decide,
      transcript: '不要辣',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    })).resolves.toMatchObject({ kind: 'FOLLOW_UP_ACTIVE' })
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ decisionState: expect.objectContaining({ activeRequest: { stage: 'thinking', text: '我要招牌便當' } }) }))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('defers a selected mutation when the previous Agent tool has crossed the safe interruption point', async () => {
    const execute = vi.fn(async () => ({ candidates: [{ description: 'Add shrimp roll.', id: 'intent:add:shrimp' }] }))
    await expect(runFastPath({
      decide: async () => ({ actionId: 'intent:add:shrimp', kind: 'FAST_ACTION' }),
      onActionSelected: () => 'DEFER' as const,
      transcript: '再一份',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    })).resolves.toMatchObject({ kind: 'DEFERRED' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not execute an issued browser candidate after its visitor session was reset', async () => {
    const execute = vi.fn(async () => ({ candidates: [{ description: 'Clear the cart.', id: 'intent:clear-cart' }] }))
    let current = true
    await expect(runFastPath({
      decide: async () => ({ actionId: 'intent:clear-cart', kind: 'FAST_ACTION' }),
      isCurrent: () => current,
      onActionSelected: () => { current = false },
      transcript: '清空購物車',
      webMcp: { execute, tools: [candidateTool, executeTool] },
    })).resolves.toMatchObject({ kind: 'DEFERRED' })
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
