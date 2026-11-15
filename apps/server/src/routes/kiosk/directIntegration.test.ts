import type { HonoEnv } from '../../types/hono'

import { Buffer } from 'node:buffer'

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'

import { createKioskRoutes } from '.'
import { mockDB } from '../../libs/mock-db'
import { createKioskService } from '../../services/domain/kiosk'
import { createKioskSystemOneService } from '../../services/domain/kiosk-system-one'
import { createEnvelopeCrypto } from '../../utils/envelope-crypto'

import * as schema from '../../schemas'

// Report: this chat; verify the real profile → HTTP → decision → provider seam.
it.each(['dasein', 'openai-decisions'] as const)('selects a current table through the saved %s profile with one model request', async (implementation) => {
  const db = await mockDB(schema)
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (implementation === 'dasein')
      return Response.json({ answers: body.questions.ready ? { ready: { noul: 1 } } : { action: { choice: 'start', confidence: 0.95 } } })
    const question = body.questions[0]
    const choice = question.name === 'ready' ? 'READY' : 'start'
    return Response.json({ answers: [{ name: question.name, type: 'choice', choice, confidence: 0.95, probabilities: question.choices.map((option: { value: string }) => ({ value: option.value, probability: option.value === choice ? 0.96 : 0.04 / (question.choices.length - 1) })) }] })
  })
  const systemOne = createKioskSystemOneService({ db, envelopeCrypto: createEnvelopeCrypto({ masterKey: Buffer.alloc(32, 4) }), fetchImpl })
  const profile = await systemOne.save({ name: 'synthetic', implementation, baseURL: implementation === 'dasein' ? 'http://jev.test' : 'https://api.openai.com/v1', modelId: 'gpt-6-luna', plaintextKey: 'synthetic-only', timeoutMs: 5000 })
  await systemOne.readiness(profile.id)
  await systemOne.activate(profile.id)
  fetchImpl.mockClear()
  const complete = vi.fn(async () => Response.json({ choices: [] }))
  const service = createKioskService(db)
  const app = new Hono<HonoEnv>().route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: service, llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'test-main' }, systemOne }))
  const enrollment = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"registrationCode":"483920"}' })
  const cookie = enrollment.headers.get('Set-Cookie')!.split(';')[0]!
  const { device } = await enrollment.json() as { device: { id: string } }
  const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' }
  const input = { transcript: '開始點餐', includeTrace: true, candidates: [{ id: 'start', description: '使用目前B3開始點餐' }], decisionState: { phase: 'selecting_table', tableSelection: { choices: ['櫃台取餐', 'B3 吧檯'], selectedTable: 'B3 吧檯' } } }
  const response = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify(input) })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ kind: 'FAST_ACTION', actionId: 'start', modelCalls: 1, trace: { decisionState: expect.stringContaining('B3') } })
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(complete).not.toHaveBeenCalled()
  expect(String(fetchImpl.mock.calls[0][0])).toBe(implementation === 'dasein' ? 'http://jev.test/v1/systemone' : 'https://api.openai.com/v1/decisions')

  // A client cannot turn off a device's enforced recipient policy.
  await db.update(schema.kioskDevices).set({ settings: { version: 1, overrides: { backgroundSpeechMode: 'enforce' } } }).where(eq(schema.kioskDevices.id, device.id))
  fetchImpl.mockClear()
  fetchImpl.mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    return Response.json(implementation === 'dasein' ? { answers: { recipient: { choice: 'OTHER', confidence: 0.95 } } } : { answers: [{ name: 'recipient', type: 'choice', choice: 'OTHER', confidence: 0.95, probabilities: body.questions[0].choices.map((option: { value: string }) => ({ value: option.value, probability: option.value === 'OTHER' ? 0.96 : 0.02 })) }] })
  })
  const background = await app.request('/api/kiosk/interaction-decisions', { method: 'POST', headers, body: JSON.stringify({ ...input, transcript: '小王，你要開始嗎？', decisionState: { ...input.decisionState, backgroundSpeechMode: 'off' } }) })
  expect(await background.json()).toMatchObject({ kind: 'IGNORE' })
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(complete).not.toHaveBeenCalled()
})
