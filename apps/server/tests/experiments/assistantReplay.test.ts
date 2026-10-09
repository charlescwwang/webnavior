import type { HonoEnv } from '../../src/types/hono'

import { readFileSync } from 'node:fs'

import { Hono } from 'hono'
import { expect, it } from 'vitest'

import { mockDB } from '../../src/libs/mock-db'
import { createKioskRoutes } from '../../src/routes/kiosk'
import { createKioskService } from '../../src/services/domain/kiosk'

import * as schema from '../../src/schemas'

// Synthetic provider recording only. Replays do not access credentials/network,
// change the frozen benchmark, or pretend to be fresh model measurements.
it('replays recorded successful Google tool envelopes through the actual scratch route without500', async () => {
  const path = new URL('../../../../test_prompt/turnClassifierPoc/results/assistant-gemma16-profile.jsonl', import.meta.url)
  const rows = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, any>)
  const calls = rows.filter(row => row.type === 'generation' && row.tag.endsWith('/tool-agent') && row.body.messages.length === 2)
  expect(calls.length).toBeGreaterThanOrEqual(3)
  const db = await mockDB(schema)
  let data: unknown
  const app = new Hono<HonoEnv>().onError((error, c) => c.json({ error: error.message, cause: error.cause instanceof Error ? error.cause.message : undefined }, 500)).route('/api/kiosk', createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), runtimeModelPolicy: { modelFor: async () => 'offline-replay' }, llmGateway: { complete: async () => Response.json(data) } }))
  const registered = await app.request('/api/kiosk/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"registrationCode":"483920"}' })
  const headers = { 'Content-Type': 'application/json', 'Cookie': registered.headers.get('Set-Cookie')!.split(';')[0]! }
  for (const call of calls) {
    data = call.data
    const started = await app.request('/api/kiosk/visitor-sessions', { method: 'POST', headers, body: '{"serviceId":"development-ordering-service"}' })
    const { session } = await started.json() as { session: { id: string } }
    const response = await app.request(`/api/kiosk/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: call.body.messages.at(-1).content, decisionState: { phase: 'ordering' }, tools: call.body.tools }) })
    const output = await response.json()
    expect({ status: response.status, output }, call.tag).toMatchObject({ status: 200 })
  }
})
