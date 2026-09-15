import type { DeviceSettings } from '@proj-airi/kiosk-proactive'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import { defaultDeviceSettings } from '@proj-airi/kiosk-proactive'
import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { nanoid } from '../utils/id'
import { user } from './accounts'

/** A person's authorization level within one kiosk site. */
export type KioskMemberRole = 'content_manager' | 'site_admin' | 'viewer'
/** The enrollment flow that established a device identity. */
export type KioskRegistrationMethod = 'development' | 'qr_code'
/** The lifecycle state of a persisted kiosk visitor session. */
export type KioskVisitorSessionState = 'active' | 'completed' | 'cancelled' | 'idle'
/** The kind of ordered customer interaction record retained by the POC. */
export type KioskInteractionEntryKind = 'user_text' | 'assistant_text' | 'asr_transcript' | 'tool_call' | 'tool_result' | 'service_event' | 'order_result'
/** Binary evidence captured during an internal kiosk POC interaction. */
export type KioskVisitorMediaKind = 'audio_recording' | 'triggered_image' | 'triggered_video' | 'continuous_video'
/** Controls whether an internal POC preserves camera evidence for a Site. */
export interface KioskMediaCapturePolicy {
  mode: 'off' | 'snapshot' | 'triggered' | 'continuous'
}
/** Server-selected resource budget for a kiosk Site. */
export type KioskPerformanceProfile = 'constrained' | 'balanced' | 'high'

/** A site's explicit runtime model choices. Missing entries inherit the system default. */
export interface KioskModelOverrides {
  asr?: string
  llm?: string
  tts?: string
  vision?: string
}

/** A server-owned avatar file that an immutable kiosk profile may reference. */
export interface KioskCharacterAssetReference {
  format: 'live2d_zip' | 'vrm'
  id: string
  name: string
  sha256: string
}

/** Portable Character Card v3 text retained by a Webnavior experience. */
export interface KioskCharacterCard {
  description: string
  personality: string
  postHistoryInstructions: string
  scenario: string
  systemPrompt: string
}

/** The complete, versioned configuration a kiosk receives at bootstrap. */
export interface KioskProfileSnapshot {
  assistanceReminderPrompt: string
  agentInstructions: string
  characterName: string
  /** Optional visual avatar selected for the service character. */
  characterAsset?: KioskCharacterAssetReference
  /** Character identity and behavioural context imported from Character Card v3. */
  characterCard?: KioskCharacterCard
  greetingPrompt: string
  interactiveService: {
    description: string
    id: string
    title: string
    url: string
  }
  surveyUrl: string
  version: 1
  /** Prevents keyboard chat when this released Profile is operated by voice. */
  voiceConversationOnly: boolean
}

/** A site owns kiosk devices, configuration releases, and collected interaction data. */
export const kioskSites = pgTable('kiosk_sites', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  name: text('name').notNull(),
  /** Stable machine key for a system-created Site, such as the local POC Site. */
  slug: text('slug').unique(),
  /** Days to retain completed interaction data; 0 removes it on the next sweep. */
  interactionRetentionDays: integer('interaction_retention_days').notNull().default(180),
  /** Camera evidence is opt-in and independent from proactive VLM observation. */
  mediaCapturePolicy: jsonb('media_capture_policy').$type<KioskMediaCapturePolicy>().notNull().default({ mode: 'triggered' }),
  /** Enables Server VLM copy generation after local MediaPipe has qualified a trigger. */
  proactiveVlmEnabled: integer('proactive_vlm_enabled').notNull().default(0),
  /** Keeps constrained kiosk hardware from being configured with an unsafe capture workload. */
  performanceProfile: text('performance_profile').$type<KioskPerformanceProfile>().notNull().default('balanced'),
  /** Site-calibrated Silero VAD probability threshold; higher values reject more ambient noise. */
  voiceVadThreshold: text('voice_vad_threshold').notNull().default('0.72'),
  /** Site-specific choices from the system administrator's approved model catalog. */
  modelOverrides: jsonb('model_overrides').$type<KioskModelOverrides>().notNull().default({}),
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
  /** Device-specific overrides and the administrator's local-edit delegation policy. */
  settings: jsonb('settings').$type<DeviceSettings>().notNull().default(defaultDeviceSettings),
  /** Stops new sessions and revokes every browser credential without removing retained history. */
  disabledAt: timestamp('disabled_at'),
  /** Hides the decommissioned device from operations while preserving audit and visitor records. */
  deletedAt: timestamp('deleted_at'),
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

/** An editable, selectable configuration draft for one site's kiosk experience. */
export const kioskProfileDrafts = pgTable('kiosk_profile_drafts', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  siteId: text('site_id').notNull().references(() => kioskSites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  snapshot: jsonb('snapshot').$type<KioskProfileSnapshot>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
}, table => [index('kiosk_profile_drafts_site_idx').on(table.siteId)])

/** Immutable metadata for a validated character model saved on the server volume. */
export const kioskCharacterAssets = pgTable('kiosk_character_assets', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  siteId: text('site_id').notNull().references(() => kioskSites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  format: text('format').notNull().$type<KioskCharacterAssetReference['format']>(),
  sha256: text('sha256').notNull(),
  byteSize: integer('byte_size').notNull(),
  /** Sanitized CCv3 fields, retained for future editing without retaining AIRI runtime configuration. */
  card: jsonb('card').$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  index('kiosk_character_assets_site_idx').on(table.siteId),
  uniqueIndex('kiosk_character_assets_site_hash_uidx').on(table.siteId, table.sha256),
])

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

/** Private media retained beside a visitor session on the server volume. */
export const kioskVisitorMedia = pgTable('kiosk_visitor_media', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  visitorSessionId: text('visitor_session_id').notNull().references(() => kioskVisitorSessions.id, { onDelete: 'cascade' }),
  /** The triggering timeline event when this is an interaction evidence clip. */
  interactionEntryId: text('interaction_entry_id').references(() => kioskInteractionEntries.id, { onDelete: 'set null' }),
  kind: text('kind').notNull().$type<KioskVisitorMediaKind>(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  index('kiosk_visitor_media_session_created_idx').on(table.visitorSessionId, table.createdAt),
  index('kiosk_visitor_media_entry_idx').on(table.interactionEntryId),
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
export type KioskCharacterAsset = InferSelectModel<typeof kioskCharacterAssets>
export type KioskVisitorSession = InferSelectModel<typeof kioskVisitorSessions>
export type KioskInteractionEntry = InferSelectModel<typeof kioskInteractionEntries>
export type KioskVisitorMedia = InferSelectModel<typeof kioskVisitorMedia>

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
  media: many(kioskVisitorMedia),
  profileRelease: one(kioskProfileReleases, { fields: [kioskVisitorSessions.profileReleaseId], references: [kioskProfileReleases.id] }),
  site: one(kioskSites, { fields: [kioskVisitorSessions.siteId], references: [kioskSites.id] }),
}))

export const kioskInteractionEntriesRelations = relations(kioskInteractionEntries, ({ one }) => ({
  visitorSession: one(kioskVisitorSessions, { fields: [kioskInteractionEntries.visitorSessionId], references: [kioskVisitorSessions.id] }),
}))

export const kioskVisitorMediaRelations = relations(kioskVisitorMedia, ({ one }) => ({
  interactionEntry: one(kioskInteractionEntries, { fields: [kioskVisitorMedia.interactionEntryId], references: [kioskInteractionEntries.id] }),
  visitorSession: one(kioskVisitorSessions, { fields: [kioskVisitorMedia.visitorSessionId], references: [kioskVisitorSessions.id] }),
}))
