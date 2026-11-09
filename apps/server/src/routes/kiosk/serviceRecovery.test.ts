import type { KioskRoutesOptions } from '.'
import type { DecisionStageResult } from '../../services/domain/kiosk-interaction-decision/contracts'

import { serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'

import { createKioskRoutes } from '.'
import { mockDB } from '../../libs/mock-db'
import { createKioskService } from '../../services/domain/kiosk'

import * as schema from '../../schemas'

it('delivers Main recovery start over HTTP before the provider runs and finishes with the original Jev count', async () => {
  let finish!: (response: Response) => void
  const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(({ body }) => {
    if (JSON.stringify(body.tools).includes('resolve_service_scope'))
      return Promise.resolve(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: '{"recipient":"kiosk","choice":"CLARIFY_SERVICE"}' } }] } }] }))
    return new Promise<Response>(resolve => finish = resolve)
  })
  const systemOne: NonNullable<KioskRoutesOptions['systemOne']> = {
    isEnabled: async () => true,
    maxActionCandidates: async () => 22,
    getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }),
    decide: async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: ({ admission: 'UNCERTAIN' } as Record<string, string>)[key], confidence: key === 'route' || key === 'speech' ? 0.2 : 0.99 }])) }),
  }
  const kioskService = createKioskService(await mockDB(schema))
  const readSettings = kioskService.getDeviceSettings
  // These scenarios exercise background admission, so select that policy
  // explicitly instead of relying on the current background-off device default.
  vi.spyOn(kioskService, 'getDeviceSettings').mockImplementation(async (deviceId) => {
    const settings = await readSettings(deviceId)
    return { ...settings, effective: { ...settings.effective, backgroundSpeechMode: 'enforce' } }
  })
  const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'mock-main' }, systemOne }))
  const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const beganAt = performance.now()
  let response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '請幫我確認需求', segmented: true, candidates: [], decisionState: { phase: 'ordering' }, includeTrace: true }) })
  let result: DecisionStageResult = await response.json() as DecisionStageResult
  let jevQuestions = 0
  while (result.kind === 'DECISION_PROGRESS') {
    jevQuestions++
    response = await app.request(`/api/kiosk/interaction-decisions/${result.continuationId}`, { method: 'POST', headers, body: '{}' })
    result = await response.json() as DecisionStageResult
  }
  expect(result).toMatchObject({ kind: 'SERVICE_RECOVERY_PROGRESS', stage: 'adjudication', status: 'started' })
  expect(performance.now() - beganAt).toBeLessThan(1000)
  expect(complete).not.toHaveBeenCalled()
  if (result.kind !== 'SERVICE_RECOVERY_PROGRESS')
    throw new Error('Expected recovery start')
  const waiting = app.request(`/api/kiosk/interaction-decisions/${result.continuationId}`, { method: 'POST', headers, body: '{}' })
  await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
  finish(Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: '{"choice":"REQUEST"}' } }] } }] }))
  result = await (await waiting).json() as DecisionStageResult
  expect(result).toMatchObject({ kind: 'SERVICE_RECOVERY_PROGRESS', status: 'completed', admission: 'service' })
  if (result.kind !== 'SERVICE_RECOVERY_PROGRESS')
    throw new Error('Expected recovery completion')
  result = await (await app.request(`/api/kiosk/interaction-decisions/${result.continuationId}`, { method: 'POST', headers, body: '{}' })).json() as DecisionStageResult
  const final = result
  expect(complete).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(complete.mock.calls[0]![0].body.tools)).toContain('resolve_service_request')
  expect(JSON.stringify(complete.mock.calls[1]![0].body.tools)).toContain('resolve_service_scope')
  expect(final).toMatchObject({ kind: 'SERVICE_CLARIFICATION', modelCalls: jevQuestions, modelQuestions: jevQuestions, recovery: { status: 'completed' } })
  expect(final).not.toHaveProperty('actionId')
})

// Report: reported-20261103-background-service-clarification-loop in orderingIncidents.ts.
it.each(['BACKGROUND', 'UNCERTAIN', 'FAILURE'])('runs HTTP admission even with an active cue and leaves %s silent', async (scope) => {
  const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: JSON.stringify({ recipient: 'uncertain', admission: 'uncertain', disposition: 'abstain', requestKind: 'clarification-answer' }) } }] } }] }))
  const decide = vi.fn(async (_state: string, questions: Record<string, unknown>) => {
    if (scope === 'FAILURE')
      throw new Error('Injected Jev failure; not proof of service intent')
    return { answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: scope, confidence: 0.99 }])) }
  })
  const systemOne: NonNullable<KioskRoutesOptions['systemOne']> = { isEnabled: async () => true, maxActionCandidates: async () => 22, getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }), decide }
  const kioskService = createKioskService(await mockDB(schema))
  const readSettings = kioskService.getDeviceSettings
  // These scenarios exercise background admission, so select that policy
  // explicitly instead of relying on the current background-off device default.
  vi.spyOn(kioskService, 'getDeviceSettings').mockImplementation(async (deviceId) => {
    const settings = await readSettings(deviceId)
    return { ...settings, effective: { ...settings.effective, backgroundSpeechMode: 'enforce' } }
  })
  const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService, llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'mock-main' }, systemOne }))
  const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '它卻出現了第四個字', candidates: [], decisionState: { phase: 'ordering', serviceClarification: { questionId: 'q', question: '想查什麼？', sourceUtterance: '幫我', contextKey: serviceContextKey({ phase: 'ordering' }), expiresAt: Date.now() + 30000 } } }) })
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result).toHaveProperty('kind', scope === 'BACKGROUND' ? 'IGNORE' : 'UNAVAILABLE')
  expect(result).not.toHaveProperty('question')
  expect(result).not.toHaveProperty('actionId')
  expect(decide).toHaveBeenCalledOnce()
  expect(Object.keys(decide.mock.calls[0]![1])).toEqual(['admission'])
  expect(complete).toHaveBeenCalledTimes(scope === 'BACKGROUND' ? 0 : 1)
})

// Report: this chat, Nov08 — the HTTP schema silently dropped two Menu revision fields.
it.each(['recommendation', 'seating'] as const)('preserves the %s revision through HTTP recovery', async (field) => {
  const complete: KioskRoutesOptions['llmGateway']['complete'] = async ({ body }) => {
    const tools = body.tools as Array<{ function: { name: string, parameters: { properties: Record<string, unknown> } } }>
    const tool = tools[0]!.function
    const argumentsValue = tool.name === 'resolve_service_scope'
      ? { recipient: 'kiosk', choice: 'CLARIFY_SERVICE' }
      : 'choice' in tool.parameters.properties
        ? { choice: 'REQUEST' }
        : { ...('recipient' in tool.parameters.properties ? { recipient: 'kiosk' } : {}), admission: 'service', disposition: 'assistant' }
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: tool.name, arguments: JSON.stringify(argumentsValue) } }] } }] })
  }
  const systemOne: NonNullable<KioskRoutesOptions['systemOne']> = {
    isEnabled: async () => true,
    maxActionCandidates: async () => 22,
    getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }),
    decide: async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: 'UNCERTAIN', confidence: 0.99 }])) }),
  }
  const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(await mockDB(schema)), llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'mock-main' }, systemOne }))
  const enrolled = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const keys: string[] = []
  for (const version of [1, 2]) {
    const revisions = { menu: 0, cart: 0, checkout: 0, selectedItem: 0, recommendation: 1, seating: 1, [field]: version }
    const state = { phase: 'ordering', revisions }
    const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ transcript: '請幫我確認需求', candidates: [], decisionState: state }) })
    expect(response.status).toBe(200)
    const result = await response.json() as { recovery?: { contextKey?: string } }
    expect(result.recovery?.contextKey).toBe(serviceContextKey(state))
    expect(result.recovery?.contextKey).toBeDefined()
    keys.push(result.recovery!.contextKey!)
  }
  expect(keys[1]).not.toBe(keys[0])
})
