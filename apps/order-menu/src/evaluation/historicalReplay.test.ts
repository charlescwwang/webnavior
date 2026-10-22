import type { CartSnapshot } from '../domain/order-machine'
import type { HistoricalCase, RecordedEvent } from './contracts'

import { describe, expect, it } from 'vitest'

import { createMenuToolRuntime } from '../webmcp'
import { historyData } from './historyData'
import { evaluateDemands, summarizeCoverage } from './outcomes'

function history(id: string) {
  const value = historyData.cases.find(value => value.id === id)
  if (!value || value.status === 'missing-evidence')
    throw new Error(`Original evidence unavailable: ${id}`)
  return value
}

function receipt(value: HistoricalCase & { events: RecordedEvent[] }, sequence: number) {
  const event = value.events.find(event => event.sequence === sequence)
  if (!event || event.kind !== 'tool_result')
    throw new Error(`Missing recorded receipt: ${value.id}/${sequence}`)
  return event
}

function cartAt(value: HistoricalCase & { events: RecordedEvent[] }, sequence: number): CartSnapshot {
  const cart = receipt(value, sequence).cart
  if (!cart)
    throw new Error(`Missing recorded cart: ${value.id}/${sequence}`)
  return { ...cart, fulfillmentMode: cart.fulfillmentMode }
}

// Source: docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md, R03–R05.
// Original contradictions are expected to fail the evaluator. Current-runtime
// controls are separate and do not count as live Jev/Main incident replays.
describe('verified historical excerpts and current boundary controls', () => {
  it('r03 replays the captured additions and rejects later unsupported quantity claims', async () => {
    const source = history('R03')
    let cart: CartSnapshot | undefined
    const runtime = createMenuToolRuntime({ menu: [historyData.quantityItem], onAction: () => {}, onMenuSelection: () => {}, onCartChange: value => cart = value })
    for (const event of source.events) {
      if (event.kind === 'tool_call')
        await runtime.invokeForAgent(event.tool, event.input)
      if (event.kind === 'tool_result' && event.cart) {
        expect(cart?.lines.map(line => ({ itemId: line.itemId, quantity: line.quantity }))).toEqual(event.cart.lines.map(line => ({ itemId: line.itemId, quantity: line.quantity })))
        expect(cart?.total).toBe(event.cart.total)
      }
    }
    const observed = cartAt(source, 29)
    expect(evaluateDemands([{ id: 'recorded-seven-claim', kind: 'line', itemId: historyData.quantityItem.id, quantity: 7 }], { cart: observed, claimedComplete: true }).falseCompletion).toBe(true)
    // The later original correction asks for two total, not another two.
    // Truthful reporting of three alone does not fulfill that correction.
    const correction = [{ id: 'two-total', kind: 'line' as const, itemId: historyData.quantityItem.id, quantity: 2 }]
    expect(evaluateDemands(correction, { cart: observed, claimedComplete: true }).falseCompletion).toBe(true)
    if (!cart?.lines[0])
      throw new Error('Missing replayed cart line')
    await runtime.invokeForAgent('cart_set_line_quantity', { lineId: cart.lines[0].id, quantity: 2 })
    expect(evaluateDemands(correction, { cart, claimedComplete: true }).allSatisfied).toBe(true)
  })

  it('r04 detects the recorded fulfillment contradiction and blocks the same no-tool success prose', async () => {
    const source = history('R04')
    const demand = [{ id: 'mode', kind: 'fulfillment' as const, mode: 'dine-in' as const }]
    expect(evaluateDemands(demand, { cart: cartAt(source, 396), claimedComplete: true }).falseCompletion).toBe(true)
    // Synthetic repaired action, starting from the recorded cart facts.
    let cart: CartSnapshot | undefined
    const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: value => cart = value })
    for (const line of cartAt(source, 341).lines)
      await runtime.invokeForAgent('order_add_item', { itemId: line.itemId, quantity: line.quantity })
    await runtime.invokeForAgent('order_set_fulfillment', { mode: 'takeout' })
    await runtime.invokeForAgent('order_set_fulfillment', { mode: 'dine-in' })
    expect(evaluateDemands(demand, { cart, claimedComplete: true }).allSatisfied).toBe(true)
    expect(cart?.itemCount).toBe(3)
  })

  it('r05 keeps the original data-only read separate from a repaired full-catalog presentation', async () => {
    const source = history('R05')
    const demand = [{ id: 'whole-menu', kind: 'presentation' as const, itemIds: historyData.catalog.map(item => item.id) }]
    const originalDisplay = receipt(source, 195).presentedItemIds
    expect(evaluateDemands(demand, { presentedItemIds: originalDisplay, claimedComplete: true }).falseCompletion).toBe(true)
    expect(receipt(source, 191).dataOnly).toBe(true)
    const shown: string[][] = []
    const runtime = createMenuToolRuntime({ menu: historyData.catalog, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {}, onRecommendationsChange: value => shown.push(value.itemIds) })
    for (const sequence of [85, 101, 167, 178, 189, 193]) {
      const event = source.events.find(event => event.sequence === sequence)
      if (!event || event.kind !== 'tool_call')
        throw new Error(`Missing menu call: ${sequence}`)
      await runtime.invokeForAgent(event.tool, event.input)
    }
    expect(evaluateDemands(demand, { presentedItemIds: shown.at(-1), claimedComplete: true }).falseCompletion).toBe(true)
    // Explicit catalog action is a new control, not a captured original call.
    await runtime.invokeForAgent('menu_get', { scope: 'catalog', display: true })
    expect(evaluateDemands(demand, { presentedItemIds: shown.at(-1), claimedComplete: true }).allSatisfied).toBe(true)
  })

  it('reports unavailable originals without executing synthetic substitutes under their historical IDs', () => {
    const coverage = summarizeCoverage(historyData.cases)
    expect(() => history('R01')).toThrow('Original evidence unavailable')
    console.info('Historical evidence coverage:', JSON.stringify(coverage))
  })
})
