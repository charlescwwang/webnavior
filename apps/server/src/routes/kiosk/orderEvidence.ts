import type { KioskService } from '../../services/domain/kiosk'
import type { createOrderEvidenceService } from '../../services/domain/kiosk-order-evidence'
import type { HonoEnv } from '../../types/hono'

import { orderEvidenceEnvelopeSchema, orderEvidenceMaxRequestBytes, orderEvidenceRegistrationSchema } from '@proj-airi/stage-shared/order-evidence'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { safeParse } from 'valibot'

import { createBadRequestError, createUnauthorizedError } from '../../utils/error'
import { kioskDeviceCookieName } from './index'

/** Device-authenticated archive routes do not call merchant or visitor-interaction endpoints. */
export function createOrderEvidenceRoutes(service: ReturnType<typeof createOrderEvidenceService>, kiosk: Pick<KioskService, 'resolveDeviceCredential'>) {
  const routes = new Hono<HonoEnv>()
  routes.use('*', bodyLimit({ maxSize: orderEvidenceMaxRequestBytes }))
  async function authenticate(cookie: string | undefined) {
    const device = cookie && await kiosk.resolveDeviceCredential(cookie)
    if (!device)
      throw createUnauthorizedError('A valid registered archival device is required')
    return device.id
  }
  routes.post('/order-evidence/operations', async (c) => {
    const deviceId = await authenticate(getCookie(c, kioskDeviceCookieName))
    const parsed = safeParse(orderEvidenceRegistrationSchema, await c.req.json().catch(() => null))
    if (!parsed.success)
      throw createBadRequestError('Invalid order evidence operation')
    return c.json(await service.register(deviceId, parsed.output), 201)
  })
  routes.post('/order-evidence', async (c) => {
    const deviceId = await authenticate(getCookie(c, kioskDeviceCookieName))
    const parsed = safeParse(orderEvidenceEnvelopeSchema, await c.req.json().catch(() => null))
    if (!parsed.success)
      throw createBadRequestError('Invalid order evidence envelope')
    return c.json(await service.save(deviceId, parsed.output), 201)
  })
  routes.get('/order-evidence/:evidenceId', async (c) => {
    const deviceId = await authenticate(getCookie(c, kioskDeviceCookieName))
    return c.json(await service.readForDevice(deviceId, c.req.param('evidenceId')))
  })
  return routes
}
