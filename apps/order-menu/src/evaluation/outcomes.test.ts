import type { CartSnapshot } from '../domain/order-machine'
import type { Demand } from './contracts'

import { describe, expect, it } from 'vitest'

import { menu } from '../domain/order-machine'
import { createMenuToolRuntime } from '../webmcp'
import { evaluateDemands } from './outcomes'

const dishes = [
  { ...menu[0]!, id: 'noodle', name: '牛肉麵', optionGroups: [] },
  { ...menu[0]!, id: 'dumpling', name: '水餃', optionGroups: [] },
]

// Plan: docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md, evaluator counterexamples.
describe('per-demand evidence evaluation', () => {
  it('detects a missing second dish and a duplicated first dish from real runtime snapshots', async () => {
    let cart: CartSnapshot | undefined
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onMenuSelection: () => {}, onCartChange: value => cart = value })
    const expected: Demand[] = [{ id: 'first', kind: 'line', itemId: 'noodle', quantity: 1 }, { id: 'second', kind: 'line', itemId: 'dumpling', quantity: 1 }]
    await runtime.invokeForAgent('order_add_item', { itemId: 'noodle', quantity: 1 })
    expect(evaluateDemands(expected, { cart, claimedComplete: true })).toEqual({ results: [{ id: 'first', status: 'satisfied' }, { id: 'second', status: 'mismatched' }], unexpectedChanges: [], allSatisfied: false, falseCompletion: true })
    await runtime.invokeForAgent('order_add_item', { itemId: 'dumpling', quantity: 1 })
    expect(evaluateDemands(expected, { cart, claimedComplete: true }).allSatisfied).toBe(true)
    await runtime.invokeForAgent('order_add_item', { itemId: 'noodle', quantity: 1 })
    expect(evaluateDemands(expected, { cart, claimedComplete: true }).falseCompletion).toBe(true)
  })

  it('does not merge two different requested option combinations into one fulfilled demand', async () => {
    let cart: CartSnapshot | undefined
    const runtime = createMenuToolRuntime({ menu: [{ ...dishes[0]!, optionGroups: [{ id: 'spice', label: '辣度', required: true, values: [{ id: 'hot', label: '大辣', priceDelta: 0 }, { id: 'mild', label: '小辣', priceDelta: 0 }] }] }], onAction: () => {}, onMenuSelection: () => {}, onCartChange: value => cart = value })
    await runtime.invokeForAgent('order_add_item', { itemId: 'noodle', quantity: 2, options: [{ groupId: 'spice', valueId: 'hot' }] })
    const result = evaluateDemands([{ id: 'hot', kind: 'line', itemId: 'noodle', quantity: 1, options: { spice: 'hot' } }, { id: 'mild', kind: 'line', itemId: 'noodle', quantity: 1, options: { spice: 'mild' } }], { cart, claimedComplete: true })
    expect(result.results).toEqual([{ id: 'hot', status: 'mismatched' }, { id: 'mild', status: 'mismatched' }])
    expect(result.falseCompletion).toBe(true)
  })

  it('treats prose-only completion and missing snapshots as unknown rather than an empty successful removal', () => {
    const result = evaluateDemands([{ id: 'remove', kind: 'line', itemId: 'noodle', quantity: 0 }], { claimedComplete: true })
    expect(result.results).toEqual([{ id: 'remove', status: 'unknown' }])
    expect(result.falseCompletion).toBe(true)
  })

  it('requires presented IDs rather than a data-only catalog receipt', async () => {
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
    await runtime.invokeForAgent('menu_get', { display: false })
    const demand: Demand[] = [{ id: 'whole-menu', kind: 'presentation', itemIds: dishes.map(item => item.id) }]
    expect(evaluateDemands(demand, { claimedComplete: true }).results).toEqual([{ id: 'whole-menu', status: 'unknown' }])
    expect(evaluateDemands(demand, { presentedItemIds: ['noodle'], claimedComplete: true }).falseCompletion).toBe(true)
    expect(evaluateDemands(demand, { presentedItemIds: ['noodle', 'noodle'], claimedComplete: true }).falseCompletion).toBe(true)
  })

  it('detects an extra item even when every requested item is present', async () => {
    let cart: CartSnapshot = { lines: [], total: 0, itemCount: 0, fulfillmentMode: undefined }
    const beforeCart = cart
    const runtime = createMenuToolRuntime({ menu: dishes, onAction: () => {}, onMenuSelection: () => {}, onCartChange: value => cart = value })
    await runtime.invokeForAgent('order_add_item', { itemId: 'noodle', quantity: 1 })
    await runtime.invokeForAgent('order_add_item', { itemId: 'dumpling', quantity: 1 })
    const result = evaluateDemands([{ id: 'wanted', kind: 'line', itemId: 'noodle', quantity: 1 }], { beforeCart, cart, claimedComplete: true })
    expect(result.results).toEqual([{ id: 'wanted', status: 'satisfied' }])
    expect(result.unexpectedChanges).toHaveLength(1)
    expect(result.falseCompletion).toBe(true)
  })
})
