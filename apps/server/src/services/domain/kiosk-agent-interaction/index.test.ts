import { describe, expect, it } from 'vitest'

import { compactToolResultForModel, createInteractionInstructions, defaultKioskAgentInteractionState, recordCustomerInput, recordToolResults, requiresPresentedReply, selectBoundedConversationText } from '.'

it('isolates checkout language from earlier ordering chat without altering the durable entries', () => {
  const entries = [
    { kind: 'user_text' as const, content: '剛才聊的故事' },
    { kind: 'assistant_text' as const, content: '先前推薦的餐點' },
    { kind: 'user_text' as const, content: '我要街口支付' },
  ]
  expect(selectBoundedConversationText(entries, 'checkout')).toEqual([{ role: 'user', content: '我要街口支付' }])
  expect(entries).toHaveLength(3)
})

describe('kiosk Agent interaction', () => {
  it('keeps competing model operation prose out of customer history but retains general answers', () => {
    expect(requiresPresentedReply([{ name: 'order_ask_question', content: JSON.stringify({ pendingCustomerChoice: { questionId: 'Q1' } }) }])).toBe(true)
    expect(requiresPresentedReply([{ name: 'checkout_select_payment', content: JSON.stringify({ customerMessage: '付款尚未完成。' }) }])).toBe(true)
    expect(requiresPresentedReply([{ name: 'menu_get', content: JSON.stringify({ customerMessage: '找到水餃。' }) }])).toBe(true)
    expect(requiresPresentedReply([{ name: 'menu_get', content: JSON.stringify({ items: [], availability: 'NONE' }) }])).toBe(true)
    expect(requiresPresentedReply([{ name: 'order_add_item', content: 'invalid tool result' }])).toBe(true)
    expect(requiresPresentedReply([])).toBe(false)
    expect(requiresPresentedReply([{ name: 'kiosk_session_history', content: 'older dialogue' }])).toBe(false)
  })
  it('keeps environment metadata out of model dialogue while preserving uncertain payment status', () => {
    const original = JSON.stringify({ environment: 'test', receipt: { environment: 'test', status: 'uncertain', customerMessage: '付款狀態尚未確認。' }, items: [{ id: 'dish', composition: { source: 'simulation', complete: true, ingredients: ['pork'], revision: '1' } }] })
    const modelContent = compactToolResultForModel('checkout_select_payment', original)
    expect(modelContent).not.toContain('simulation')
    expect(modelContent).not.toContain('environment')
    expect(JSON.parse(modelContent)).toMatchObject({ receipt: { status: 'uncertain', customerMessage: '付款狀態尚未確認。' }, items: [{ composition: { complete: true, ingredients: ['pork'] } }] })
    const instructions = createInteractionInstructions({ ...defaultKioskAgentInteractionState, cartSummary: { fulfillmentMode: 'takeout', itemCount: 0, lines: [], total: 0 } })
    expect(instructions).not.toContain('外帶')
    expect(instructions).toContain('takeout')
  })
  it('treats an alternative request as exploration and excludes the prior batch', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll', 'minced-pork-rice'] } }),
      name: 'menu_show_recommendations',
    }])

    expect(recordCustomerInput(shown, '有沒有其他推薦的？')).toMatchObject({
      dismissedSubjectIds: ['shrimp-roll', 'minced-pork-rice'],
      recentUserIntent: 'request_alternatives',
      suggestedSubjectIds: [],
    })
  })

  it('records recommendations that the menu rendered as part of the recommendation tool', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll', 'minced-pork-rice'] } }),
      name: 'menu_recommend',
    }])

    expect(shown).toMatchObject({
      recentAgentAction: { name: 'menu_recommend', subjectIds: ['shrimp-roll', 'minced-pork-rice'] },
      suggestedSubjectIds: ['shrimp-roll', 'minced-pork-rice'],
    })
  })

  it('retains every subject behind a compact multi-subject menu preview', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({
        presentation: {
          itemIds: ['bento-1', 'beef-noodles', 'bento-2', 'bento-3'],
          subjects: [
            { id: 'query:便當', itemIds: ['bento-1', 'bento-2', 'bento-3', 'bento-4', 'bento-5'] },
            { id: 'query:麵', itemIds: ['beef-noodles'] },
          ],
        },
      }),
      name: 'menu_get',
    }])

    expect(shown.recentAgentAction).toMatchObject({
      name: 'menu_get',
      subjectIds: ['bento-1', 'beef-noodles', 'bento-2', 'bento-3', 'bento-4', 'bento-5'],
    })
  })

  it('keeps a compact menu and cart working state without copying the full tool payload', () => {
    const state = recordToolResults(defaultKioskAgentInteractionState, [{
      name: 'order_add_item',
      content: JSON.stringify({
        item: { id: 'beef-noodles', name: '牛肉麵', description: '不應進入工作狀態的完整介紹' },
        cart: {
          fulfillmentMode: 'takeout',
          itemCount: 2,
          lines: [{ id: 'line-1', itemId: 'beef-noodles', name: '牛肉麵', options: { spice: 'mild' }, quantity: 2, unitPrice: 150 }],
          total: 300,
        },
      }),
    }])

    expect(state).toMatchObject({
      cartSummary: {
        fulfillmentMode: 'takeout',
        itemCount: 2,
        lines: [{ itemId: 'beef-noodles', lineId: 'line-1', name: '牛肉麵', options: { spice: 'mild' }, quantity: 2 }],
        total: 300,
      },
      recentMenuSubjects: [{ id: 'beef-noodles', name: '牛肉麵' }],
    })
    const instructions = createInteractionInstructions(state)
    expect(instructions).toContain('牛肉麵（beef-noodles）')
    expect(instructions).toContain('lineId=line-1')
    expect(instructions).not.toContain('不應進入工作狀態的完整介紹')
  })

  it('does not treat an unfiltered catalog response as recent customer context', () => {
    const state = recordToolResults(defaultKioskAgentInteractionState, [{
      name: 'menu_get',
      content: JSON.stringify({ items: [
        { id: 'beef-noodles', name: '牛肉麵' },
        { id: 'dumplings', name: '水餃' },
      ] }),
    }])

    expect(state.recentMenuSubjects).toEqual([])
  })

  it('keeps recent conversation text within a total character budget', () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      content: `${index}:`.padEnd(1_000, String(index % 10)),
      kind: index % 2 === 0 ? 'user_text' as const : 'assistant_text' as const,
    }))

    const messages = selectBoundedConversationText(entries)

    expect(messages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(16_000)
    expect(messages.at(-1)?.content).toContain('29:')
    expect(messages.some(message => message.content.startsWith('0:'))).toBe(false)
  })

  it('compacts an oversized tool result for the model while retaining ordering identifiers', () => {
    const original = JSON.stringify({
      customerMessage: '我找到牛肉麵。',
      items: [{
        available: true,
        category: '麵食',
        description: '完整介紹'.repeat(3_000),
        id: 'beef-noodles',
        name: '牛肉麵',
        optionGroups: [{ id: 'spice', label: '辣度', values: [{ id: 'mild', label: '小辣' }] }],
        price: 150,
      }],
      presentation: { itemIds: ['beef-noodles'], kind: 'query-results' },
    })

    const modelContent = compactToolResultForModel('menu_get', original)
    const payload = JSON.parse(modelContent)

    expect(modelContent.length).toBeLessThanOrEqual(8_000)
    expect(payload).toMatchObject({
      customerMessage: '我找到牛肉麵。',
      items: [{ id: 'beef-noodles', name: '牛肉麵', optionGroups: [{ id: 'spice' }] }],
      modelContextCompacted: true,
      originalCharacterCount: original.length,
      presentation: { itemIds: ['beef-noodles'] },
      toolName: 'menu_get',
    })
    expect(modelContent).not.toContain('完整介紹'.repeat(100))
  })

  it('enters decision guidance only after repeated unchanged rendered recommendations', () => {
    const shown = recordToolResults(defaultKioskAgentInteractionState, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])
    const onceRepeated = recordToolResults(shown, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])
    const twiceRepeated = recordToolResults(onceRepeated, [{
      content: JSON.stringify({ presentation: { itemIds: ['shrimp-roll'] } }),
      name: 'menu_show_recommendations',
    }])

    expect(onceRepeated.mode).toBe('active')
    expect(twiceRepeated.mode).toBe('decision_guidance')
    expect(createInteractionInstructions(twiceRepeated)).toContain('2 至 3 個')
  })

  it('returns to active exploration when the Agent actually presents unseen choices', () => {
    const stagnant = {
      ...defaultKioskAgentInteractionState,
      mode: 'decision_guidance' as const,
      noProgressCount: 2,
      suggestedSubjectIds: ['shrimp-roll'],
    }

    expect(recordToolResults(stagnant, [{
      content: JSON.stringify({ presentation: { itemIds: ['fish-floss-rice'] } }),
      name: 'menu_show_recommendations',
    }])).toMatchObject({ mode: 'active', noProgressCount: 0, suggestedSubjectIds: ['shrimp-roll', 'fish-floss-rice'] })
  })
})
