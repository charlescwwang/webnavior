import type { Database } from '../../../libs/db'
import type { KioskInteractionEntryKind, KioskMemberRole, KioskProfileSnapshot, KioskRegistrationMethod, KioskVisitorSessionState } from '../../../schemas/kiosk'

import { createHash, randomBytes } from 'node:crypto'

import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { literal, maxLength, minLength, object, pipe, safeParse, string, url } from 'valibot'

import { createForbiddenError, createNotFoundError } from '../../../utils/error'

import * as schema from '../../../schemas'

/** Inputs that create persistent kiosk configuration and interaction records. */
export interface KioskService {
  /** Adds a user to a site's management scope. */
  addMember: (input: { siteId: string, userId: string, role: KioskMemberRole }) => Promise<typeof schema.kioskSiteMembers.$inferSelect>
  /** Allows only a global administrator or the named site's administrator to manage configuration. */
  assertCanManageSite: (input: { siteId: string, userId: string }) => Promise<void>
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
  /** Creates a kiosk browser installation owned by a site. */
  createDevice: (input: { siteId: string, label: string, registrationMethod: KioskRegistrationMethod }) => Promise<typeof schema.kioskDevices.$inferSelect>
  /** Stores an immutable configuration snapshot for one site. */
  createProfileRelease: (input: { siteId: string, name: string, snapshot: KioskProfileSnapshot }) => Promise<typeof schema.kioskProfileReleases.$inferSelect>
  /** Creates the root management scope for kiosk configuration and data. */
  createSite: (input: { interactionRetentionDays?: number, name: string, slug?: string }) => Promise<typeof schema.kioskSites.$inferSelect>
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
  /** Retrieves the currently assigned immutable Profile release for one kiosk device. */
  getDeviceProfile: (deviceId: string) => Promise<typeof schema.kioskProfileReleases.$inferSelect | undefined>
  /** Lists the Sites the account may administer without exposing other Site identifiers. */
  listManagedSites: (userId: string) => Promise<(typeof schema.kioskSites.$inferSelect)[]>
  /** Lists devices only after verifying the caller may manage their Site. */
  listSiteDevices: (input: { siteId: string, userId: string }) => Promise<(typeof schema.kioskDevices.$inferSelect)[]>
  /** Retrieves the immutable Profile snapshot that a persisted session references. */
  getProfileRelease: (profileReleaseId: string) => Promise<typeof schema.kioskProfileReleases.$inferSelect | undefined>
  /** Returns the editable draft and currently assigned release for a Site management screen. */
  getSiteProfile: (siteId: string) => Promise<{
    draft: typeof schema.kioskProfileDrafts.$inferSelect | undefined
    release: typeof schema.kioskProfileReleases.$inferSelect | undefined
  }>
  /** Replaces the site's one editable draft after validating the POC configuration shape. */
  saveProfileDraft: (input: { name: string, siteId: string, snapshot: KioskProfileSnapshot }) => Promise<typeof schema.kioskProfileDrafts.$inferSelect>
  /** Changes the policy used to calculate expiry for future visitor sessions. */
  setSiteInteractionRetentionDays: (input: { actorUserId: string, days: number, siteId: string }) => Promise<typeof schema.kioskSites.$inferSelect>
  /** Publishes the current draft as a new immutable release and assigns it to every Site device. */
  publishProfileDraft: (input: { actorUserId?: string, siteId: string }) => Promise<typeof schema.kioskProfileReleases.$inferSelect>
  /** Removes expired visitor sessions and their cascading interaction entries. */
  purgeExpiredVisitorSessions: (now: Date) => Promise<number>
}

/** Runtime contract shared by kiosk Profile draft writes and immutable releases. */
export const KioskProfileSnapshotSchema = object({
  assistanceReminderPrompt: pipe(string(), minLength(1), maxLength(2_000)),
  agentInstructions: pipe(string(), minLength(1), maxLength(8_000)),
  characterName: pipe(string(), minLength(1), maxLength(120)),
  greetingPrompt: pipe(string(), minLength(1), maxLength(2_000)),
  interactiveService: object({
    description: pipe(string(), maxLength(500)),
    id: pipe(string(), minLength(1), maxLength(120)),
    title: pipe(string(), minLength(1), maxLength(120)),
    url: pipe(string(), url(), maxLength(2_000)),
  }),
  surveyUrl: pipe(string(), url(), maxLength(2_000)),
  version: literal(1),
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
    url: 'http://localhost:5174',
  },
  surveyUrl: 'https://example.com/kiosk-feedback',
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

  async function addMember(input: { siteId: string, userId: string, role: KioskMemberRole }) {
    const [member] = await db.insert(schema.kioskSiteMembers).values(input).returning()
    return member
  }

  async function createDevice(input: { siteId: string, label: string, registrationMethod: KioskRegistrationMethod }) {
    const [device] = await db.insert(schema.kioskDevices).values(input).returning()
    return device
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
      where: eq(schema.kioskDevices.id, credentialRecord.deviceId),
    })
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
        eq(schema.kioskSiteMembers.role, 'site_admin'),
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
    await assertCanManageSite(input)
    return await db.query.kioskDevices.findMany({
      where: eq(schema.kioskDevices.siteId, input.siteId),
      orderBy: [asc(schema.kioskDevices.label)],
    })
  }

  async function getProfileRelease(profileReleaseId: string) {
    return await db.query.kioskProfileReleases.findFirst({ where: eq(schema.kioskProfileReleases.id, profileReleaseId) })
  }

  async function getSiteProfile(siteId: string) {
    const [draft, release] = await Promise.all([
      db.query.kioskProfileDrafts.findFirst({ where: eq(schema.kioskProfileDrafts.siteId, siteId) }),
      getDeviceProfileForSite(siteId),
    ])
    return { draft, release }
  }

  async function saveProfileDraft(input: { name: string, siteId: string, snapshot: KioskProfileSnapshot }) {
    const snapshot = parseProfileSnapshot(input.snapshot)
    const [draft] = await db.insert(schema.kioskProfileDrafts).values({ ...input, snapshot }).onConflictDoUpdate({
      target: schema.kioskProfileDrafts.siteId,
      set: { name: input.name, snapshot, updatedAt: new Date() },
    }).returning()
    return draft
  }

  async function publishProfileDraft(input: { actorUserId?: string, siteId: string }) {
    return await db.transaction(async (tx) => {
      const draft = await tx.query.kioskProfileDrafts.findFirst({ where: eq(schema.kioskProfileDrafts.siteId, input.siteId) })
      if (!draft)
        throw createNotFoundError('Kiosk Profile draft was not found')

      const [release] = await tx.insert(schema.kioskProfileReleases).values({
        siteId: input.siteId,
        name: draft.name,
        snapshot: draft.snapshot,
      }).returning()
      const devices = await tx.query.kioskDevices.findMany({ where: eq(schema.kioskDevices.siteId, input.siteId) })
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

  async function purgeExpiredVisitorSessions(now: Date) {
    const deleted = await db.delete(schema.kioskVisitorSessions)
      .where(and(
        lte(schema.kioskVisitorSessions.expiresAt, now),
        isNotNull(schema.kioskVisitorSessions.endedAt),
      ))
      .returning({ id: schema.kioskVisitorSessions.id })
    return deleted.length
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

  async function ensureDevelopmentSite() {
    const slug = 'development-kiosk-poc'
    await db.insert(schema.kioskSites).values({
      name: 'Development Kiosk POC',
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

    await saveProfileDraft({ siteId, name: '開發 POC 點餐助手', snapshot: developmentProfile })
    return await publishProfileDraft({ siteId })
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

  async function assertCanManageSite(input: { siteId: string, userId: string }) {
    const account = await db.query.user.findFirst({
      where: eq(schema.user.id, input.userId),
      columns: { role: true },
    })
    if (account?.role === 'admin')
      return

    const membership = await db.query.kioskSiteMembers.findFirst({
      where: and(
        eq(schema.kioskSiteMembers.siteId, input.siteId),
        eq(schema.kioskSiteMembers.userId, input.userId),
        eq(schema.kioskSiteMembers.role, 'site_admin'),
      ),
    })
    if (!membership)
      throw createForbiddenError()
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
    addMember,
    assertCanManageSite,
    appendInteractionEntry,
    appendDeviceInteraction,
    createDevice,
    createProfileRelease,
    createSite,
    endDeviceVisitorSession,
    getDeviceProfile,
    getProfileRelease,
    getSiteProfile,
    listManagedSites,
    listSiteDevices,
    getVisitorSessionForDevice,
    getVisitorSessionForUser,
    startVisitorSession,
    registerDevelopmentDevice,
    resolveDeviceCredential,
    saveProfileDraft,
    setSiteInteractionRetentionDays,
    publishProfileDraft,
    purgeExpiredVisitorSessions,
  }
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
