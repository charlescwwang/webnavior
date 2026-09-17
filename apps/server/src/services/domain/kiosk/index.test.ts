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
  voiceConversationOnly: false,
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
      { id: 'content-manager', name: 'Content Manager', email: 'content-manager@example.com' },
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

  it('lists a site administrator’s sessions with device labels and interaction counts', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    await service.addMember({ siteId: site.id, userId: 'site-admin', role: 'site_admin' })
    const device = await service.createDevice({ siteId: site.id, label: 'COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const visitorSession = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })
    await service.appendInteractionEntry({ visitorSessionId: visitorSession.id, kind: 'asr_transcript', content: '一杯紅茶。' })
    await service.appendInteractionEntry({ visitorSessionId: visitorSession.id, kind: 'assistant_text', content: '好的，為您準備。' })

    const sessions = await service.listSiteVisitorSessions({ siteId: site.id, userId: 'site-admin' })

    expect(sessions).toEqual([
      expect.objectContaining({
        deviceId: device.id,
        deviceLabel: 'COUNTER-01',
        id: visitorSession.id,
        interactionCount: 2,
        presence: 'interactive',
      }),
    ])
  })

  it('does not let a viewer list a site’s visitor sessions', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    await service.addMember({ siteId: site.id, userId: 'viewer', role: 'viewer' })

    await expect(service.listSiteVisitorSessions({ siteId: site.id, userId: 'viewer' })).rejects.toThrow('Forbidden')
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

  it('preserves the published voice-only conversation policy for the assigned kiosk', async () => {
    const site = await service.createSite({ name: 'Voice-only Store' })
    const device = await service.createDevice({ siteId: site.id, label: 'COUNTER-VOICE-01', registrationMethod: 'development' })
    const draft = await service.saveProfileDraft({
      name: 'Voice-only ordering',
      siteId: site.id,
      snapshot: { ...profileSnapshot, voiceConversationOnly: true },
    })

    await service.publishProfileDraft({ draftId: draft.id, siteId: site.id })

    await expect(service.getDeviceProfile(device.id)).resolves.toMatchObject({
      snapshot: { voiceConversationOnly: true },
    })
  })

  it('allows a global administrator to inspect a transcript from every site', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    const device = await service.createDevice({ siteId: site.id, label: 'DEV-COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const visitorSession = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })

    const details = await service.getVisitorSessionForUser({ userId: 'system-admin', visitorSessionId: visitorSession.id })

    expect(details.session.siteId).toBe(site.id)
  })

  it('lists only the sites and devices an administrator may manage', async () => {
    const alphaSite = await service.createSite({ name: 'Alpha Store' })
    const betaSite = await service.createSite({ name: 'Beta Store' })
    const hiddenSite = await service.createSite({ name: 'Hidden Store' })
    await service.addMember({ siteId: betaSite.id, userId: 'site-admin', role: 'site_admin' })
    const betaDevice = await service.createDevice({ siteId: betaSite.id, label: 'COUNTER-02', registrationMethod: 'development' })
    await service.createDevice({ siteId: hiddenSite.id, label: 'HIDDEN-01', registrationMethod: 'development' })

    const siteAdminSites = await service.listManagedSites('site-admin')
    const systemAdminSites = await service.listManagedSites('system-admin')
    const managedDevices = await service.listSiteDevices({ siteId: betaSite.id, userId: 'site-admin' })

    expect(siteAdminSites.map(site => site.id)).toEqual([betaSite.id])
    expect(systemAdminSites.map(site => site.id)).toEqual([alphaSite.id, betaSite.id, hiddenSite.id])
    expect(managedDevices.map(device => device.id)).toEqual([betaDevice.id])
    await expect(service.listSiteDevices({ siteId: hiddenSite.id, userId: 'site-admin' })).rejects.toThrow('Forbidden')
  })

  it('requires device deactivation before soft deletion while retaining its visitor history', async () => {
    const site = await service.createSite({ name: 'POC Store' })
    await service.addMember({ siteId: site.id, userId: 'site-admin', role: 'site_admin' })
    const device = await service.createDevice({ siteId: site.id, label: 'COUNTER-01', registrationMethod: 'development' })
    const release = await service.createProfileRelease({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const session = await service.startVisitorSession({ deviceId: device.id, profileReleaseId: release.id, serviceId: 'restaurant-ordering' })
    await service.appendInteractionEntry({ visitorSessionId: session.id, kind: 'user_text', content: '保留這筆對話。' })

    await expect(service.deleteDevice({ deviceId: device.id, siteId: site.id, userId: 'site-admin' })).rejects.toThrow('disabled')

    await service.disableDevice({ deviceId: device.id, siteId: site.id, userId: 'site-admin' })
    await service.deleteDevice({ deviceId: device.id, siteId: site.id, userId: 'site-admin' })

    await expect(service.listSiteDevices({ siteId: site.id, userId: 'site-admin' })).resolves.toEqual([])
    await expect(db.query.kioskDevices.findFirst({ where: eq(schema.kioskDevices.id, device.id) })).resolves.toEqual(
      expect.objectContaining({ disabledAt: expect.any(Date), deletedAt: expect.any(Date) }),
    )
    await expect(db.query.kioskVisitorSessions.findFirst({ where: eq(schema.kioskVisitorSessions.id, session.id) })).resolves.toEqual(
      expect.objectContaining({ deviceId: device.id }),
    )
    await expect(db.query.kioskInteractionEntries.findMany({ where: eq(schema.kioskInteractionEntries.visitorSessionId, session.id) })).resolves.toHaveLength(1)
  })

  it('lets a content manager edit customer-facing draft fields without publishing or changing technical settings', async () => {
    const site = await service.createSite({ name: 'Content Store' })
    await service.addMember({ siteId: site.id, userId: 'content-manager', role: 'content_manager' })
    await service.saveProfileDraft({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })

    const capabilities = await service.getSiteManagementCapabilities({ siteId: site.id, userId: 'content-manager' })
    const draft = await service.saveContentProfileDraft({
      siteId: site.id,
      snapshot: {
        ...profileSnapshot,
        agentInstructions: '內容管理員不可覆寫這段系統設定。',
        characterName: '午餐助手',
        interactiveService: {
          ...profileSnapshot.interactiveService,
          title: '午餐點餐服務',
          url: 'https://attacker.example.com/should-not-apply',
        },
      },
    })

    expect(capabilities).toEqual({
      canEditExperience: true,
      canEditTechnicalSettings: false,
      canManageDevices: false,
      canPublishExperience: false,
    })
    expect(draft.name).toBe('Lunch menu')
    expect(draft.snapshot.characterName).toBe('午餐助手')
    expect(draft.snapshot.agentInstructions).toBe(profileSnapshot.agentInstructions)
    expect(draft.snapshot.interactiveService.title).toBe('午餐點餐服務')
    expect(draft.snapshot.interactiveService.url).toBe(profileSnapshot.interactiveService.url)
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

    const lunchDraft = await service.saveProfileDraft({ siteId: site.id, name: 'Lunch menu', snapshot: profileSnapshot })
    const release = await service.publishProfileDraft({ siteId: site.id, draftId: lunchDraft.id, actorUserId: 'system-admin' })

    const [firstProfile, secondProfile] = await Promise.all([
      service.getDeviceProfile(firstDevice.id),
      service.getDeviceProfile(secondDevice.id),
    ])
    expect(firstProfile).toEqual(expect.objectContaining({ id: release.id, snapshot: profileSnapshot }))
    expect(secondProfile).toEqual(expect.objectContaining({ id: release.id, snapshot: profileSnapshot }))

    const dinnerDraft = await service.saveProfileDraft({
      siteId: site.id,
      name: 'Dinner menu',
      snapshot: { ...profileSnapshot, greetingPrompt: '晚上好，想吃些什麼？' },
    })
    const laterRelease = await service.publishProfileDraft({ siteId: site.id, draftId: dinnerDraft.id })

    expect(release.snapshot.greetingPrompt).toBe('您好，想吃什麼？')
    expect(laterRelease.snapshot.greetingPrompt).toBe('晚上好，想吃些什麼？')
  })

  it('provisions a new site from the administrator default without changing existing sites', async () => {
    await service.saveOwnerExperienceTemplateDraft({
      ownerUserId: 'system-admin',
      name: '營運者預設體驗',
      snapshot: profileSnapshot,
    })
    const template = await service.publishOwnerExperienceTemplate({ ownerUserId: 'system-admin' })
    const firstSite = await service.provisionSite({ name: 'First Store', ownerUserId: 'system-admin' })
    const secondSite = await service.provisionSite({ name: 'Second Store', ownerUserId: 'system-admin' })

    const [firstProfile, secondProfile] = await Promise.all([
      service.getSiteProfile(firstSite.id),
      service.getSiteProfile(secondSite.id),
    ])
    expect(firstSite.ownerUserId).toBe('system-admin')
    expect(firstProfile.release).toMatchObject({ revision: 1, changeScope: 'template_seed', sourceTemplateReleaseId: template.id, snapshot: profileSnapshot })
    expect(secondProfile.release).toMatchObject({ revision: 1, sourceTemplateReleaseId: template.id })

    const siteDraft = await service.saveProfileDraft({
      siteId: firstSite.id,
      name: 'First Store custom',
      snapshot: { ...profileSnapshot, greetingPrompt: '歡迎來到第一店。' },
    })
    const siteRelease = await service.publishProfileDraft({ siteId: firstSite.id, draftId: siteDraft.id })
    expect(siteRelease).toMatchObject({ revision: 2, changeScope: 'site_override', parentSiteReleaseId: firstProfile.release?.id, sourceTemplateReleaseId: template.id })
    await expect(service.getOwnerExperienceTemplate('system-admin')).resolves.toMatchObject({ release: { id: template.id, revision: 1 } })
    await expect(service.getSiteProfile(secondSite.id)).resolves.toMatchObject({ release: { id: secondProfile.release?.id, revision: 1 } })
  })

  it('assigns a newly registered device to the site latest release', async () => {
    await service.saveOwnerExperienceTemplateDraft({ ownerUserId: 'system-admin', name: '預設', snapshot: profileSnapshot })
    await service.publishOwnerExperienceTemplate({ ownerUserId: 'system-admin' })
    const site = await service.provisionSite({ name: 'Ready Store', ownerUserId: 'system-admin' })
    const release = (await service.getSiteProfile(site.id)).release!
    const device = await service.createDevice({ siteId: site.id, label: 'COUNTER-01', registrationMethod: 'qr_code' })
    await expect(service.getDeviceProfile(device.id)).resolves.toMatchObject({ id: release.id, revision: 1 })
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
