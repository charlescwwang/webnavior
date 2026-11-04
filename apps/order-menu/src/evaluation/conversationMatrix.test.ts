import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { createMenuToolRuntime } from '../webmcp'
import { conversationScripts, highRiskScriptIds, smokeScriptIds } from './conversationMatrix'
import { assessScriptTurn } from './conversationOracle'
import { historyData } from './historyData'
import { incidentConversationScripts, reportedIncidentEvidence, supersededConversationScripts } from './orderingIncidents'

describe('frozen112 dialogue manifest and authoritative oracle', () => {
  it('retains112 distinct positions, all20 original chains and two evidence gaps', () => {
    expect(conversationScripts).toHaveLength(112)
    expect(new Set(conversationScripts.map(script => script.id)).size).toBe(112)
    expect(conversationScripts.filter(script => script.kind === 'diagnostic').map(script => script.id)).toEqual(['D07', 'H05'])
    expect(conversationScripts.filter(script => script.source.endsWith('kioskConversationCases.ts'))).toHaveLength(20)
    for (const script of conversationScripts) {
      expect(script.steps.length).toBeGreaterThanOrEqual(2)
      expect(script.source).not.toBe('')
      expect(script.initial.entry).toMatch(/ready|pending/u)
    }
    for (const incident of reportedIncidentEvidence) {
      expect(incident.utterances.length).toBeGreaterThan(0)
      for (const id of incident.syntheticScripts)
        expect([...conversationScripts, ...incidentConversationScripts].some(script => script.id === id)).toBe(true)
    }
    expect(new Set(highRiskScriptIds).size).toBe(24)
    expect(new Set(smokeScriptIds).size).toBe(12)
    for (const id of [...highRiskScriptIds, ...smokeScriptIds])
      expect(conversationScripts.some(script => script.id === id && script.kind !== 'diagnostic')).toBe(true)
  })

  // Report: Nov2 P01-A2 recorded correct silence but the oracle also demanded a reply.
  it('requires silence without simultaneously requiring a customer reply', async () => {
    const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    const observed = { before, after: before, menu: historyData.catalog, answer: '', shownHistory: new Set<string>(), checkoutStarts: 0 }
    expect(assessScriptTurn({ text: '小王，關閉你電腦上的視窗', silentOnly: true }, observed)).toEqual([])
    expect(assessScriptTurn({ text: '小王，關閉你電腦上的視窗', silentOnly: true }, { ...observed, answer: '好的' })).toEqual(['Background/idle turn produced a customer reply'])
    expect(assessScriptTurn({ text: '關閉電話登記' }, observed)).toEqual(['Missing customer reply'])
  })

  // Report: user-confirmed Nov4 choice; preserve C15-A1 without pretending its old expectation passed.
  it('scores the approved unbound-reference revision without relaxing the historical gold', async () => {
    const revision = supersededConversationScripts.find(value => value.id === 'C15-A1')!
    const historical = conversationScripts.find(value => value.id === revision.id)!.steps[1]!
    const current = incidentConversationScripts.find(value => value.id === revision.replacementId)!.steps[1]!
    const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    const observed = { before, after: before, menu: historyData.catalog, answer: '', shownHistory: new Set<string>(), checkoutStarts: 0 }
    expect(assessScriptTurn(historical, observed)).toEqual(['Missing customer reply'])
    expect(assessScriptTurn(current, observed)).toEqual([])
    expect(assessScriptTurn(current, { ...observed, answer: '請再說一次餐點。' })).toEqual(['Background/idle turn produced a customer reply'])
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    expect(assessScriptTurn(current, { ...observed, after })).toContain('Read-only turn changed cart lines')
  })

  it('rejects real wrong-item, wrong-quantity, recommendation-only and over-budget outcomes', async () => {
    const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const snapshot = async () => parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    const before = await snapshot()
    await runtime.invoke('menu_recommend', { action: 'update', maxPrice: 200 })
    const recommended = await snapshot()
    const observe = (after: typeof before) => ({ before, after, menu: historyData.catalog, answer: '已加入水餃兩份。', shownHistory: new Set<string>(), checkoutStarts: 0 })
    const order = { text: '水餃兩份', cart: [{ itemId: 'dumplings', quantity: 2 }] }
    expect(assessScriptTurn(order, observe(recommended)).length).toBeGreaterThan(0)
    expect(assessScriptTurn({ text: '一百元以下', maxPrice: 100 }, observe(recommended)).some(error => error.includes('Over budget'))).toBe(true)
    await runtime.invoke('order_add_item', { itemId: 'beef-noodle-soup', quantity: 2 })
    expect(assessScriptTurn(order, observe(await snapshot())).some(error => error.includes('Cart mismatch'))).toBe(true)
    await runtime.reset()
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
    expect(assessScriptTurn(order, observe(await snapshot())).some(error => error.includes('Cart mismatch'))).toBe(true)
    await runtime.invoke('cart_set_line_quantity', { lineId: (await snapshot()).cart.lines[0]!.id, quantity: 2 })
    expect(assessScriptTurn(order, observe(await snapshot()))).toEqual([])
  })
})
