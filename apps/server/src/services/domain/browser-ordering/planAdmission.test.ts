import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { mockDB } from '../../../libs/mock-db'
import { createKioskService } from '../kiosk'
import { browserPlanSchema } from './contracts'

import * as schema from '../../../schemas'

// Full persistence/claim boundary, without an LLM or merchant operation.
it('consumes each publicly issued batch item exactly once and rejects cross-reception claims', async () => {
  const db = await mockDB(schema)
  const kiosk = createKioskService(db)
  const { device } = await kiosk.registerDevelopmentDevice({ registrationCode: '123456' })
  const profile = await kiosk.getDeviceProfile(device.id)
  const session = await kiosk.startVisitorSession({ deviceId: device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
  const user = await kiosk.appendInteractionEntry({ visitorSessionId: session.id, kind: 'user_text', content: '雞腿飯兩份、蛋花湯一份' })
  await kiosk.appendInteractionEntry({ visitorSessionId: session.id, kind: 'assistant_text', content: '', metadata: { browserAuthority: { source: 'main', userEntryId: user.id, readOnly: false }, toolCalls: [{ id: 'batch', function: { name: 'add_items_to_cart', arguments: JSON.stringify({ items: [{ name: '雞腿飯', quantity: 2 }, { name: '蛋花湯', quantity: 1 }] }) } }] } })
  const makePlan = (name: string, quantity: number) => parse(browserPlanSchema, { source: 'main', toolName: 'browser_cart_add', arguments: JSON.stringify({ version: 'cart', productRef: name, quantity, note: '', selection: { version: 'spec', variantRef: '', choices: [] } }), effect: { transcript: user.content, action: 'add', description: `新增${name}`, serving: { productName: name, variantName: '', options: [] }, deltas: [{ name, quantity, kind: 'product', mode: 'increase' }] } })
  const chicken = makePlan('雞腿飯', 2)
  const soup = makePlan('蛋花湯', 1)
  expect((await kiosk.claimBrowserPlan({ deviceId: device.id, visitorSessionId: session.id, plan: chicken })).choice).toBe('ALLOW')
  expect((await kiosk.claimBrowserPlan({ deviceId: device.id, visitorSessionId: session.id, plan: soup })).choice).toBe('ALLOW')
  expect((await kiosk.claimBrowserPlan({ deviceId: device.id, visitorSessionId: session.id, plan: chicken })).choice).toBe('CLARIFY')
  await kiosk.endDeviceVisitorSession({ deviceId: device.id, visitorSessionId: session.id, state: 'cancelled' })
  const next = await kiosk.startVisitorSession({ deviceId: device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
  expect((await kiosk.claimBrowserPlan({ deviceId: device.id, visitorSessionId: next.id, plan: soup })).choice).toBe('CLARIFY')
})
