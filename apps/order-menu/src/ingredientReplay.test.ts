import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'
import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'
import type { SystemOneQuestion } from '../../server/src/services/domain/kiosk-system-one'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { createMenuToolRuntime } from './webmcp'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL

describe.skipIf(!replayUrl)('live ingredient choices with actual POS and WebMCP', () => {
  for (const scenario of [
    { transcript: '我不要豬肉的', exclude: ['pork'], include: [] },
    { transcript: '找不要豬肉的便當', exclude: ['pork'], include: [] },
    { transcript: '不要豬肉，也不要蛋', exclude: ['pork', 'egg'], include: [] },
    { transcript: '找不要豬肉但有雞肉的便當', exclude: ['pork'], include: ['chicken'] },
    { transcript: '有素食嗎？', exclude: ['pork', 'beef', 'chicken', 'seafood'], include: [], empty: true },
    { transcript: '推薦素食，不要蛋', exclude: ['pork', 'beef', 'chicken', 'seafood', 'egg'], include: [], empty: true },
  ]) {
    it(scenario.transcript, async () => {
      const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
      const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
      const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript: scenario.transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
      const invoke = async (state: string, questions: Record<string, SystemOneQuestion>) => {
        const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
        if (!response.ok)
          throw new Error(`Jev HTTP ${response.status}`)
        return await response.json() as { answers?: Record<string, unknown> }
      }
      const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, transcript: scenario.transcript, policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true, invoke })
      console.info(JSON.stringify({ transcript: scenario.transcript, snapshot, decision }))
      expect(decision).toMatchObject({ kind: 'FAST_ACTION', ingredientFilters: { excludeIngredients: scenario.empty ? scenario.exclude.filter(id => id === 'egg') : scenario.exclude, includeIngredients: scenario.include, ...(scenario.empty ? { dietary: 'vegetarian' } : {}) } })
      if (decision.kind !== 'FAST_ACTION')
        throw new Error('Expected a resolved ingredient operation.')
      expect(['intent:search-menu', 'intent:recommend']).toContain(decision.actionId)
      const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId, ingredientFilters: decision.ingredientFilters }) as { items: CatalogSnapshot['items'], availability: string, customerMessage: string }
      console.info(JSON.stringify({ transcript: scenario.transcript, result }))
      if (scenario.empty) {
        expect(result.items).toHaveLength(0)
        expect(result.availability).toBe('NONE')
        expect(result.customerMessage).toContain('目前沒有符合')
      }
      else {
        expect(result.items.length).toBeGreaterThan(0)
      }
      for (const item of result.items) {
        for (const id of scenario.exclude)
          expect(item.composition.ingredients).not.toContain(id)
        for (const id of scenario.include)
          expect(item.composition.ingredients).toContain(id)
      }
    }, 70_000)
  }
  it('does not execute a menu operation when part of the requested filter is unsupported', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const transcript = '有低鈉又不要豬肉的餐點嗎？'
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, transcript, policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true, invoke: async (state, questions) => {
      const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
      if (!response.ok)
        throw new Error(`Jev HTTP ${response.status}`)
      return await response.json() as { answers?: Record<string, unknown> }
    } })
    console.info(JSON.stringify({ transcript, snapshot, decision }))
    expect(decision.kind).toBe('NEEDS_ASSISTANT')
  }, 70_000)
})
