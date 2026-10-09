import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'
import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'
import type { SystemOneQuestion } from '../../server/src/services/domain/kiosk-system-one'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { createMenuToolRuntime } from './webmcp'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL

describe.skipIf(!replayUrl)('live bounded recommendation batches', () => {
  it('does not repeat displayed dishes when asking 還有沒有其他推薦', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const presentations: string[][] = []
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: presentation => presentations.push(presentation.itemIds) })
    // Minimized artificial replay: establish a real first batch, then let the
    // actual decision service choose the follow-up; do not force recommend-more.
    const first = await runtime.invoke('menu_recommend') as { customerMessage: string, items: Array<{ id: string }> }
    const transcript = '還有沒有其他推薦'
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const invoke = async (state: string, questions: Record<string, SystemOneQuestion>) => {
      const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'airi-recommendation-diagnosis/1' },
        body: JSON.stringify({ state, questions }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok)
        throw new Error(`Jev HTTP ${response.status}`)
      return await response.json() as { answers?: Record<string, unknown> }
    }
    const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, conversation: { messages: [{ role: 'user', content: '請推薦幾樣餐點' }, { role: 'assistant', content: first.customerMessage }] }, transcript, invoke, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' } })
    expect(decision.kind).toBe('FAST_ACTION')
    if (decision.kind !== 'FAST_ACTION')
      throw new Error(JSON.stringify(decision))
    const next = await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId }) as { items: Array<{ id: string }>, decisionTrace: unknown }
    const before = first.items.map(item => item.id)
    const after = next.items.map(item => item.id)
    expect(after.length).toBeGreaterThan(0)
    for (const id of after)
      expect(before).not.toContain(id)
    expect(presentations.at(-1)).toEqual(after)
  }, 90_000)

  it('routes broad browsing and requests for everything through non-repeating recommendation batches', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const messages: Array<{ role: 'user' | 'assistant', content: string }> = []
    const seen = new Set<string>()
    const invoke = async (state: string, questions: Record<string, SystemOneQuestion>) => {
      const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
      if (!response.ok)
        throw new Error(`Jev HTTP ${response.status}`)
      return await response.json() as { answers?: Record<string, unknown> }
    }
    // Artificial fixture only: do not send recorded customer conversations.
    for (const [index, transcript] of ['你們供應哪些餐點？', '我想看全部品項', '還有別的選擇嗎？'].entries()) {
      const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
      const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, conversation: { messages }, transcript, invoke, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' } })
      expect(decision.kind).toBe('FAST_ACTION')
      if (decision.kind !== 'FAST_ACTION')
        throw new Error(JSON.stringify(decision))
      expect(index === 0 ? ['intent:search-menu', 'intent:recommend'] : ['intent:search-menu', 'intent:recommend-more']).toContain(decision.actionId)
      const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId }) as { customerMessage: string, items: Array<{ id: string }> }
      console.info(JSON.stringify({ transcript, action: decision.actionId, items: result.items.map(item => item.id) }))
      expect(result.items).toHaveLength(index === 2 ? 1 : 3)
      expect(result).toMatchObject({ presentation: { kind: 'recommendation' }, decisionTrace: { operationPlan: { toolName: 'menu_recommend' } } })
      expect(result).not.toHaveProperty('continuation')
      for (const item of result.items) {
        expect(seen.has(item.id)).toBe(false)
        seen.add(item.id)
      }
      messages.push({ role: 'user', content: transcript }, { role: 'assistant', content: result.customerMessage })
    }
    expect(seen.size).toBe(7)
  }, 120_000)

  it('recommends, offers alternatives, and preserves exclusions without a full-menu lookup', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const messages: Array<{ role: 'user' | 'assistant', content: string }> = []
    const seen = new Set<string>()
    const invoke = async (state: string, questions: Record<string, SystemOneQuestion>) => {
      const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
      if (!response.ok)
        throw new Error(`Jev HTTP ${response.status}`)
      return await response.json() as { answers?: Record<string, unknown> }
    }
    for (const [index, transcript] of ['推薦吃什麼？', '有其他的嗎？', '再換一批推薦'].entries()) {
      const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
      const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, conversation: { messages }, transcript, invoke, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' } })
      console.info(JSON.stringify({ transcript, candidates: snapshot.candidates, decision }))
      expect(decision.kind).toBe('FAST_ACTION')
      if (decision.kind !== 'FAST_ACTION')
        throw new Error(JSON.stringify(decision))
      expect(decision.actionId).toBe(index === 0 ? 'intent:recommend' : 'intent:recommend-more')
      const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId }) as { customerMessage: string, items: Array<{ id: string }>, decisionTrace: unknown }
      console.info(JSON.stringify({ transcript, phase: snapshot.phase, candidates: snapshot.candidates.map(candidate => candidate.id), decision: decision.actionId, trace: result.decisionTrace, items: result.items.map(item => item.id) }))
      expect(result.items.length).toBeLessThanOrEqual(3)
      for (const item of result.items) {
        expect(seen.has(item.id)).toBe(false)
        seen.add(item.id)
      }
      messages.push({ role: 'user', content: transcript }, { role: 'assistant', content: result.customerMessage })
    }
    expect(seen.size).toBe(7)
    await runtime.invoke('menu_recommend', { excludeIngredients: ['pork'] })
    const transcript = '有其他的嗎？'
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, conversation: { messages: [{ role: 'user', content: '推薦不要豬肉的餐點' }, { role: 'assistant', content: '推薦椒麻雞便當、泰式酸辣魚便當、牛肉麵。' }] }, transcript, invoke, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' } })
    console.info(JSON.stringify({ transcript, snapshot, decision }))
    expect(decision).toMatchObject({ kind: 'FAST_ACTION', actionId: 'intent:recommend-more' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend-more' })).toMatchObject({ items: [], appliedFilters: { excludeIngredients: ['pork'] } })
  }, 120_000)
})
