import type { CatalogSnapshot } from '../../../order-menu-server/src/domain/contracts'

import { describe, expect, it, vi } from 'vitest'

import { createPosSimulator } from '../../../order-menu-server/src/simulator'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { runFastPath } from './kiosk-fast-path'

// The Kiosk owns host rerouting; exercise it with the real menu runtime under
// the host's compilation boundary, without invoking a provider or submitting POS orders.
describe('retained meal configuration across topic changes', () => {
  it('connects host clarification, yes/no and quantity completion across different dishes', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    const calls: string[] = []
    const turn = (transcript: string) => runFastPath({
      transcript,
      isEnabled: async () => true,
      decide: async request => request.transcript === '泰式酸辣魚便當'
        ? { kind: 'NEEDS_CLARIFICATION', modelQuestions: 1 }
        : { kind: 'FAST_ACTION', modelQuestions: 1, actionId: request.candidates.find(choice => request.transcript === '對' ? choice.id.endsWith(':yes') : choice.description.includes(request.transcript === '一份' ? '1 份' : '2 份'))!.id },
      webMcp: {
        tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })),
        execute: (tool, input) => {
          calls.push(tool.name)
          if (tool.name === 'kiosk_fast_path_context')
            return runtime.invoke('kiosk_fast_path_context', input)
          if (tool.name === 'kiosk_fast_path_clarify')
            return runtime.invoke('kiosk_fast_path_clarify', input)
          if (tool.name === 'kiosk_fast_path_execute')
            return runtime.invoke('kiosk_fast_path_execute', input)
          throw new Error(`Unexpected tool ${tool.name}`)
        },
      },
    })
    expect(await turn('泰式酸辣魚便當')).toMatchObject({ kind: 'CLARIFICATION', prompt: '您是要點泰式酸辣魚便當嗎？' })
    expect(calls).toEqual(['kiosk_fast_path_context', 'kiosk_fast_path_clarify'])
    expect(await turn('對')).toMatchObject({ kind: 'FAST_ACTION', result: { customerMessage: '請問泰式酸辣魚便當要幾份？' } })
    expect(await turn('一份')).toMatchObject({ kind: 'FAST_ACTION', result: { pendingCustomerChoice: { question: '請問水餃要幾份？' } } })
    expect(await turn('兩份')).toMatchObject({ kind: 'FAST_ACTION', result: { cart: { itemCount: 3 } } })
  })
  it('reroutes successive dish/category requests and finishes the retained meal without executing cancellation', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items.map(item => ({ ...item, optionGroups: [] })), onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃' })
    await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
    for (const transcript of ['牛肉麵', '便當', '牛肉麵']) {
      const calls: Array<{ name: string, input: Record<string, unknown> }> = []
      const decide = vi.fn()
        .mockResolvedValueOnce({ kind: 'NEEDS_ASSISTANT', reason: 'NEW_REQUEST', modelQuestions: 1 })
        .mockResolvedValueOnce({ kind: 'FAST_ACTION', actionId: transcript === '牛肉麵' ? 'intent:add-item' : 'intent:search-menu', modelQuestions: 1, ...(transcript === '便當' ? { ingredientFilters: { excludeIngredients: [], includeIngredients: [] } } : {}) })
      const result = await runFastPath({
        transcript,
        isEnabled: async () => true,
        decide,
        webMcp: {
          tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })),
          execute: (tool, input) => {
            calls.push({ name: tool.name, input })
            if (tool.name === 'kiosk_fast_path_context')
              return runtime.invoke('kiosk_fast_path_context', input)
            if (tool.name === 'kiosk_fast_path_execute')
              return runtime.invoke('kiosk_fast_path_execute', input)
            throw new Error(`Unexpected tool: ${tool.name}`)
          },
        },
      })
      expect(result.kind).toBe('FAST_ACTION')
      expect(decide).toHaveBeenCalledTimes(2)
      expect(calls[1]).toMatchObject({ name: 'kiosk_fast_path_context', input: { transcript, newRequestQuestionId: expect.any(String) } })
      expect(calls.some(call => String(call.input.candidateId).endsWith(':cancel'))).toBe(false)
      expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
      expect(await runtime.invoke('kiosk_interaction_state')).toMatchObject({ waitingFor: { question: '請問紅燒牛肉麵要幾份？' } })
    }
    const quantity = await runtime.invoke('kiosk_fast_path_context', { transcript: '一份' }) as { candidates: Array<{ id: string, description: string }> }
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: quantity.candidates.find(choice => choice.description.includes('1 份'))!.id })).toMatchObject({ cart: { itemCount: 1, lines: [{ itemId: 'beef-noodle-soup', quantity: 1 }] } })
  })
})
