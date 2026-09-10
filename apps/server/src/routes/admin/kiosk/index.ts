import type { KioskProfileSnapshot } from '../../../schemas/kiosk'
import type { KioskService } from '../../../services/domain/kiosk'
import type { HonoEnv } from '../../../types/hono'

import { Hono } from 'hono'
import { integer, minValue, number, object, pipe, safeParse, string } from 'valibot'

import { authGuard } from '../../../middlewares/auth'
import { KioskProfileSnapshotSchema } from '../../../services/domain/kiosk'
import { createBadRequestError } from '../../../utils/error'

const profileDraftSchema = object({
  name: string(),
  snapshot: KioskProfileSnapshotSchema,
})

const interactionRetentionSchema = object({
  days: pipe(number(), integer(), minValue(0)),
})

/**
 * Minimal Profile management for the kiosk POC.
 *
 * Global administrators may manage every Site. Site administrators may manage
 * only their own Site; the domain service keeps that authorization rule next
 * to the Site membership data rather than depending on a global HTTP guard.
 */
export function createAdminKioskRoutes(kioskService: KioskService) {
  return new Hono<HonoEnv>()
    .use('*', authGuard)
    .get('/sites', async (c) => {
      return c.json(await kioskService.listManagedSites(c.get('user')!.id))
    })
    .get('/sites/:siteId/devices', async (c) => {
      return c.json(await kioskService.listSiteDevices({
        siteId: c.req.param('siteId'),
        userId: c.get('user')!.id,
      }))
    })
    .get('/sites/:siteId/profile', async (c) => {
      await kioskService.assertCanManageSite({ siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      return c.json(await kioskService.getSiteProfile(c.req.param('siteId')))
    })
    .get('/visitor-sessions/:visitorSessionId', async (c) => {
      const transcript = await kioskService.getVisitorSessionForUser({
        userId: c.get('user')!.id,
        visitorSessionId: c.req.param('visitorSessionId'),
      })
      return c.json(transcript)
    })
    .put('/sites/:siteId/interaction-retention', async (c) => {
      const body = await c.req.json().catch(() => null)
      const result = safeParse(interactionRetentionSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid kiosk interaction retention policy', 'INVALID_REQUEST', result.issues)

      const site = await kioskService.setSiteInteractionRetentionDays({
        actorUserId: c.get('user')!.id,
        days: result.output.days,
        siteId: c.req.param('siteId'),
      })
      return c.json(site)
    })
    .put('/sites/:siteId/profile-draft', async (c) => {
      const body = await c.req.json().catch(() => null)
      const result = safeParse(profileDraftSchema, body)
      if (!result.success)
        throw createBadRequestError('Invalid kiosk Profile draft', 'INVALID_REQUEST', result.issues)

      await kioskService.assertCanManageSite({ siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      const draft = await kioskService.saveProfileDraft({
        siteId: c.req.param('siteId'),
        name: result.output.name,
        snapshot: result.output.snapshot as KioskProfileSnapshot,
      })
      return c.json(draft)
    })
    .post('/sites/:siteId/profile-draft/publish', async (c) => {
      await kioskService.assertCanManageSite({ siteId: c.req.param('siteId'), userId: c.get('user')!.id })
      const release = await kioskService.publishProfileDraft({
        siteId: c.req.param('siteId'),
        actorUserId: c.get('user')!.id,
      })
      return c.json(release, 201)
    })
}
