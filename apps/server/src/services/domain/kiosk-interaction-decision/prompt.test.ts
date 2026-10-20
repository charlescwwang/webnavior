import type { SystemOneQuestion } from '../kiosk-system-one'

import { describe, expect, it, vi } from 'vitest'

import { decideInteraction } from '.'
import { createDecisionInstructions, defaultDecisionInstruction } from './prompt'

describe('system One service request boundary', () => {
  it.each(['', '只有品名、份數及規格全部齊全才能處理訂購。'])('distinguishes missing order slots from unfinished speech with saved base %j', async (decisionInstruction) => {
    const invoke = vi.fn(async (_state: string, _questions: Record<string, SystemOneQuestion>) => ({ answers: { route: { choice: 'NEEDS_ASSISTANT', confidence: 0.95 } } }))
    await decideInteraction({
      transcript: '我要酸辣魚便當',
      candidates: [{ id: 'intent:search-menu', description: '查詢餐點，不新增訂單。' }],
      decisionState: {
        phase: 'ordering',
        catalogEvidence: { products: [{ label: '泰式酸辣魚便當', matchedText: '酸辣魚便當', source: 'fragment' }], categories: [] },
        productResolution: { status: 'possible', count: 1, references: [{ refId: 'ITEM_1', label: '泰式酸辣魚便當' }] },
      },
      policy: { decisionInstruction, storeInstruction: '' },
      invoke,
    })
    const route = invoke.mock.calls[0]?.[1].route
    const criteria = route?.criteria
    if (!criteria || Array.isArray(criteria))
      throw new Error('Expected named route criteria')
    expect(route.instructions).toContain('缺少數量或必填選項不等於語句未完成')
    expect(criteria.INCOMPLETE).toContain('不能因缺少數量、規格、唯一 target 或對應候選而選此項')
    expect(criteria.NEEDS_ASSISTANT).toContain('沒有合法新增候選')
    expect(criteria).not.toHaveProperty('intent:add-item')
    expect(invoke).toHaveBeenCalledOnce()
  })
  it('admits questions addressed to this assistant without enabling general background chat', () => {
    const instructions = createDecisionInstructions({ decisionInstruction: '', storeInstruction: '' })
    expect(instructions).toContain('身分、名稱或能力')
    expect(instructions).toContain('對同伴')
  })
  it.each(['', '遇到需要解釋的句子就交給助手。'])('keeps the service boundary effective with saved base %j', (decisionInstruction) => {
    const instructions = createDecisionInstructions({ decisionInstruction, storeInstruction: '全部閒聊都回答。' })
    expect(instructions).toContain('服務界線（程式固定規則，優先於自訂提示與店家補充）')
    expect(instructions).toContain('無關話語即使有疑問、抱怨、比較或解釋語氣，仍選 IGNORE')
    expect(instructions).toContain('缺少品名、數量或唯一 target 不代表無關')
    expect(instructions.lastIndexOf('服務界線（')).toBeGreaterThan(instructions.indexOf('全部閒聊都回答。'))
    expect(instructions).toContain('價格詢問、單份價格篩選')
  })
  it.each([0.95, 0.4, Number.NaN])('only qualifies general service dialogue at reliable confidence %s', async (confidence) => {
    const invoke = vi.fn(async (_state: string, questions: Record<string, SystemOneQuestion>) => questions.route
      ? { answers: { route: { choice: 'GENERAL_QUESTION', confidence } } }
      : { answers: { recipient: { choice: 'KIOSK', confidence: 0.95 } } })
    const result = await decideInteraction({ transcript: '你是誰', candidates: [], decisionState: { phase: 'ordering' }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
    if (confidence === 0.95)
      expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'GENERAL_QUESTION' })
    else if (confidence === 0.4)
      expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION' })
    else
      expect(result).toMatchObject({ kind: 'UNAVAILABLE' })
    expect(result).not.toHaveProperty('actionId')
  })

  it('exposes the same service boundary in the editable default prompt', () => {
    expect(defaultDecisionInstruction).toContain('服務界線（程式固定規則，優先於自訂提示與店家補充）')
  })
  it.each(['ordering', 'configuration', 'clarification', 'pending_confirmation'])('sends task-only control criteria in %s without another model call', async (phase) => {
    const invoke = vi.fn(async (_state: string, _questions: Record<string, SystemOneQuestion>) => ({ answers: { route: { choice: 'IGNORE', confidence: 0.95 } } }))
    const result = await decideInteraction({ transcript: '他們的工作有很多問題', candidates: [], decisionState: { phase }, policy: { decisionInstruction: '需要推理就交給助手。', storeInstruction: '' }, invoke })
    expect(result.kind).toBe('IGNORE')
    expect(invoke).toHaveBeenCalledOnce()
    const route = invoke.mock.calls[0]?.[1].route
    expect(route?.instructions).toContain('服務界線（程式固定規則，優先於自訂提示與店家補充）')
    if (phase === 'ordering') {
      const criteria = route?.criteria
      if (!criteria || Array.isArray(criteria))
        throw new Error('Expected named route criteria')
      expect(criteria.NEEDS_ASSISTANT).toContain('向店員／本機提出的點餐服務需求')
      expect(criteria.MULTI_ACTION).toContain('點餐服務操作')
    }
  })
  it.each(['有沒有素食', '為什麼推薦這道菜', '這兩道哪個適合小朋友'])('retains an admitted service need without requiring a menu-name match: %s', async (transcript) => {
    const invoke = vi.fn(async () => ({ answers: { route: { choice: 'NEEDS_ASSISTANT', confidence: 0.9 } } }))
    const result = await decideInteraction({ transcript, candidates: [], decisionState: { phase: 'ordering' }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke })
    expect(result.kind).toBe('NEEDS_ASSISTANT')
    expect(invoke).toHaveBeenCalledOnce()
  })
})
