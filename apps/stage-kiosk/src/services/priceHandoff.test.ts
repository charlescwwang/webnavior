import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import type { MenuToolName } from '../../../order-menu/src/webmcp'
import type { SystemOneQuestion } from '../../../server/src/services/domain/kiosk-system-one'

import { describe, expect, it, vi } from 'vitest'

import { menu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { decideInteraction } from '../../../server/src/services/domain/kiosk-interaction-decision'
import { resolvePriceHandoff } from '../../../server/src/services/domain/kiosk-interaction-decision/priceResolution'
import { conversationDecisionStateFrom, runFastPath } from './kiosk-fast-path'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL
const policy = { decisionInstruction: '', storeInstruction: '' }

async function replay(previous: number, upper: number, live = false) {
  // Keep prices out of dish names to reproduce the reported productResolution:none.
  const runtime = createMenuToolRuntime({
    menu: [{ price: 80, name: '水餃' }, { price: 110, name: '蔬菜湯' }, { price: 120, name: '燙青菜' }, { price: 130, name: '牛肉麵' }].map(({ price, name }) => ({ ...menu[0]!, id: `dish-${price}`, name, aliases: [], price, optionGroups: [] })),
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
  })
  const tools: ServiceTool[] = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://localhost:5166' }))
  await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: previous })
  const transcript = `${upper}以下有什麼`
  const result = await runFastPath({
    transcript,
    isEnabled: async () => true,
    webMcp: { tools, execute: (tool, input) => runtime.invoke(tool.name as MenuToolName, input) },
    decide: request => decideInteraction({ ...request, policy, invoke: async (state, questions: Record<string, SystemOneQuestion>) => {
      if (live) {
        const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
        if (!response.ok)
          throw new Error(`Jev HTTP ${response.status}`)
        const responseBody = await response.json() as { answers?: Record<string, unknown> }
        console.info(JSON.stringify({ questionNames: Object.keys(questions), answers: responseBody.answers }))
        return responseBody
      }
      return { answers: { route: { choice: 'MENU_QUERY', confidence: 0.95 }, price: { choice: 'UPPER_INCLUSIVE', confidence: 0.95 } } }
    } }),
  })
  if (live)
    console.info(JSON.stringify({ previous, upper, kind: result.kind, reason: result.reason, constraints: result.decisionState?.constraints }))
  let receipt: unknown
  if (result.kind === 'FAST_ACTION') {
    receipt = result.result
  }
  else {
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    const state = conversationDecisionStateFrom(result.decisionState, result)
    expect(state).toMatchObject({ readOnly: true, constraints: { price: { maxPrice: upper }, unresolvedPrice: false } })
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', transcript, taskId: 'price-handoff', expectedMenuRevision: state!.menuRevision, readOnly: state!.readOnly, constraints: { ...state!.constraints?.price, unresolvedPrice: state!.constraints?.unresolvedPrice } })
    // Broad browsing uses the current explicit-action contract; menu_get is
    // reserved for named verification and data-only catalog evidence.
    receipt = await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: upper })
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'price-handoff' })
  }
  const offered = receipt as { pendingCustomerChoice?: { questionId: string, purpose: string } }
  if (offered.pendingCustomerChoice?.purpose === 'menu-query-scope')
    receipt = await runtime.invoke('kiosk_query_scope', { questionId: offered.pendingCustomerChoice.questionId, choice: 'CATALOG' })
  const prices = [80, 110, 120, 130].filter(price => price <= upper).slice(0, 3)
  expect(receipt).toMatchObject({ appliedPriceConditions: { maxPrice: upper }, items: prices.map(price => ({ price })) })
  expect(receipt).not.toHaveProperty('ok', false)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
}

describe('price handoff across Jev, Kiosk and Menu', () => {
  // Report: this chat, 2026-10-20: 「有水餃或牛肉麵嗎？多少錢？」
  // returns UNCERTAIN_FILTER and appears not to reach Main.
  it('allows Main to read actual prices after an uncertain information-only price decision', async () => {
    const runtime = createMenuToolRuntime({ menu: [{ id: 'dumplings', name: '水餃', price: 80 }, { id: 'beef-noodles', name: '牛肉麵', price: 130 }].map(item => ({ ...menu[0]!, ...item, aliases: [], optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const transcript = '有水餃或牛肉麵嗎？多少錢？'
    const recordedAnswers = {
      'route': { choice: 'intent:add-item', confidence: 0.5779 },
      'requestPurpose': { choice: 'INQUIRY', confidence: 0.9761 },
      'service': { choice: 'REQUEST', confidence: 0.9974 },
      'filterRequirement': { choice: 'COVERED', confidence: 0.7492 },
      'filterPresence': { choice: 'NO_FILTER', confidence: 0.6902 },
      'price': { choice: 'INFORMATION', confidence: 0.359 },
      'ingredient:beef': { choice: 'NONE', confidence: 0.9428 },
    }
    const complete = vi.fn(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_price_choice', arguments: '{"choice":"INFORMATION"}' } }] } }] }))
    const result = await runFastPath({ transcript, isEnabled: async () => true, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'http://localhost:5166' })), execute: (tool, input) => runtime.invoke(tool.name as MenuToolName, input) }, decide: async request => resolvePriceHandoff(await decideInteraction({ ...request, policy, invoke: async () => ({ answers: recordedAnswers }) }), transcript, request.decisionState?.priceEvidence, complete) })
    expect(result).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_FILTER' })
    expect(complete).toHaveBeenCalledOnce()
    const state = conversationDecisionStateFrom(result.decisionState, result)
    expect(state).toMatchObject({ readOnly: true })
    expect(state).not.toHaveProperty('requireMenuRead')
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', transcript, taskId: 'price-information', expectedMenuRevision: state!.menuRevision, readOnly: state!.readOnly, constraints: { ...state!.constraints?.price, unresolvedPrice: state!.constraints?.unresolvedPrice } })
    expect(await runtime.invokeForAgent('menu_get', { queries: ['水餃', '牛肉麵'] })).toMatchObject({ items: [{ id: 'dumplings', price: 80 }, { id: 'beef-noodles', price: 130 }] })
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })

  // Report: this chat, session 7hsfZq4mzTs1YZvCTCdXg entries24–34, 2026-10-19.
  it.each([{ previous: 99, upper: 120 }, { previous: 120, upper: 99 }])('replaces $previous with $upper before the first Agent lookup', async ({ previous, upper }) => {
    await replay(previous, upper)
  })
})

describe.skipIf(!replayUrl)('live price handoff across Jev, Kiosk and Menu', () => {
  it.each([{ previous: 99, upper: 120 }, { previous: 120, upper: 99 }])('executes the updated $upper limit after $previous', async ({ previous, upper }) => {
    await replay(previous, upper, true)
  }, 60_000)
})
