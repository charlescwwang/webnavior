import type { KioskRoutesOptions } from '../../../server/src/routes/kiosk'
import type { FastPathDecision } from './kiosk-fast-path'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { menu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { mockDB } from '../../../server/src/libs/mock-db'
import { createKioskRoutes } from '../../../server/src/routes/kiosk'
import { createKioskService } from '../../../server/src/services/domain/kiosk'
import { runFastPath } from './kiosk-fast-path'
import { questionReceiptFrom } from './questionPresentation'

import * as schema from '../../../server/src/schemas'

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 core-cart.
async function createHarness(choice: 'intent:add-item' | 'intent:search-menu', weakAnswer = false) {
  const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [], price: 80 }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
    const tools = body.tools as Array<{ function: { parameters: { properties: { choice: { enum: string[] } } } } }>
    const selected = tools[0]!.function.parameters.properties.choice.enum.find(id => id.includes(':quantity:2')) ?? choice
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_ordering_intent', arguments: JSON.stringify({ choice: selected }) } }] } }] })
  })
  const systemOne: NonNullable<KioskRoutesOptions['systemOne']> = {
    isEnabled: async () => true,
    maxActionCandidates: async () => 22,
    getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }),
    decide: vi.fn<NonNullable<KioskRoutesOptions['systemOne']>['decide']>(async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map((key) => {
      const choices = Object.keys(questions[key]!.criteria ?? {})
      let choice: string | undefined
      if (key === 'admission')
        choice = 'SERVICE'
      else if (key === 'purpose')
        choice = JSON.parse(_state).customerUtterance === '兩份' ? 'ANSWER' : 'SINGLE'
      else if (key === 'family')
        choice = 'MENU'
      else if (key === 'review')
        choice = 'SATISFIED'
      else if (key === 'operation')
        choice = choices.find(id => id.includes('quantity'))
      if (!choice || !choices.includes(choice))
        throw new Error(`Unexpected fixture question: ${key}`)
      return [key, { choice, confidence: key === 'family' ? 0.2025 : weakAnswer && key === 'purpose' && JSON.parse(_state).customerUtterance === '兩份' ? 0.4515 : 0.99 }]
    })) })),
  }
  const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(await mockDB(schema)), llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'synthetic-main' }, systemOne })
  const enrolled = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const decisions: FastPathDecision[] = []
  const sources: string[] = []
  const execute = async (transcript: string) => await runFastPath({ transcript, onTrace: (trace) => {
    if (trace.decisionSource)
      sources.push(trace.decisionSource)
  }, isEnabled: async () => true, decide: async (request) => {
    const response = await app.request('/interaction-decisions', { method: 'POST', headers, body: JSON.stringify(request) })
    expect(response.status).toBe(200)
    const decision = await response.json() as FastPathDecision
    decisions.push(decision)
    return decision
  }, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.test' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  return { runtime, execute, complete, decisions, sources }
}

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 core-cart.
it.each([false, true])('resumes the owned quantity question after Main skill handoff (weak answer=%s)', async (weakAnswer) => {
  const { runtime, execute, complete, decisions, sources } = await createHarness('intent:add-item', weakAnswer)
  const first = await execute('我要水餃')
  expect(first.kind).toBe('FAST_ACTION')
  if (first.kind !== 'FAST_ACTION')
    throw new Error('Expected the browser-owned missing-slot flow')
  const question = questionReceiptFrom(first.result)
  expect(question?.purpose).toBe('item-configuration')
  expect(question?.question).toContain('幾份')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  await runtime.invoke('kiosk_dialogue_presented', { questionId: question!.questionId, content: question!.question })
  const second = await execute('兩份')
  expect(second.kind).toBe('FAST_ACTION')
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.cart.lines).toMatchObject([{ itemId: 'dumplings', quantity: 2 }])
  expect(context.cart.itemCount).toBe(2)
  expect(decisions[0]).toMatchObject({ resolvedBy: 'main-skill', modelCalls: 3 })
  expect(decisions[0]).not.toHaveProperty('confidence')
  expect(sources).toContain('main-skill')
  expect(complete).toHaveBeenCalledTimes(weakAnswer ? 2 : 1)
  expect(JSON.stringify(complete.mock.calls[0]![0].body.messages)).toContain('ordering@1')
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 core-cart.
it('uses the same skill handoff for an inquiry without creating a purchase or quantity question', async () => {
  const { runtime, execute, complete } = await createHarness('intent:search-menu')
  const result = await execute('有水餃嗎')
  expect(result.kind).toBe('FAST_ACTION')
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.cart.itemCount).toBe(0)
  expect(context.waitingFor).toBeUndefined()
  expect(context.presentation?.itemIds).toEqual(['dumplings'])
  expect(complete).toHaveBeenCalledOnce()
})
