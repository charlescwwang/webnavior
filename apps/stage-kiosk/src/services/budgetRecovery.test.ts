import type { KioskRoutesOptions } from '../../../server/src/routes/kiosk'
import type { KioskDecisionState } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'
import type { FastPathDecision } from './kiosk-fast-path'

import { conversationContextSchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { menu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { mockDB } from '../../../server/src/libs/mock-db'
import { createKioskRoutes } from '../../../server/src/routes/kiosk'
import { createKioskService } from '../../../server/src/services/domain/kiosk'
import { runFastPath } from './kiosk-fast-path'
import { createServiceClarificationWindow } from './questionPresentation'

import * as schema from '../../../server/src/schemas'

// Field report: docs/research/2026-10-26-kiosk-conversation-error-audit.md,
// Oct30 Session eCda22nNnyhWzB5rMVvsM, seq660–695. The original provider
// response was not retained; this reconstructs the admitted-answer boundary.
it.each([true, false].flatMap(clarified => ['有其他不超過兩百元的嗎', '200元以下有其他的嗎', '不超過200元'].map(transcript => ({ clarified, transcript }))))('qualifies price for an admitted request (clarified=$clarified): $transcript', async ({ clarified, transcript }) => {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'noodles', name: '紅燒牛肉麵', aliases: [], category: '麵食', price: 150, optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  await runtime.invoke('menu_recommend', { category: '麵食', maxPrice: 200 })
  const state = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState
  const window = createServiceClarificationWindow()
  if (clarified)
    window.present({ questionId: 'budget-clarification', question: '請再說一次您想詢問或調整的內容。', sourceUtterance: '有其他的嗎', contextKey: serviceContextKey(state), expiresAt: Date.now() + 30000 })
  const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
    const price = JSON.stringify(body.tools).includes('resolve_price_choice')
    const args = price ? { choice: 'UPPER_INCLUSIVE' } : { admission: 'service', disposition: 'assistant', requestKind: 'new-request' }
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: price ? 'resolve_price_choice' : 'resolve_service_request', arguments: JSON.stringify(args) } }] } }] })
  })
  const systemOne: NonNullable<KioskRoutesOptions['systemOne']> = {
    isEnabled: async () => true,
    maxActionCandidates: async () => 22,
    getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }),
    decide: vi.fn<NonNullable<KioskRoutesOptions['systemOne']>['decide']>(async (_state, questions) => {
      if (clarified)
        throw new Error('An active service clarification goes directly to review.')
      return { answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: key === 'admission' ? 'SERVICE' : 'UNCERTAIN', confidence: 0.99 }])) }
    }),
  }
  const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(await mockDB(schema)), llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'synthetic-main' }, systemOne })
  const enrolled = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  expect(enrolled.status).toBe(201)
  const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const result = await runFastPath({ transcript, isEnabled: async () => true, serviceClarification: current => window.current(current), decide: async (request) => {
    const response = await app.request('/interaction-decisions', { method: 'POST', headers, body: JSON.stringify(request) })
    expect(response.status).toBe(200)
    return await response.json() as FastPathDecision
  }, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.example' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(systemOne.decide).toHaveBeenCalledTimes(clarified ? 0 : 2)
  expect(result.decisionState?.constraints).toMatchObject({ price: { maxPrice: 200 }, unresolvedPrice: false })
  expect(complete).toHaveBeenCalledTimes(clarified ? 2 : 1)
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'budget-recovery', transcript, expectedMenuRevision: context.revisions.menu, constraints: { ...result.decisionState?.constraints?.price, unresolvedPrice: result.decisionState?.constraints?.unresolvedPrice === true }, readOnly: true })
  const receipt = await runtime.invokeForAgent('menu_recommend', { action: 'update', maxPrice: 200 })
  expect(receipt).toMatchObject({ appliedPriceConditions: { maxPrice: 200 }, items: [{ id: 'noodles', price: 150 }] })
  expect(receipt).not.toHaveProperty('ok', false)
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
})
