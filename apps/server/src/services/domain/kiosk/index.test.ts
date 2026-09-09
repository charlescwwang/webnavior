import type { Database } from '../../../libs/db'
import type { KioskProfileSnapshot } from '../../../schemas/kiosk'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { createKioskService } from '.'
import { mockDB } from '../../../libs/mock-db'

import * as schema from '../../../schemas'

const profileSnapshot: KioskProfileSnapshot = {
  version: 1,
  assistanceReminderPrompt: '需要時簡短詢問是否需要協助。',
  characterName: '點餐助手',
  agentInstructions: '協助訪客點餐。',
  greetingPrompt: '您好，想吃什麼？',
  interactiveService: {
    id: 'restaurant-ordering',
    title: '點餐服務',
    description: '測試點餐服務。',
    url: 'https://example.com/order',
  },
  surveyUrl: 'https://example.com/survey',
}

describe('kiosk service', () => {
  let db: Database
  let service: ReturnType<typeof createKioskService>

  beforeEach(async () => {
    db = await mockDB(schema)
    service = createKioskService(db)

    await db.insert(schema.user).values([
      { id: 'system-admin', name: 'System Admin', email: 'system-admin@example.com', role: 'admin' },
      { id: 'site-admin', name: 'Site Admin', email: 'site-admin@example.com' },
      { id: 'viewer', name: 'Viewer', email: 'viewer@example.com' },
      { id: 'other-site-admin', name: 'Other Site Admin', email: 'other-site-admin@example.com' },
    ])
  })

  it('allows a site administrator to read complete transcripts for their site', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    await service.addMember({ siteId: site.id, userId: 'site-admin', role: 'site_admin' })
    const device = await service.createDevice({ siteId: site.id, label: 'DEV-COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const visitorSession = await service.startVisitorSession({
      deviceId: device.id,
      profileReleaseId: release.id,
      serviceId: 'restaurant-ordering',
    })

    await service.appendInteractionEntry({
      visitorSessionId: visitorSession.id,
      kind: 'asr_transcript',
      content: '我要一份牛肉麵，謝謝。',
    })

    const details = await service.getVisitorSessionForUser({ userId: 'site-admin', visitorSessionId: visitorSession.id })

    expect(details.session.id).toBe(visitorSession.id)
    expect(details.entries).toEqual([
      expect.objectContaining({
        content: '我要一份牛肉麵，謝謝。',
        kind: 'asr_transcript',
        sequence: 1,
      }),
    ])
  })

  it('rejects a viewer and a different site administrator before exposing a transcript', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    const otherSite = await service.createSite({ name: 'Other Store' })
    await service.addMember({ siteId: site.id, userId: 'viewer', role: 'viewer' })
    await service.addMember({ siteId: otherSite.id, userId: 'other-site-admin', role: 'site_admin' })
    const device = await service.createDevice({ siteId: site.id, label: 'DEV-COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const visitorSession = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })

    await expect(service.getVisitorSessionForUser({ userId: 'viewer', visitorSessionId: visitorSession.id })).rejects.toThrow('Forbidden')
    await expect(service.getVisitorSessionForUser({ userId: 'other-site-admin', visitorSessionId: visitorSession.id })).rejects.toThrow('Forbidden')
  })

  it('rejects a visitor session that names a service outside the published Profile allowlist', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    const device = await service.createDevice({ siteId: site.id, label: 'DEV-COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })

    await expect(service.startVisitorSession({
      deviceId: device.id,
      profileReleaseId: release.id,
      serviceId: 'unpublished-service',
    })).rejects.toThrow('not published')
  })

  it('allows a global administrator to inspect a transcript from every site', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    const device = await service.createDevice({ siteId: site.id, label: 'DEV-COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const visitorSession = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })

    const details = await service.getVisitorSessionForUser({ userId: 'system-admin', visitorSessionId: visitorSession.id })

    expect(details.session.siteId).toBe(site.id)
  })

  it('keeps transcript and iframe events in their append order', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    const device = await service.createDevice({ siteId: site.id, label: 'DEV-COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const visitorSession = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })

    const transcript = await service.appendInteractionEntry({
      visitorSessionId: visitorSession.id,
      kind: 'asr_transcript',
      content: '我要一份牛肉麵。',
    })
    const serviceEvent = await service.appendInteractionEntry({
      visitorSessionId: visitorSession.id,
      kind: 'service_event',
      content: 'activity',
    })

    expect(transcript.sequence).toBe(1)
    expect(serviceEvent.sequence).toBe(2)
  })

  it('publishes an immutable draft and changes the assigned Profile for every Site device', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    const firstDevice = await service.createDevice({ siteId: site.id, label: 'COUNTER-01', registrationMethod: 'development' })
    const secondDevice = await service.createDevice({ siteId: site.id, label: 'COUNTER-02', registrationMethod: 'development' })

    await service.saveProfileDraft({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const release = await service.publishProfileDraft({ siteId: site.id, actorUserId: 'system-admin' })

    const [firstProfile, secondProfile] = await Promise.all([
      service.getDeviceProfile(firstDevice.id),
      service.getDeviceProfile(secondDevice.id),
    ])
    expect(firstProfile).toEqual(expect.objectContaining({ id: release.id, snapshot: profileSnapshot }))
    expect(secondProfile).toEqual(expect.objectContaining({ id: release.id, snapshot: profileSnapshot }))

    await service.saveProfileDraft({
      siteId: site.id,
      name: 'Dinner menu',
      snapshot: { ...profileSnapshot, greetingPrompt: '晚上好，想吃些什麼？' },
    })
    const laterRelease = await service.publishProfileDraft({ siteId: site.id })

    expect(release.snapshot.greetingPrompt).toBe('您好，想吃什麼？')
    expect(laterRelease.snapshot.greetingPrompt).toBe('晚上好，想吃些什麼？')
  })

  it('removes completed visitor sessions after their captured retention deadline together with interaction entries', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    const device = await service.createDevice({ siteId: site.id, label: 'DEV-COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const session = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })
    await service.appendInteractionEntry({ visitorSessionId: session.id, kind: 'user_text', content: '測試保存期。' })
    await service.endDeviceVisitorSession({ deviceId: device.id, state: 'completed', visitorSessionId: session.id })
    await db.update(schema.kioskVisitorSessions).set({ expiresAt: new Date('2026-01-01T00:00:00.000Z') }).where(eq(schema.kioskVisitorSessions.id, session.id))

    await expect(service.purgeExpiredVisitorSessions(new Date('2026-03-01T00:00:00.000Z'))).resolves.toBe(1)
    await expect(db.query.kioskVisitorSessions.findFirst({ where: eq(schema.kioskVisitorSessions.id, session.id) })).resolves.toBeUndefined()
    await expect(db.query.kioskInteractionEntries.findMany({ where: eq(schema.kioskInteractionEntries.visitorSessionId, session.id) })).resolves.toEqual([])
  })

  it('captures the Site retention policy when creating a session', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    const device = await service.createDevice({ siteId: site.id, label: 'DEV-COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const firstSession = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })

    await service.setSiteInteractionRetentionDays({ actorUserId: 'system-admin', days: 0, siteId: site.id })
    const secondSession = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })

    expect(firstSession.expiresAt.getTime()).toBeGreaterThan(secondSession.expiresAt.getTime())
  })

  it('only lets a system administrator change the retention policy', async () => {
    const site = await service.createSite({ name: 'POC Store' })

    await expect(service.setSiteInteractionRetentionDays({ actorUserId: 'viewer', days: 30, siteId: site.id })).rejects.toThrow('Forbidden')
    await expect(service.setSiteInteractionRetentionDays({ actorUserId: 'system-admin', days: 30, siteId: site.id })).resolves.toEqual(
      expect.objectContaining({ interactionRetentionDays: 30 }),
    )
  })
})
