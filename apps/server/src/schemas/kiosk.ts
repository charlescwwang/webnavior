import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { nanoid } from '../utils/id'
import { user } from './accounts'

/** A person's authorization level within one kiosk site. */
export type KioskMemberRole = 'site_admin' | 'viewer'
/** The enrollment flow that established a device identity. */
export type KioskRegistrationMethod = 'development' | 'qr_code'
/** The lifecycle state of a persisted kiosk visitor session. */
export type KioskVisitorSessionState = 'active' | 'completed' | 'cancelled' | 'idle'
/** The kind of ordered customer interaction record retained by the POC. */
export type KioskInteractionEntryKind = 'user_text' | 'assistant_text' | 'asr_transcript' | 'tool_call' | 'tool_result' | 'service_event' | 'order_result'

/** The complete, versioned configuration a kiosk receives at bootstrap. */
export interface KioskProfileSnapshot {
  assistanceReminderPrompt: string
  agentInstructions: string
  characterName: string
  greetingPrompt: string
  interactiveService: {
    description: string
    id: string
    title: string
    url: string
  }
  surveyUrl: string
  version: 1
}

/** A site owns kiosk devices, configuration releases, and collected interaction data. */
export const kioskSites = pgTable('kiosk_sites', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  name: text('name').notNull(),
  /** Stable machine key for a system-created Site, such as the local POC Site. */
  slug: text('slug').unique(),
  /** Days to retain completed interaction data; 0 removes it on the next sweep. */
  interactionRetentionDays: integer('interaction_retention_days').notNull().default(180),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
})

/** Grants a Better Auth account a role within exactly one kiosk site. */
export const kioskSiteMembers = pgTable('kiosk_site_members', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  siteId: text('site_id').notNull().references(() => kioskSites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull().$type<KioskMemberRole>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  uniqueIndex('kiosk_site_members_site_user_uidx').on(table.siteId, table.userId),
  index('kiosk_site_members_user_idx').on(table.userId),
])

/** A browser installation that runs the kiosk host for a site. */
export const kioskDevices = pgTable('kiosk_devices', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  siteId: text('site_id').notNull().references(() => kioskSites.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  registrationMethod: text('registration_method').notNull().$type<KioskRegistrationMethod>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
}, table => [index('kiosk_devices_site_idx').on(table.siteId)])

/** A revocable server-side record for one opaque kiosk browser credential. */
export const kioskDeviceCredentials = pgTable('kiosk_device_credentials', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  deviceId: text('device_id').notNull().references(() => kioskDevices.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  revokedAt: timestamp('revoked_at'),
}, table => [index('kiosk_device_credentials_device_idx').on(table.deviceId)])

/** An immutable kiosk configuration snapshot released for one site. */
export const kioskProfileReleases = pgTable('kiosk_profile_releases', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  siteId: text('site_id').notNull().references(() => kioskSites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  snapshot: jsonb('snapshot').$type<KioskProfileSnapshot>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [index('kiosk_profile_releases_site_idx').on(table.siteId)])

/** The single editable configuration draft for a site's POC kiosk experience. */
export const kioskProfileDrafts = pgTable('kiosk_profile_drafts', {
  siteId: text('site_id').primaryKey().references(() => kioskSites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  snapshot: jsonb('snapshot').$type<KioskProfileSnapshot>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
})

/** Associates a device with its one active Profile release. */
export const kioskDeviceProfileAssignments = pgTable('kiosk_device_profile_assignments', {
  deviceId: text('device_id').primaryKey().references(() => kioskDevices.id, { onDelete: 'cascade' }),
  profileReleaseId: text('profile_release_id').notNull().references(() => kioskProfileReleases.id, { onDelete: 'restrict' }),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
})

/** The persisted lifecycle of one customer interaction at a kiosk. */
export const kioskVisitorSessions = pgTable('kiosk_visitor_sessions', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  siteId: text('site_id').notNull().references(() => kioskSites.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull().references(() => kioskDevices.id, { onDelete: 'restrict' }),
  profileReleaseId: text('profile_release_id').notNull().references(() => kioskProfileReleases.id, { onDelete: 'restrict' }),
  serviceId: text('service_id').notNull(),
  state: text('state').notNull().$type<KioskVisitorSessionState>().default('active'),
  endedAt: timestamp('ended_at'),
  /** Captured at creation so later Site policy changes do not alter existing records. */
  expiresAt: timestamp('expires_at').notNull(),
  /** Allocated atomically so transcript and event entries retain a stable session order. */
  lastSequence: integer('last_sequence').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  index('kiosk_visitor_sessions_site_created_idx').on(table.siteId, table.createdAt),
  index('kiosk_visitor_sessions_device_created_idx').on(table.deviceId, table.createdAt),
  index('kiosk_visitor_sessions_expiry_idx').on(table.expiresAt),
])

/** One ordered transcript turn, tool exchange, or iframe lifecycle event within a visitor session. */
export const kioskInteractionEntries = pgTable('kiosk_interaction_entries', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  visitorSessionId: text('visitor_session_id').notNull().references(() => kioskVisitorSessions.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  kind: text('kind').notNull().$type<KioskInteractionEntryKind>(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  uniqueIndex('kiosk_interaction_entries_session_sequence_uidx').on(table.visitorSessionId, table.sequence),
  index('kiosk_interaction_entries_session_idx').on(table.visitorSessionId),
])

/** Append-only record of access and future kiosk-management actions. */
export const kioskAuditLogs = pgTable('kiosk_audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  siteId: text('site_id').notNull().references(() => kioskSites.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [index('kiosk_audit_logs_site_created_idx').on(table.siteId, table.createdAt)])

export type KioskSite = InferSelectModel<typeof kioskSites>
export type NewKioskSite = InferInsertModel<typeof kioskSites>
export type KioskDevice = InferSelectModel<typeof kioskDevices>
export type KioskProfileRelease = InferSelectModel<typeof kioskProfileReleases>
export type KioskProfileDraft = InferSelectModel<typeof kioskProfileDrafts>
export type KioskVisitorSession = InferSelectModel<typeof kioskVisitorSessions>
export type KioskInteractionEntry = InferSelectModel<typeof kioskInteractionEntries>

export const kioskSitesRelations = relations(kioskSites, ({ many, one }) => ({
  devices: many(kioskDevices),
  members: many(kioskSiteMembers),
  profileReleases: many(kioskProfileReleases),
  profileDraft: one(kioskProfileDrafts),
  visitorSessions: many(kioskVisitorSessions),
}))

export const kioskProfileDraftsRelations = relations(kioskProfileDrafts, ({ one }) => ({
  site: one(kioskSites, { fields: [kioskProfileDrafts.siteId], references: [kioskSites.id] }),
}))

export const kioskDevicesRelations = relations(kioskDevices, ({ one, many }) => ({
  site: one(kioskSites, { fields: [kioskDevices.siteId], references: [kioskSites.id] }),
  assignment: one(kioskDeviceProfileAssignments),
  visitorSessions: many(kioskVisitorSessions),
}))

export const kioskVisitorSessionsRelations = relations(kioskVisitorSessions, ({ one, many }) => ({
  device: one(kioskDevices, { fields: [kioskVisitorSessions.deviceId], references: [kioskDevices.id] }),
  entries: many(kioskInteractionEntries),
  profileRelease: one(kioskProfileReleases, { fields: [kioskVisitorSessions.profileReleaseId], references: [kioskProfileReleases.id] }),
  site: one(kioskSites, { fields: [kioskVisitorSessions.siteId], references: [kioskSites.id] }),
}))

export const kioskInteractionEntriesRelations = relations(kioskInteractionEntries, ({ one }) => ({
  visitorSession: one(kioskVisitorSessions, { fields: [kioskInteractionEntries.visitorSessionId], references: [kioskVisitorSessions.id] }),
}))
