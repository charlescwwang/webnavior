import type { KioskRoutesOptions } from '.'
import type { DecisionStageResult } from '../../services/domain/kiosk-interaction-decision/contracts'

import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'

import { createKioskRoutes } from '.'
import { mockDB } from '../../libs/mock-db'
import { createKioskService } from '../../services/domain/kiosk'

import * as schema from '../../schemas'

it('delivers Main recovery start over HTTP before the provider runs and finishes with the original Jev count', async () => {
  let finish!: (response: Response) => void
  const complete = vi.fn(() => new Promise<Response>(resolve => finish = resolve))
  const systemOne: NonNullable<KioskRoutesOptions['systemOne']> = {
    isEnabled: async () => true,
    maxActionCandidates: async () => 22,
    getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }),
    decide: async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, { choice: ({ route: 'INCOMPLETE', service: 'REQUEST', speech: 'REQUEST', serviceRequest: 'UNCERTAIN' } as Record<string, string>)[key], confidence: key === 'route' || key === 'speech' ? 0.2 : 0.99 }])) }),
  }
  const app = new Hono().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(await mockDB(schema)), llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'mock-main' }, systemOne }))
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
  const final = await (await app.request(`/api/kiosk/interaction-decisions/${result.continuationId}`, { method: 'POST', headers, body: '{}' })).json()
  expect(final).toMatchObject({ kind: 'NEEDS_ASSISTANT', reason: 'UNCERTAIN_OPERATION', modelCalls: jevQuestions, modelQuestions: jevQuestions, recovery: { status: 'completed' } })
  expect(final).not.toHaveProperty('actionId')
})
