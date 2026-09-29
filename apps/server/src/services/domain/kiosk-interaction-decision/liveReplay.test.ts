import { describe, expect, it } from 'vitest'

import { decideInteraction } from '.'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL
const policy = { decisionInstruction: '', storeInstruction: '' }

// Run explicitly with KIOSK_SYSTEM_ONE_REPLAY_URL; ordinary unit tests never
// depend on a merchant's model process or network availability.
describe.skipIf(!replayUrl)('kiosk System One live semantic replay', () => {
  const ordering = [
    { id: 'intent:search-menu', description: '查詢已解析的菜單品項是否存在，或瀏覽分類。' },
    { id: 'intent:select-item', description: '查看或編輯已解析的餐點，但不建立訂購項目。' },
    { id: 'intent:add-item', description: '明確建立一筆新的餐點訂購項目。', requiresHighConfidence: true },
  ]
  const selected = [
    { id: 'intent:add-item', description: '新增一份目前選取的水餃至訂單。', requiresHighConfidence: true },
    { id: 'intent:recommend', description: '顧客明確要求簡單推薦或套用已知飲食限制。' },
    { id: 'intent:set-quantity', description: '修改已選或購物車現有餐點數量，不新增品項。', requiresHighConfidence: true },
    { id: 'intent:set-option', description: '修改已選或購物車現有餐點客製選項。', requiresHighConfidence: true },
  ]
  const cases = [
    { name: '我想要吃招牌便當', phase: 'ordering', references: [{ label: '周氏蝦捲招牌便當', refId: 'ITEM_1' }], candidates: ordering, expected: 'intent:add-item', allowLowConfidenceEscalation: true },
    { name: '我不要豬肉', phase: 'ordering', references: [], candidates: [{ id: 'intent:recommend', description: '顧客明確要求簡單推薦或套用已知飲食限制。' }], expected: 'intent:recommend', constraints: { exclude: ['pork'] } },
    { name: '我好餓', phase: 'ordering', references: [], candidates: [{ id: 'intent:recommend', description: '顧客明確要求簡單推薦或套用已知飲食限制。' }], expected: 'IGNORE' },
    { name: '信用卡', phase: 'checkout_payment_select', references: [], candidates: [{ id: 'intent:select-payment:card', description: '使用信用卡付款。', requiresHighConfidence: true }, { id: 'intent:select-payment:mobile', description: '使用行動支付付款。', requiresHighConfidence: true }], expected: 'intent:select-payment:card' },
    { name: '改兩份', phase: 'ordering', references: [{ label: '目前選的水餃', refId: 'SELECTED_ITEM_1' }], candidates: selected, expected: 'intent:set-quantity' },
    { name: '不要辣', phase: 'ordering', references: [{ label: '目前選的水餃', refId: 'SELECTED_ITEM_1' }], candidates: selected, expected: 'intent:set-option' },
    { name: '再一份', phase: 'ordering', references: [{ label: '購物車第1筆水餃（最近加入）', refId: 'CART_LINE_1' }], candidates: selected, expected: 'intent:add-item' },
    { name: '水餃不要了', phase: 'ordering', references: [{ label: '購物車第1筆水餃', refId: 'CART_LINE_1' }, { label: '購物車第2筆水餃', refId: 'CART_LINE_2' }], candidates: [...ordering, { id: 'intent:view-cart', description: '查看目前購物車。' }, { id: 'intent:set-quantity', description: '修改已選或購物車現有餐點數量，不新增品項。', requiresHighConfidence: true }, { id: 'intent:set-option', description: '修改已選或購物車現有餐點客製選項。', requiresHighConfidence: true }, { id: 'intent:remove-item', description: '移除購物車中的餐點；若有多筆同名品項，程式會詢問是哪一筆。', requiresHighConfidence: true }], expected: 'intent:remove-item' },
  ]

  for (const scenario of cases) {
    it(scenario.name, async () => {
      const result = await decideInteraction({
        candidates: scenario.candidates,
        decisionState: {
          allowedPaymentMethods: scenario.phase === 'checkout_payment_select' ? ['card', 'mobile'] : [],
          constraints: 'constraints' in scenario ? scenario.constraints : { exclude: [] },
          interactionState: { matchingCartLines: scenario.references.filter(reference => reference.refId.startsWith('CART_LINE_')).length, ...(scenario.references.some(reference => reference.refId.startsWith('SELECTED_ITEM_')) ? { selectedItemName: '水餃' } : {}), ...(scenario.name === '再一份' ? { lastAddedItemName: '水餃' } : {}), ...(scenario.phase === 'clarification' ? { pendingIntent: 'REMOVE_ITEM' } : {}) },
          paymentState: 'idle',
          phase: scenario.phase,
          references: scenario.references,
        },
        includeTrace: true,
        invoke: async (state, questions) => {
          const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), {
            body: JSON.stringify({ state, questions }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: AbortSignal.timeout(30_000),
          })
          if (!response.ok)
            throw new Error(`System One replay failed: ${response.status}`)
          return await response.json() as { answers?: Record<string, unknown> }
        },
        maxActionCandidates: 22,
        policy,
        transcript: scenario.name,
      })
      console.info(JSON.stringify({ transcript: scenario.name, phase: scenario.phase, references: scenario.references, candidates: scenario.candidates.map(candidate => candidate.id), result }))
      if (scenario.expected === 'IGNORE') {
        expect(['IGNORE', 'NEEDS_ASSISTANT']).toContain(result.kind)
      }
      else if (scenario.expected === 'intent:recommend') {
        expect(['FAST_ACTION', 'NEEDS_ASSISTANT']).toContain(result.kind)
      }
      else if ('allowLowConfidenceEscalation' in scenario) {
        expect(result).toMatchObject({ trace: { rawAnswer: { choice: scenario.expected } } })
        expect(['FAST_ACTION', 'NEEDS_ASSISTANT']).toContain(result.kind)
      }
      else {
        expect(result).toMatchObject({ actionId: scenario.expected, kind: 'FAST_ACTION' })
      }
    }, 40_000)
  }
})
