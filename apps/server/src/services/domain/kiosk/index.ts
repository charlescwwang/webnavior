import type { DeviceSettingKey, DeviceSettings, DeviceSettingsSnapshot, KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'

import type { Database } from '../../../libs/db'
import type { KioskInteractionEntryKind, KioskMediaCapturePolicy, KioskMemberRole, KioskPerformanceProfile, KioskProfileSnapshot, KioskRegistrationMethod, KioskVisitorSessionState } from '../../../schemas/kiosk'
import type { KioskAgentInteractionState } from '../kiosk-agent-interaction'

import { createHash, randomBytes } from 'node:crypto'

import { defaultDeviceSettingsValues, resolveDeviceSettings } from '@proj-airi/kiosk-proactive'
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { boolean, literal, maxLength, minLength, object, optional, picklist, pipe, safeParse, string, url } from 'valibot'

import { createConflictError, createForbiddenError, createNotFoundError } from '../../../utils/error'
import { assertDetectionZone, parseSettingsChange } from './deviceSettings'

import * as schema from '../../../schemas'

/** Inputs that create persistent kiosk configuration and interaction records. */
export interface KioskService {
  /** Device identity must already be authenticated by the transport. */
  getDeviceSettings: (deviceId: string) => Promise<DeviceSettingsSnapshot>
  /** Central and local writes share authorization, optimistic concurrency, and audit. */
  updateDeviceSettings: (input: { deviceId: string, siteId: string, userId: string, source: 'admin' | 'local', body: unknown }) => Promise<DeviceSettingsSnapshot>
  /** Adds a user to a site's management scope. */
  addMember: (input: { siteId: string, userId: string, role: KioskMemberRole }) => Promise<typeof schema.kioskSiteMembers.$inferSelect>
  /** Allows only a global administrator or the named site's administrator to manage configuration. */
  assertCanManageSite: (input: { siteId: string, userId: string }) => Promise<void>
  /** Returns the management actions the account may take for a single site. */
  getSiteManagementCapabilities: (input: { siteId: string, userId: string }) => Promise<KioskSiteManagementCapabilities>
  /** Appends one transcript turn or interaction event with a session-local sequence. */
  appendInteractionEntry: (input: {
    visitorSessionId: string
    kind: KioskInteractionEntryKind
    content: string
    metadata?: Record<string, unknown>
  }) => Promise<typeof schema.kioskInteractionEntries.$inferSelect>
  /** Appends a device-originated record only when its session belongs to that device. */
  appendDeviceInteraction: (input: {
    content: string
    deviceId: string
    kind: KioskInteractionEntryKind
    metadata?: Record<string, unknown>
    visitorSessionId: string
  }) => Promise<typeof schema.kioskInteractionEntries.$inferSelect>
  /** Replaces compact, session-local Agent context after verifying device ownership. */
  updateDeviceAgentInteraction: (input: { deviceId: string, interaction: KioskAgentInteractionState, visitorSessionId: string }) => Promise<typeof schema.kioskVisitorSessions.$inferSelect>
  /** Creates a kiosk browser installation owned by a site. */
  createDevice: (input: { siteId: string, label: string, registrationMethod: KioskRegistrationMethod }) => Promise<typeof schema.kioskDevices.$inferSelect>
  /** Stores an immutable configuration snapshot for one site. */
  createProfileRelease: (input: { siteId: string, name: string, snapshot: KioskProfileSnapshot }) => Promise<typeof schema.kioskProfileReleases.$inferSelect>
  /** Creates the root management scope for kiosk configuration and data. */
  createSite: (input: { interactionRetentionDays?: number, name: string, slug?: string }) => Promise<typeof schema.kioskSites.$inferSelect>
  /** Creates a store from the operator's latest published default experience. */
  provisionSite: (input: { interactionRetentionDays?: number, name: string, ownerUserId: string, slug?: string }) => Promise<typeof schema.kioskSites.$inferSelect>
  /** Permanently removes one Site and every configuration/device record it owns. System administrators only. */
  deleteSite: (input: { siteId: string, userId: string }) => Promise<void>
  /** Soft-deletes a previously disabled device while retaining every visitor and audit record. */
  deleteDevice: (input: { deviceId: string, siteId: string, userId: string }) => Promise<void>
  /** Permanently removes selected visitor sessions and all records attached to them. */
  deleteVisitorSessions: (input: { siteId: string, userId: string, visitorSessionIds: string[] }) => Promise<string[]>
  /** Revokes a device's credentials so it can no longer bootstrap or start customer sessions. */
  disableDevice: (input: { deviceId: string, siteId: string, userId: string }) => Promise<void>
  /** Restores a previously disabled device and its existing browser credential. */
  enableDevice: (input: { deviceId: string, siteId: string, userId: string }) => Promise<void>
  /** Returns a complete transcript only when the caller has transcript-read permission for its site. */
  getVisitorSessionForUser: (input: {
    userId: string
    visitorSessionId: string
  }) => Promise<{
    entries: (typeof schema.kioskInteractionEntries.$inferSelect)[]
    session: typeof schema.kioskVisitorSessions.$inferSelect
  }>
  /** Returns the Profile-bound transcript only to the device that owns the visitor session. */
  getVisitorSessionForDevice: (input: { deviceId: string, visitorSessionId: string }) => Promise<{
    entries: (typeof schema.kioskInteractionEntries.$inferSelect)[]
    session: typeof schema.kioskVisitorSessions.$inferSelect
  }>
  /** Ends a device's active visitor session with its terminal reason. */
  endDeviceVisitorSession: (input: {
    deviceId: string
    state: Exclude<KioskVisitorSessionState, 'active'>
    visitorSessionId: string
  }) => Promise<typeof schema.kioskVisitorSessions.$inferSelect>
  /** Starts the durable interaction record for a device using a same-site Profile release. */
  startVisitorSession: (input: {
    deviceId: string
    profileReleaseId: string
    serviceId: string
  }) => Promise<typeof schema.kioskVisitorSessions.$inferSelect>
  /** Creates a development-only device and returns its one opaque browser credential. */
  registerDevelopmentDevice: (input: { registrationCode: string }) => Promise<{
    credential: string
    device: typeof schema.kioskDevices.$inferSelect
  }>
  /** Resolves an unrevoked opaque credential to the device it authenticates. */
  resolveDeviceCredential: (credential: string) => Promise<typeof schema.kioskDevices.$inferSelect | undefined>
  /** True when a development credential already belongs to the current local test Site. */
  isCurrentDevelopmentDevice: (deviceId: string) => Promise<boolean>
  /** Retrieves the currently assigned immutable Profile release for one kiosk device. */
  getDeviceProfile: (deviceId: string) => Promise<typeof schema.kioskProfileReleases.$inferSelect | undefined>
  /** Lists the Sites the account may administer without exposing other Site identifiers. */
  listManagedSites: (userId: string) => Promise<(typeof schema.kioskSites.$inferSelect)[]>
  /** Lists devices only after verifying the caller may access their Site's management summary. */
  listSiteDevices: (input: { siteId: string, userId: string }) => Promise<(typeof schema.kioskDevices.$inferSelect)[]>
  /** Lists the Site's retained visitor sessions without exposing their transcript content. */
  listSiteVisitorSessions: (input: { deviceId?: string, siteId: string, userId: string }) => Promise<Array<{
    createdAt: Date
    deviceId: string
    deviceLabel: string
    endedAt: Date | null
    id: string
    interactionCount: number
    /** Greeting-only records retain their evidence but are normally excluded from training review. */
    presence: 'greeting_only' | 'interactive' | 'empty'
    serviceId: string
    state: KioskVisitorSessionState
  }>>
  /** Retrieves the immutable Profile snapshot that a persisted session references. */
  getProfileRelease: (profileReleaseId: string) => Promise<typeof schema.kioskProfileReleases.$inferSelect | undefined>
  /** Returns selectable drafts and the currently assigned release for a Site management screen. */
  getSiteProfile: (siteId: string) => Promise<{
    drafts: (typeof schema.kioskProfileDrafts.$inferSelect)[]
    release: typeof schema.kioskProfileReleases.$inferSelect | undefined
  }>
  /** Returns the operator's editable baseline and its newest immutable release. */
  getOwnerExperienceTemplate: (ownerUserId: string) => Promise<{
    draft: typeof schema.kioskOwnerExperienceDrafts.$inferSelect | undefined
    release: typeof schema.kioskOwnerExperienceReleases.$inferSelect | undefined
  }>
  /** Creates or updates a selectable draft after validating its POC configuration shape. */
  saveProfileDraft: (input: { id?: string, name: string, siteId: string, snapshot: KioskProfileSnapshot }) => Promise<typeof schema.kioskProfileDrafts.$inferSelect>
  saveOwnerExperienceTemplateDraft: (input: { id?: string, name: string, ownerUserId: string, snapshot: KioskProfileSnapshot }) => Promise<typeof schema.kioskOwnerExperienceDrafts.$inferSelect>
  /** Applies only customer-facing content from a content manager's draft submission. */
  saveContentProfileDraft: (input: { siteId: string, snapshot: KioskProfileSnapshot }) => Promise<typeof schema.kioskProfileDrafts.$inferSelect>
  /** Changes the policy used to calculate expiry for future visitor sessions. */
  setSiteInteractionRetentionDays: (input: { actorUserId: string, days: number, siteId: string }) => Promise<typeof schema.kioskSites.$inferSelect>
  /** Replaces the Site's internal POC camera-evidence policy. */
  setSiteMediaCapturePolicy: (input: { actorUserId: string, policy: KioskMediaCapturePolicy, siteId: string }) => Promise<typeof schema.kioskSites.$inferSelect>
  /** Resolves the policy after a kiosk device has already been authenticated. */
  getSiteMediaCapturePolicy: (siteId: string) => Promise<KioskMediaCapturePolicy>
  getSiteProactiveVlmEnabled: (siteId: string) => Promise<boolean>
  setSiteProactiveVlmEnabled: (input: { actorUserId: string, enabled: boolean, siteId: string }) => Promise<typeof schema.kioskSites.$inferSelect>
  getSitePerformanceProfile: (siteId: string) => Promise<KioskPerformanceProfile>
  setSitePerformanceProfile: (input: { actorUserId: string, profile: KioskPerformanceProfile, siteId: string }) => Promise<typeof schema.kioskSites.$inferSelect>
  getSiteVoiceVadSettings: (siteId: string) => Promise<KioskVoiceVadSettings>
  setSiteVoiceVadSettings: (input: { actorUserId: string, settings: KioskVoiceVadSettings, siteId: string }) => Promise<typeof schema.kioskSites.$inferSelect>
  /** Publishes a selected draft as a new immutable release and assigns it to every Site device. */
  publishProfileDraft: (input: { actorUserId?: string, draftId: string, siteId: string }) => Promise<typeof schema.kioskProfileReleases.$inferSelect>
  publishOwnerExperienceTemplate: (input: { ownerUserId: string }) => Promise<typeof schema.kioskOwnerExperienceReleases.$inferSelect>
  /** Removes expired visitor sessions and their cascading interaction entries. */
  purgeExpiredVisitorSessions: (now: Date) => Promise<number>
}

/** The actions a signed-in person may take for one Webnavior site. */
export interface KioskSiteManagementCapabilities {
  canEditExperience: boolean
  canEditTechnicalSettings: boolean
  canManageDevices: boolean
  canPublishExperience: boolean
}

/** Runtime contract shared by kiosk Profile draft writes and immutable releases. */
export const KioskProfileSnapshotSchema = object({
  assistanceReminderPrompt: pipe(string(), minLength(1), maxLength(2_000)),
  agentInstructions: pipe(string(), minLength(1), maxLength(8_000)),
  characterName: pipe(string(), minLength(1), maxLength(120)),
  characterAsset: optional(object({
    format: picklist(['live2d_zip', 'vrm']),
    id: pipe(string(), minLength(1), maxLength(120)),
    name: pipe(string(), minLength(1), maxLength(255)),
    sha256: pipe(string(), minLength(64), maxLength(64)),
  })),
  sceneBackground: optional(object({
    format: picklist(['jpeg', 'png', 'webp']),
    id: pipe(string(), minLength(1), maxLength(120)),
    name: pipe(string(), minLength(1), maxLength(255)),
    sha256: pipe(string(), minLength(64), maxLength(64)),
  })),
  characterCard: optional(object({
    description: pipe(string(), maxLength(8_000)),
    personality: pipe(string(), maxLength(8_000)),
    postHistoryInstructions: pipe(string(), maxLength(8_000)),
    scenario: pipe(string(), maxLength(8_000)),
    systemPrompt: pipe(string(), maxLength(8_000)),
  })),
  idleMotion: optional(object({
    format: literal('vrma'),
    id: pipe(string(), minLength(1), maxLength(120)),
    name: pipe(string(), minLength(1), maxLength(255)),
    sha256: pipe(string(), minLength(64), maxLength(64)),
  })),
  motionPack: optional(object({
    acknowledge: optional(object({ format: literal('vrma'), id: pipe(string(), minLength(1), maxLength(120)), name: pipe(string(), minLength(1), maxLength(255)), sha256: pipe(string(), minLength(64), maxLength(64)) })),
    greeting: optional(object({ format: literal('vrma'), id: pipe(string(), minLength(1), maxLength(120)), name: pipe(string(), minLength(1), maxLength(255)), sha256: pipe(string(), minLength(64), maxLength(64)) })),
    idle: optional(object({ format: literal('vrma'), id: pipe(string(), minLength(1), maxLength(120)), name: pipe(string(), minLength(1), maxLength(255)), sha256: pipe(string(), minLength(64), maxLength(64)) })),
    listening: optional(object({ format: literal('vrma'), id: pipe(string(), minLength(1), maxLength(120)), name: pipe(string(), minLength(1), maxLength(255)), sha256: pipe(string(), minLength(64), maxLength(64)) })),
    presentRecommendations: optional(object({ format: literal('vrma'), id: pipe(string(), minLength(1), maxLength(120)), name: pipe(string(), minLength(1), maxLength(255)), sha256: pipe(string(), minLength(64), maxLength(64)) })),
    thinking: optional(object({ format: literal('vrma'), id: pipe(string(), minLength(1), maxLength(120)), name: pipe(string(), minLength(1), maxLength(255)), sha256: pipe(string(), minLength(64), maxLength(64)) })),
  })),
  greetingPrompt: pipe(string(), minLength(1), maxLength(2_000)),
  interactiveService: object({
    description: pipe(string(), maxLength(500)),
    id: pipe(string(), minLength(1), maxLength(120)),
    title: pipe(string(), minLength(1), maxLength(120)),
    url: pipe(string(), url(), maxLength(2_000)),
  }),
  surveyUrl: pipe(string(), url(), maxLength(2_000)),
  version: literal(1),
  voiceConversationOnly: boolean(),
})

const developmentProfile: KioskProfileSnapshot = {
  version: 1,
  assistanceReminderPrompt: '若顧客停留一段時間，請簡短詢問是否需要協助點餐；不要重複主動招呼。',
  characterName: '點餐助手',
  agentInstructions: '以親切、精簡的方式協助訪客完成點餐；不確定時先釐清需求。',
  greetingPrompt: '您好，今天想吃些什麼？我可以協助您挑選。',
  interactiveService: {
    id: 'development-ordering-service',
    title: '開發中的互動點餐服務',
    description: '請在發布前換成實際的點餐服務網址。',
    url: 'http://localhost:5166',
  },
  surveyUrl: 'https://example.com/kiosk-feedback',
  voiceConversationOnly: false,
}

/**
 * Owns kiosk Site access and the durable, ordered interaction record.
 *
 * Callers cross one Interface for both authorization and visitor-session
 * data: Site administrators and global administrators may read transcripts;
 * viewers deliberately cannot because a complete transcript can contain
 * customer-provided personal information.
 */
export function createKioskService(db: Database): KioskService {
  async function createSite(input: { interactionRetentionDays?: number, name: string, slug?: string }) {
    if (input.interactionRetentionDays !== undefined)
      assertRetentionDays(input.interactionRetentionDays)
    const [site] = await db.insert(schema.kioskSites).values(input).returning()
    return site
  }

  async function provisionSite(input: { interactionRetentionDays?: number, name: string, ownerUserId: string, slug?: string }) {
    if (input.interactionRetentionDays !== undefined)
      assertRetentionDays(input.interactionRetentionDays)
    await assertSystemAdministrator(input.ownerUserId)
    return await db.transaction(async (tx) => {
      const template = await tx.query.kioskOwnerExperienceReleases.findFirst({
        where: eq(schema.kioskOwnerExperienceReleases.ownerUserId, input.ownerUserId),
        orderBy: [desc(schema.kioskOwnerExperienceReleases.revision)],
      })
      if (!template)
        throw createConflictError('Publish a default kiosk experience before creating a Site')
      const [site] = await tx.insert(schema.kioskSites).values({ ...input, ownerUserId: input.ownerUserId }).returning()
      const [draft] = await tx.insert(schema.kioskProfileDrafts).values({ siteId: site.id, name: template.name, snapshot: template.snapshot }).returning()
      const [release] = await tx.insert(schema.kioskProfileReleases).values({
        siteId: site.id,
        name: template.name,
        revision: 1,
        sourceTemplateReleaseId: template.id,
        changeScope: 'template_seed',
        snapshot: template.snapshot,
      }).returning()
      await tx.insert(schema.kioskAuditLogs).values({
        siteId: site.id,
        actorUserId: input.ownerUserId,
        action: 'site.provisioned',
        targetType: 'kiosk_site',
        targetId: site.id,
        details: { draftId: draft.id, profileReleaseId: release.id, sourceTemplateReleaseId: template.id },
      })
      return site
    })
  }

  async function deleteSite(input: { siteId: string, userId: string }) {
    const account = await db.query.user.findFirst({
      where: eq(schema.user.id, input.userId),
      columns: { role: true },
    })
    if (account?.role !== 'admin')
      throw createForbiddenError()

    const [site] = await db.delete(schema.kioskSites)
      .where(eq(schema.kioskSites.id, input.siteId))
      .returning({ id: schema.kioskSites.id })
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
  }

  async function disableDevice(input: { deviceId: string, siteId: string, userId: string }) {
    const device = await getManagedActiveDevice(input)
    if (device.disabledAt)
      return

    const disabledAt = new Date()
    await db.transaction(async (tx) => {
      await tx.update(schema.kioskDevices)
        .set({ disabledAt, updatedAt: disabledAt })
        .where(eq(schema.kioskDevices.id, device.id))
      await tx.update(schema.kioskDeviceCredentials)
        .set({ revokedAt: disabledAt })
        .where(and(
          eq(schema.kioskDeviceCredentials.deviceId, device.id),
          isNull(schema.kioskDeviceCredentials.revokedAt),
        ))
      await tx.insert(schema.kioskAuditLogs).values({
        siteId: device.siteId,
        actorUserId: input.userId,
        action: 'device.disabled',
        targetType: 'kiosk_device',
        targetId: device.id,
        details: {},
      })
    })
  }

  async function enableDevice(input: { deviceId: string, siteId: string, userId: string }) {
    const device = await getManagedActiveDevice(input)
    if (!device.disabledAt)
      return
    const enabledAt = new Date()
    await db.transaction(async (tx) => {
      await tx.update(schema.kioskDevices).set({ disabledAt: null, updatedAt: enabledAt }).where(eq(schema.kioskDevices.id, device.id))
      // Re-enable is an explicit administrator action in this POC. Restore the
      // browser credential that was revoked by disable so the kiosk can return.
      await tx.update(schema.kioskDeviceCredentials).set({ revokedAt: null }).where(eq(schema.kioskDeviceCredentials.deviceId, device.id))
      await tx.insert(schema.kioskAuditLogs).values({ siteId: device.siteId, actorUserId: input.userId, action: 'device.enabled', targetType: 'kiosk_device', targetId: device.id, details: {} })
    })
  }

  async function deleteDevice(input: { deviceId: string, siteId: string, userId: string }) {
    const device = await getManagedActiveDevice(input)
    if (!device.disabledAt)
      throw createConflictError('Kiosk device must be disabled before deletion')

    const deletedAt = new Date()
    await db.transaction(async (tx) => {
      await tx.update(schema.kioskDevices)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(eq(schema.kioskDevices.id, device.id))
      await tx.insert(schema.kioskAuditLogs).values({
        siteId: device.siteId,
        actorUserId: input.userId,
        action: 'device.deleted',
        targetType: 'kiosk_device',
        targetId: device.id,
        details: {},
      })
    })
  }

  async function addMember(input: { siteId: string, userId: string, role: KioskMemberRole }) {
    const [member] = await db.insert(schema.kioskSiteMembers).values(input).returning()
    return member
  }

  async function createDevice(input: { siteId: string, label: string, registrationMethod: KioskRegistrationMethod }) {
    return await db.transaction(async (tx) => {
      const [device] = await tx.insert(schema.kioskDevices).values(input).returning()
      const release = await tx.query.kioskProfileReleases.findFirst({
        where: eq(schema.kioskProfileReleases.siteId, input.siteId),
        orderBy: [desc(schema.kioskProfileReleases.revision)],
      })
      if (release) {
        await tx.insert(schema.kioskDeviceProfileAssignments).values({ deviceId: device.id, profileReleaseId: release.id })
      }
      return device
    })
  }

  async function createProfileRelease(input: { siteId: string, name: string, snapshot: KioskProfileSnapshot }) {
    const snapshot = parseProfileSnapshot(input.snapshot)
    const [release] = await db.insert(schema.kioskProfileReleases).values({ ...input, snapshot }).returning()
    return release
  }

  async function startVisitorSession(input: { deviceId: string, profileReleaseId: string, serviceId: string }) {
    const [device, release] = await Promise.all([
      db.query.kioskDevices.findFirst({ where: eq(schema.kioskDevices.id, input.deviceId) }),
      db.query.kioskProfileReleases.findFirst({ where: eq(schema.kioskProfileReleases.id, input.profileReleaseId) }),
    ])

    if (!device || !release)
      throw createNotFoundError('Kiosk device or Profile release was not found')

    // A release is only valid inside the Site that owns the device. Keeping
    // this invariant at session creation prevents a later read path from
    // having to reason about cross-Site configuration provenance.
    if (device.siteId !== release.siteId)
      throw createForbiddenError('A kiosk device cannot use a Profile release from another Site')
    if (input.serviceId !== release.snapshot.interactiveService.id)
      throw createForbiddenError('The requested interactive service is not published for this kiosk Profile')

    const site = await db.query.kioskSites.findFirst({ where: eq(schema.kioskSites.id, device.siteId) })
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')

    const [visitorSession] = await db.insert(schema.kioskVisitorSessions).values({
      siteId: device.siteId,
      deviceId: device.id,
      profileReleaseId: release.id,
      serviceId: input.serviceId,
      expiresAt: retentionExpiry(site.interactionRetentionDays),
    }).returning()
    return visitorSession
  }

  async function appendDeviceInteraction(input: {
    content: string
    deviceId: string
    kind: KioskInteractionEntryKind
    metadata?: Record<string, unknown>
    visitorSessionId: string
  }) {
    await getVisitorSessionForDevice({ deviceId: input.deviceId, visitorSessionId: input.visitorSessionId })
    return await appendInteractionEntry(input)
  }

  async function endDeviceVisitorSession(input: {
    deviceId: string
    state: Exclude<KioskVisitorSessionState, 'active'>
    visitorSessionId: string
  }) {
    await getVisitorSessionForDevice({ deviceId: input.deviceId, visitorSessionId: input.visitorSessionId })
    const [session] = await db.update(schema.kioskVisitorSessions)
      .set({ endedAt: new Date(), state: input.state })
      .where(and(
        eq(schema.kioskVisitorSessions.id, input.visitorSessionId),
        eq(schema.kioskVisitorSessions.state, 'active'),
      ))
      .returning()
    if (!session)
      throw createNotFoundError('Active visitor session was not found')
    return session
  }

  async function updateDeviceAgentInteraction(input: { deviceId: string, interaction: KioskAgentInteractionState, visitorSessionId: string }) {
    const [session] = await db.update(schema.kioskVisitorSessions)
      .set({ agentInteraction: input.interaction })
      .where(and(
        eq(schema.kioskVisitorSessions.id, input.visitorSessionId),
        eq(schema.kioskVisitorSessions.deviceId, input.deviceId),
        eq(schema.kioskVisitorSessions.state, 'active'),
      ))
      .returning()
    if (!session)
      throw createNotFoundError('Active visitor session was not found for this kiosk device')
    return session
  }

  async function registerDevelopmentDevice(input: { registrationCode: string }) {
    if (!/^\d{6}$/.test(input.registrationCode))
      throw new Error('Development registration codes must contain exactly six digits')

    const site = await ensureDevelopmentSite()
    const device = await createDevice({
      siteId: site.id,
      label: `DEV-${input.registrationCode}`,
      registrationMethod: 'development',
    })
    const profile = await ensureDevelopmentProfile(site.id)
    await db.insert(schema.kioskDeviceProfileAssignments).values({
      deviceId: device.id,
      profileReleaseId: profile.id,
    }).onConflictDoUpdate({
      target: schema.kioskDeviceProfileAssignments.deviceId,
      set: { profileReleaseId: profile.id, assignedAt: new Date() },
    })
    const credential = randomBytes(32).toString('base64url')
    await db.insert(schema.kioskDeviceCredentials).values({
      deviceId: device.id,
      tokenHash: hashCredential(credential),
    })
    await db.insert(schema.kioskAuditLogs).values({
      siteId: site.id,
      action: 'device.registered',
      targetType: 'kiosk_device',
      targetId: device.id,
      details: { registrationMethod: 'development' },
    })
    return { credential, device }
  }

  async function resolveDeviceCredential(credential: string) {
    const credentialRecord = await db.query.kioskDeviceCredentials.findFirst({
      where: and(
        eq(schema.kioskDeviceCredentials.tokenHash, hashCredential(credential)),
        isNull(schema.kioskDeviceCredentials.revokedAt),
      ),
    })
    if (!credentialRecord)
      return undefined

    return await db.query.kioskDevices.findFirst({
      where: and(
        eq(schema.kioskDevices.id, credentialRecord.deviceId),
        isNull(schema.kioskDevices.disabledAt),
        isNull(schema.kioskDevices.deletedAt),
      ),
    })
  }

  async function isCurrentDevelopmentDevice(deviceId: string) {
    const [device, site] = await Promise.all([
      db.query.kioskDevices.findFirst({ where: eq(schema.kioskDevices.id, deviceId) }),
      ensureDevelopmentSite(),
    ])
    return device?.siteId === site.id
  }

  async function getDeviceProfile(deviceId: string) {
    const assignment = await db.query.kioskDeviceProfileAssignments.findFirst({
      where: eq(schema.kioskDeviceProfileAssignments.deviceId, deviceId),
    })
    if (!assignment)
      return undefined

    return await db.query.kioskProfileReleases.findFirst({
      where: eq(schema.kioskProfileReleases.id, assignment.profileReleaseId),
    })
  }

  async function listManagedSites(userId: string) {
    const account = await db.query.user.findFirst({
      where: eq(schema.user.id, userId),
      columns: { role: true },
    })
    if (account?.role === 'admin')
      return await db.query.kioskSites.findMany({ orderBy: [asc(schema.kioskSites.name)] })

    const memberships = await db.query.kioskSiteMembers.findMany({
      where: and(
        eq(schema.kioskSiteMembers.userId, userId),
        inArray(schema.kioskSiteMembers.role, ['site_admin', 'content_manager']),
      ),
      columns: { siteId: true },
    })
    if (memberships.length === 0)
      return []

    return await db.query.kioskSites.findMany({
      where: inArray(schema.kioskSites.id, memberships.map(membership => membership.siteId)),
      orderBy: [asc(schema.kioskSites.name)],
    })
  }

  async function listSiteDevices(input: { siteId: string, userId: string }) {
    const capabilities = await getSiteManagementCapabilities(input)
    if (!capabilities.canManageDevices && !capabilities.canEditExperience)
      throw createForbiddenError()
    return await db.query.kioskDevices.findMany({
      where: and(
        eq(schema.kioskDevices.siteId, input.siteId),
        isNull(schema.kioskDevices.deletedAt),
      ),
      orderBy: [asc(schema.kioskDevices.label)],
    })
  }

  async function listSiteVisitorSessions(input: { deviceId?: string, siteId: string, userId: string }) {
    await assertCanReadTranscript(input.userId, input.siteId)
    const sessions = await db.select({
      createdAt: schema.kioskVisitorSessions.createdAt,
      deviceId: schema.kioskVisitorSessions.deviceId,
      deviceLabel: schema.kioskDevices.label,
      endedAt: schema.kioskVisitorSessions.endedAt,
      id: schema.kioskVisitorSessions.id,
      interactionCount: sql<number>`(
        select count(*)
        from ${schema.kioskInteractionEntries}
        where ${schema.kioskInteractionEntries.visitorSessionId} = ${schema.kioskVisitorSessions.id}
      )`.mapWith(Number),
      hasCustomerInput: sql<boolean>`exists (
        select 1 from ${schema.kioskInteractionEntries}
        where ${schema.kioskInteractionEntries.visitorSessionId} = ${schema.kioskVisitorSessions.id}
          and ${schema.kioskInteractionEntries.kind} in ('user_text', 'asr_transcript', 'order_result')
      )`,
      hasProactiveGreeting: sql<boolean>`exists (
        select 1 from ${schema.kioskInteractionEntries}
        where ${schema.kioskInteractionEntries.visitorSessionId} = ${schema.kioskVisitorSessions.id}
          and ${schema.kioskInteractionEntries.kind} = 'service_event'
          and ${schema.kioskInteractionEntries.content} = 'proactive_greeting'
      )`,
      serviceId: schema.kioskVisitorSessions.serviceId,
      state: schema.kioskVisitorSessions.state,
    })
      .from(schema.kioskVisitorSessions)
      .innerJoin(schema.kioskDevices, eq(schema.kioskDevices.id, schema.kioskVisitorSessions.deviceId))
      .where(and(
        eq(schema.kioskVisitorSessions.siteId, input.siteId),
        ...(input.deviceId ? [eq(schema.kioskVisitorSessions.deviceId, input.deviceId)] : []),
      ))
      .orderBy(desc(schema.kioskVisitorSessions.createdAt))
    return sessions.map(({ hasCustomerInput, hasProactiveGreeting, ...session }) => ({
      ...session,
      // A greeting is operational evidence, not a customer conversation. Keep it
      // visible and retain its media, while making training review opt-in.
      presence: classifySessionPresence(hasCustomerInput, hasProactiveGreeting),
    }))
  }

  async function getProfileRelease(profileReleaseId: string) {
    return await db.query.kioskProfileReleases.findFirst({ where: eq(schema.kioskProfileReleases.id, profileReleaseId) })
  }

  async function getSiteProfile(siteId: string) {
    const [drafts, release] = await Promise.all([
      db.query.kioskProfileDrafts.findMany({ where: eq(schema.kioskProfileDrafts.siteId, siteId), orderBy: [desc(schema.kioskProfileDrafts.updatedAt)] }),
      db.query.kioskProfileReleases.findFirst({ where: eq(schema.kioskProfileReleases.siteId, siteId), orderBy: [desc(schema.kioskProfileReleases.revision)] }),
    ])
    return { drafts, release }
  }

  async function getOwnerExperienceTemplate(ownerUserId: string) {
    await assertSystemAdministrator(ownerUserId)
    const [draft, release] = await Promise.all([
      db.query.kioskOwnerExperienceDrafts.findFirst({ where: eq(schema.kioskOwnerExperienceDrafts.ownerUserId, ownerUserId) }),
      db.query.kioskOwnerExperienceReleases.findFirst({ where: eq(schema.kioskOwnerExperienceReleases.ownerUserId, ownerUserId), orderBy: [desc(schema.kioskOwnerExperienceReleases.revision)] }),
    ])
    return { draft, release }
  }

  async function saveOwnerExperienceTemplateDraft(input: { id?: string, name: string, ownerUserId: string, snapshot: KioskProfileSnapshot }) {
    await assertSystemAdministrator(input.ownerUserId)
    const snapshot = parseProfileSnapshot(input.snapshot)
    const [draft] = await db.insert(schema.kioskOwnerExperienceDrafts).values({
      ownerUserId: input.ownerUserId,
      name: input.name,
      snapshot,
    }).onConflictDoUpdate({
      target: schema.kioskOwnerExperienceDrafts.ownerUserId,
      set: { name: input.name, snapshot, updatedAt: new Date() },
    }).returning()
    return draft
  }

  async function saveContentProfileDraft(input: { siteId: string, snapshot: KioskProfileSnapshot }) {
    const { drafts, release } = await getSiteProfile(input.siteId)
    const source = drafts[0] ?? release
    if (!source)
      throw createNotFoundError('A system administrator must create the first experience draft.')

    return await saveProfileDraft({
      name: source.name,
      siteId: input.siteId,
      snapshot: {
        ...source.snapshot,
        assistanceReminderPrompt: input.snapshot.assistanceReminderPrompt,
        characterName: input.snapshot.characterName,
        greetingPrompt: input.snapshot.greetingPrompt,
        interactiveService: {
          ...source.snapshot.interactiveService,
          description: input.snapshot.interactiveService.description,
          title: input.snapshot.interactiveService.title,
        },
      },
    })
  }

  async function saveProfileDraft(input: { id?: string, name: string, siteId: string, snapshot: KioskProfileSnapshot }) {
    const snapshot = parseProfileSnapshot(input.snapshot)
    if (input.id) {
      const [draft] = await db.update(schema.kioskProfileDrafts)
        .set({ name: input.name, snapshot, updatedAt: new Date() })
        .where(and(eq(schema.kioskProfileDrafts.id, input.id), eq(schema.kioskProfileDrafts.siteId, input.siteId)))
        .returning()
      if (!draft)
        throw createNotFoundError('Kiosk Profile draft was not found')
      return draft
    }
    const [draft] = await db.insert(schema.kioskProfileDrafts).values({
      name: input.name,
      siteId: input.siteId,
      snapshot,
    }).returning()
    return draft
  }

  async function publishProfileDraft(input: { actorUserId?: string, draftId: string, siteId: string }) {
    return await db.transaction(async (tx) => {
      const draft = await tx.query.kioskProfileDrafts.findFirst({ where: and(eq(schema.kioskProfileDrafts.id, input.draftId), eq(schema.kioskProfileDrafts.siteId, input.siteId)) })
      if (!draft)
        throw createNotFoundError('Kiosk Profile draft was not found')

      const previousRelease = await tx.query.kioskProfileReleases.findFirst({
        where: eq(schema.kioskProfileReleases.siteId, input.siteId),
        orderBy: [desc(schema.kioskProfileReleases.revision)],
      })
      const [release] = await tx.insert(schema.kioskProfileReleases).values({
        siteId: input.siteId,
        name: draft.name,
        revision: (previousRelease?.revision ?? 0) + 1,
        parentSiteReleaseId: previousRelease?.id,
        sourceTemplateReleaseId: previousRelease?.sourceTemplateReleaseId,
        changeScope: 'site_override',
        snapshot: draft.snapshot,
      }).returning()
      const devices = await tx.query.kioskDevices.findMany({
        where: and(
          eq(schema.kioskDevices.siteId, input.siteId),
          isNull(schema.kioskDevices.deletedAt),
        ),
      })
      if (devices.length > 0) {
        await tx.insert(schema.kioskDeviceProfileAssignments).values(devices.map(device => ({
          deviceId: device.id,
          profileReleaseId: release.id,
        }))).onConflictDoUpdate({
          target: schema.kioskDeviceProfileAssignments.deviceId,
          set: { profileReleaseId: release.id, assignedAt: new Date() },
        })
      }
      await tx.insert(schema.kioskAuditLogs).values({
        siteId: input.siteId,
        actorUserId: input.actorUserId,
        action: 'profile.published',
        targetType: 'kiosk_profile_release',
        targetId: release.id,
        details: { assignedDeviceCount: devices.length },
      })
      return release
    })
  }

  async function publishOwnerExperienceTemplate(input: { ownerUserId: string }) {
    await assertSystemAdministrator(input.ownerUserId)
    return await db.transaction(async (tx) => {
      const draft = await tx.query.kioskOwnerExperienceDrafts.findFirst({ where: eq(schema.kioskOwnerExperienceDrafts.ownerUserId, input.ownerUserId) })
      if (!draft)
        throw createNotFoundError('Default kiosk experience draft was not found')
      const latest = await tx.query.kioskOwnerExperienceReleases.findFirst({
        where: eq(schema.kioskOwnerExperienceReleases.ownerUserId, input.ownerUserId),
        orderBy: [desc(schema.kioskOwnerExperienceReleases.revision)],
      })
      const [release] = await tx.insert(schema.kioskOwnerExperienceReleases).values({
        ownerUserId: input.ownerUserId,
        name: draft.name,
        revision: (latest?.revision ?? 0) + 1,
        snapshot: draft.snapshot,
      }).returning()
      return release
    })
  }

  async function purgeExpiredVisitorSessions(now: Date) {
    const deleted = await db.delete(schema.kioskVisitorSessions)
      .where(and(
        lte(schema.kioskVisitorSessions.expiresAt, now),
        isNotNull(schema.kioskVisitorSessions.endedAt),
      ))
      .returning({ id: schema.kioskVisitorSessions.id })
    return deleted.length
  }

  async function deleteVisitorSessions(input: { siteId: string, userId: string, visitorSessionIds: string[] }) {
    await assertCanManageSite({ siteId: input.siteId, userId: input.userId })
    const ids = [...new Set(input.visitorSessionIds)]
    const sessions = await db.query.kioskVisitorSessions.findMany({
      where: and(
        eq(schema.kioskVisitorSessions.siteId, input.siteId),
        inArray(schema.kioskVisitorSessions.id, ids),
      ),
      columns: { id: true },
    })
    if (sessions.length !== ids.length)
      throw createNotFoundError('One or more visitor sessions were not found')
    await db.delete(schema.kioskVisitorSessions).where(inArray(schema.kioskVisitorSessions.id, ids))
    return ids
  }

  async function setSiteInteractionRetentionDays(input: { actorUserId: string, days: number, siteId: string }) {
    assertRetentionDays(input.days)
    await assertSystemAdministrator(input.actorUserId)
    const [site] = await db.update(schema.kioskSites)
      .set({ interactionRetentionDays: input.days, updatedAt: new Date() })
      .where(eq(schema.kioskSites.id, input.siteId))
      .returning()
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site
  }

  async function getDeviceSettings(deviceId: string): Promise<DeviceSettingsSnapshot> {
    const device = await db.query.kioskDevices.findFirst({ where: and(eq(schema.kioskDevices.id, deviceId), isNull(schema.kioskDevices.deletedAt)) })
    if (!device)
      throw createNotFoundError('Kiosk device was not found')
    const site = await db.query.kioskSites.findFirst({ where: eq(schema.kioskSites.id, device.siteId) })
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    const defaults = {
      ...defaultDeviceSettingsValues,
      mediaCaptureMode: site.mediaCapturePolicy.mode,
      performanceProfile: site.performanceProfile,
      proactiveVlmEnabled: site.proactiveVlmEnabled === 1,
      voiceVadSettings: site.voiceVadSettings,
    }
    return { deviceId, settings: device.settings, defaults, effective: resolveDeviceSettings(defaults, device.settings) }
  }

  async function updateDeviceSettings(input: { deviceId: string, siteId: string, userId: string, source: 'admin' | 'local', body: unknown }) {
    const change = parseSettingsChange(input.source, input.body)
    const capabilities = await getSiteManagementCapabilities(input)
    if (input.source === 'admin' ? !capabilities.canEditTechnicalSettings : !capabilities.canManageDevices)
      throw createForbiddenError()
    const snapshot = await getDeviceSettings(input.deviceId)
    await db.transaction(async (tx) => {
      // The row lock serializes settings writes with disable/delete. The revision
      // check rejects a stale editor instead of overwriting another operator.
      const [device] = await tx.select().from(schema.kioskDevices).where(and(
        eq(schema.kioskDevices.id, input.deviceId),
        eq(schema.kioskDevices.siteId, input.siteId),
        isNull(schema.kioskDevices.deletedAt),
      )).for('update')
      if (!device)
        throw createNotFoundError('Kiosk device was not found')
      if (input.source === 'local' && device.disabledAt)
        throw createForbiddenError()
      if (device.settings.version !== change.version)
        throw createConflictError('Settings changed. Reload before saving.')
      const previous = device.settings
      let next: DeviceSettings
      if (input.source === 'admin' && 'localControls' in change) {
        const localControls = [...new Set(change.localControls)]
        // Revocation removes the value permanently; re-delegation cannot revive it.
        const localOverrides = Object.fromEntries(Object.entries(previous.localOverrides).filter(([key]) =>
          localControls.includes(key as DeviceSettingKey) && !change.clearLocalOverrides.includes(key as DeviceSettingKey),
        ))
        next = { version: previous.version + 1, overrides: change.overrides, localControls, localOverrides }
      }
      else {
        if (Object.keys(change.overrides).some(key => !previous.localControls.includes(key as DeviceSettingKey)))
          throw createForbiddenError('This setting is locked by the administrator')
        next = { ...previous, version: previous.version + 1, localOverrides: change.overrides }
      }
      assertDetectionZone(resolveDeviceSettings(snapshot.defaults, next))
      await tx.update(schema.kioskDevices).set({ settings: next }).where(eq(schema.kioskDevices.id, device.id))
      await tx.insert(schema.kioskAuditLogs).values({
        siteId: device.siteId,
        actorUserId: input.userId,
        action: 'device.settings.updated',
        targetType: 'kiosk_device',
        targetId: device.id,
        details: { source: input.source, before: previous, after: next },
      })
    })
    return await getDeviceSettings(input.deviceId)
  }

  async function getSiteMediaCapturePolicy(siteId: string) {
    const site = await db.query.kioskSites.findFirst({
      where: eq(schema.kioskSites.id, siteId),
      columns: { mediaCapturePolicy: true },
    })
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site.mediaCapturePolicy
  }

  async function getSiteProactiveVlmEnabled(siteId: string) {
    const site = await db.query.kioskSites.findFirst({ where: eq(schema.kioskSites.id, siteId), columns: { proactiveVlmEnabled: true } })
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site.proactiveVlmEnabled === 1
  }

  async function setSiteProactiveVlmEnabled(input: { actorUserId: string, enabled: boolean, siteId: string }) {
    await assertSystemAdministrator(input.actorUserId)
    const [site] = await db.update(schema.kioskSites).set({ proactiveVlmEnabled: input.enabled ? 1 : 0, updatedAt: new Date() }).where(eq(schema.kioskSites.id, input.siteId)).returning()
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site
  }

  async function getSitePerformanceProfile(siteId: string) {
    const site = await db.query.kioskSites.findFirst({ where: eq(schema.kioskSites.id, siteId), columns: { performanceProfile: true } })
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site.performanceProfile
  }

  async function setSitePerformanceProfile(input: { actorUserId: string, profile: KioskPerformanceProfile, siteId: string }) {
    await assertSystemAdministrator(input.actorUserId)
    const [site] = await db.update(schema.kioskSites).set({ performanceProfile: input.profile, updatedAt: new Date() }).where(eq(schema.kioskSites.id, input.siteId)).returning()
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site
  }

  async function getSiteVoiceVadSettings(siteId: string) {
    const site = await db.query.kioskSites.findFirst({ where: eq(schema.kioskSites.id, siteId), columns: { voiceVadSettings: true } })
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site.voiceVadSettings
  }

  async function setSiteVoiceVadSettings(input: { actorUserId: string, settings: KioskVoiceVadSettings, siteId: string }) {
    await assertSystemAdministrator(input.actorUserId)
    const [site] = await db.update(schema.kioskSites).set({ voiceVadSettings: input.settings, updatedAt: new Date() }).where(eq(schema.kioskSites.id, input.siteId)).returning()
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site
  }

  async function setSiteMediaCapturePolicy(input: { actorUserId: string, policy: KioskMediaCapturePolicy, siteId: string }) {
    await assertSystemAdministrator(input.actorUserId)
    const [site] = await db.update(schema.kioskSites)
      .set({ mediaCapturePolicy: input.policy, updatedAt: new Date() })
      .where(eq(schema.kioskSites.id, input.siteId))
      .returning()
    if (!site)
      throw createNotFoundError('Kiosk Site was not found')
    return site
  }

  async function ensureDevelopmentSite() {
    const slug = 'webnavior-test-site'
    await db.insert(schema.kioskSites).values({
      name: 'Webnavior 測試店',
      slug,
    }).onConflictDoNothing({ target: schema.kioskSites.slug })

    const site = await db.query.kioskSites.findFirst({ where: eq(schema.kioskSites.slug, slug) })
    if (!site)
      throw new Error('Development kiosk Site was not created')
    return site
  }

  async function ensureDevelopmentProfile(siteId: string) {
    const currentProfile = await getDeviceProfileForSite(siteId)
    if (currentProfile)
      return currentProfile

    const draft = await saveProfileDraft({ siteId, name: '開發 POC 點餐助手', snapshot: developmentProfile })
    return await publishProfileDraft({ siteId, draftId: draft.id })
  }

  async function getDeviceProfileForSite(siteId: string) {
    const devices = await db.query.kioskDevices.findMany({ where: eq(schema.kioskDevices.siteId, siteId) })
    for (const device of devices) {
      const profile = await getDeviceProfile(device.id)
      if (profile)
        return profile
    }
    return undefined
  }

  async function appendInteractionEntry(input: {
    visitorSessionId: string
    kind: KioskInteractionEntryKind
    content: string
    metadata?: Record<string, unknown>
  }) {
    return await db.transaction(async (tx) => {
      // Increment and return the session counter in one statement. This avoids
      // duplicate transcript positions when ASR, LLM, and iframe events arrive
      // concurrently for the same visitor session.
      const [session] = await tx.update(schema.kioskVisitorSessions)
        .set({ lastSequence: sql`${schema.kioskVisitorSessions.lastSequence} + 1` })
        .where(eq(schema.kioskVisitorSessions.id, input.visitorSessionId))
        .returning({ lastSequence: schema.kioskVisitorSessions.lastSequence })

      if (!session)
        throw createNotFoundError('Visitor session was not found')

      const [entry] = await tx.insert(schema.kioskInteractionEntries).values({
        visitorSessionId: input.visitorSessionId,
        sequence: session.lastSequence,
        kind: input.kind,
        content: input.content,
        metadata: input.metadata ?? {},
      }).returning()
      return entry
    })
  }

  async function getVisitorSessionForUser(input: { userId: string, visitorSessionId: string }) {
    const visitorSession = await db.query.kioskVisitorSessions.findFirst({
      where: eq(schema.kioskVisitorSessions.id, input.visitorSessionId),
    })
    if (!visitorSession)
      throw createNotFoundError('Visitor session was not found')

    await assertCanReadTranscript(input.userId, visitorSession.siteId)

    const entries = await db.query.kioskInteractionEntries.findMany({
      where: eq(schema.kioskInteractionEntries.visitorSessionId, visitorSession.id),
      orderBy: [asc(schema.kioskInteractionEntries.sequence)],
    })
    return { session: visitorSession, entries }
  }

  async function getVisitorSessionForDevice(input: { deviceId: string, visitorSessionId: string }) {
    const session = await db.query.kioskVisitorSessions.findFirst({
      where: and(
        eq(schema.kioskVisitorSessions.id, input.visitorSessionId),
        eq(schema.kioskVisitorSessions.deviceId, input.deviceId),
      ),
    })
    if (!session)
      throw createNotFoundError('Visitor session was not found for this kiosk device')
    const entries = await db.query.kioskInteractionEntries.findMany({
      where: eq(schema.kioskInteractionEntries.visitorSessionId, session.id),
      orderBy: [asc(schema.kioskInteractionEntries.sequence)],
    })
    return { session, entries }
  }

  async function assertCanReadTranscript(userId: string, siteId: string) {
    await assertCanManageSite({ siteId, userId })
  }

  async function getManagedActiveDevice(input: { deviceId: string, siteId: string, userId: string }) {
    const device = await db.query.kioskDevices.findFirst({
      where: and(
        eq(schema.kioskDevices.id, input.deviceId),
        eq(schema.kioskDevices.siteId, input.siteId),
        isNull(schema.kioskDevices.deletedAt),
      ),
    })
    if (!device)
      throw createNotFoundError('Kiosk device was not found')

    await assertCanManageSite({ siteId: device.siteId, userId: input.userId })
    return device
  }

  async function assertCanManageSite(input: { siteId: string, userId: string }) {
    const capabilities = await getSiteManagementCapabilities(input)
    if (!capabilities.canManageDevices)
      throw createForbiddenError()
  }

  async function getSiteManagementCapabilities(input: { siteId: string, userId: string }): Promise<KioskSiteManagementCapabilities> {
    const account = await db.query.user.findFirst({
      where: eq(schema.user.id, input.userId),
      columns: { role: true },
    })
    if (account?.role === 'admin') {
      return {
        canEditExperience: true,
        canEditTechnicalSettings: true,
        canManageDevices: true,
        canPublishExperience: true,
      }
    }

    const membership = await db.query.kioskSiteMembers.findFirst({
      where: and(
        eq(schema.kioskSiteMembers.siteId, input.siteId),
        eq(schema.kioskSiteMembers.userId, input.userId),
      ),
    })
    if (membership?.role === 'site_admin') {
      return {
        canEditExperience: false,
        canEditTechnicalSettings: false,
        canManageDevices: true,
        canPublishExperience: false,
      }
    }
    if (membership?.role === 'content_manager') {
      return {
        canEditExperience: true,
        canEditTechnicalSettings: false,
        canManageDevices: false,
        canPublishExperience: false,
      }
    }

    return {
      canEditExperience: false,
      canEditTechnicalSettings: false,
      canManageDevices: false,
      canPublishExperience: false,
    }
  }

  async function assertSystemAdministrator(userId: string) {
    const account = await db.query.user.findFirst({
      where: eq(schema.user.id, userId),
      columns: { role: true },
    })
    if (account?.role !== 'admin')
      throw createForbiddenError()
  }

  return {
    getDeviceSettings,
    updateDeviceSettings,
    updateDeviceAgentInteraction,
    addMember,
    assertCanManageSite,
    appendInteractionEntry,
    appendDeviceInteraction,
    createDevice,
    deleteDevice,
    deleteVisitorSessions,
    deleteSite,
    createProfileRelease,
    createSite,
    provisionSite,
    getSiteManagementCapabilities,
    endDeviceVisitorSession,
    disableDevice,
    enableDevice,
    getDeviceProfile,
    getSiteMediaCapturePolicy,
    getSiteProactiveVlmEnabled,
    getSitePerformanceProfile,
    getSiteVoiceVadSettings,
    getProfileRelease,
    getSiteProfile,
    getOwnerExperienceTemplate,
    listManagedSites,
    listSiteDevices,
    listSiteVisitorSessions,
    getVisitorSessionForDevice,
    getVisitorSessionForUser,
    startVisitorSession,
    registerDevelopmentDevice,
    isCurrentDevelopmentDevice,
    resolveDeviceCredential,
    saveProfileDraft,
    saveOwnerExperienceTemplateDraft,
    saveContentProfileDraft,
    setSiteInteractionRetentionDays,
    setSiteMediaCapturePolicy,
    setSiteProactiveVlmEnabled,
    setSitePerformanceProfile,
    setSiteVoiceVadSettings,
    publishProfileDraft,
    publishOwnerExperienceTemplate,
    purgeExpiredVisitorSessions,
  }
}

function classifySessionPresence(hasCustomerInput: boolean, hasProactiveGreeting: boolean): 'greeting_only' | 'interactive' | 'empty' {
  if (hasCustomerInput)
    return 'interactive'
  if (hasProactiveGreeting)
    return 'greeting_only'
  return 'empty'
}

function assertRetentionDays(days: number) {
  if (!Number.isSafeInteger(days) || days < 0)
    throw new Error('Kiosk interaction retention days must be a non-negative integer')
}

function retentionExpiry(retentionDays: number) {
  return new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
}

function parseProfileSnapshot(snapshot: KioskProfileSnapshot) {
  const result = safeParse(KioskProfileSnapshotSchema, snapshot)
  if (!result.success)
    throw new Error('Kiosk Profile snapshot is invalid')
  return result.output
}

function hashCredential(credential: string) {
  return createHash('sha256').update(credential).digest('base64url')
}
