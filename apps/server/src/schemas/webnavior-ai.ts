import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import { relations } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { nanoid } from '../utils/id'

/** A Server-managed protocol family for one capability-specific provider profile. */
export type WebnaviorAiConnectionKind = 'llama-cpp' | 'ollama' | 'openai-compatible'
/** AI responsibilities managed centrally for all Webnavior Kiosks. */
export type WebnaviorAiCapability = 'chat' | 'vision' | 'asr' | 'tts' | 'embedding'

/** A cached model record discovered from an upstream's catalog. */
export interface WebnaviorAiDiscoveredModel {
  id: string
}

/** One capability-scoped Provider setting, including its selected model. */
export const webnaviorAiProviderProfiles = pgTable('webnavior_ai_provider_profiles', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  capability: text('capability').$type<WebnaviorAiCapability>().notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<WebnaviorAiConnectionKind>().notNull(),
  baseURL: text('base_url').notNull(),
  apiKeyCiphertext: text('api_key_ciphertext'),
  timeoutMs: integer('timeout_ms').notNull().default(30_000),
  modelId: text('model_id'),
  /** TTS only; omitted for every other capability. */
  voice: text('voice'),
  discoveredModels: jsonb('discovered_models').$type<WebnaviorAiDiscoveredModel[]>().notNull().default([]),
  discoveredAt: timestamp('discovered_at'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastCheckError: text('last_check_error'),
  verifiedAt: timestamp('verified_at'),
  lastVerificationError: text('last_verification_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
}, table => [
  uniqueIndex('webnavior_ai_provider_profiles_capability_name_uidx').on(table.capability, table.name),
  index('webnavior_ai_provider_profiles_capability_idx').on(table.capability),
])

/** One versioned, Server-owned embedding baseline for Kiosk speech policy. */
export const kioskSpeechGuardSets = pgTable('kiosk_speech_guard_sets', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  embeddingProfileId: text('embedding_profile_id').notNull().references(() => webnaviorAiProviderProfiles.id, { onDelete: 'cascade' }),
  embeddingModelId: text('embedding_model_id').notNull(),
  sourceHash: text('source_hash').notNull(),
  sourceVersion: text('source_version').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  uniqueIndex('kiosk_speech_guard_sets_profile_model_hash_uidx').on(table.embeddingProfileId, table.embeddingModelId, table.sourceHash),
  index('kiosk_speech_guard_sets_profile_model_idx').on(table.embeddingProfileId, table.embeddingModelId),
])

/** One labelled prototype embedding within a Speech Guard baseline. */
export const kioskSpeechGuardPrototypes = pgTable('kiosk_speech_guard_prototypes', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  setId: text('set_id').notNull().references(() => kioskSpeechGuardSets.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  label: text('label').notNull(),
  requiresContext: boolean('requires_context').notNull(),
  embedding: jsonb('embedding').$type<number[]>().notNull(),
}, table => [
  uniqueIndex('kiosk_speech_guard_prototypes_set_source_uidx').on(table.setId, table.sourceId),
  index('kiosk_speech_guard_prototypes_set_idx').on(table.setId),
])

/**
 * The one Provider profile that will compile into runtime configuration for a
 * capability. Profiles are deliberately never shared across capabilities.
 */
export const webnaviorAiCapabilitySelections = pgTable('webnavior_ai_capability_selections', {
  capability: text('capability').primaryKey().$type<WebnaviorAiCapability>(),
  providerProfileId: text('provider_profile_id').notNull().references(() => webnaviorAiProviderProfiles.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
}, table => [
  index('webnavior_ai_capability_selections_profile_idx').on(table.providerProfileId),
])

export const webnaviorAiProviderProfilesRelations = relations(webnaviorAiProviderProfiles, ({ many }) => ({
  selections: many(webnaviorAiCapabilitySelections),
}))

export const webnaviorAiCapabilitySelectionsRelations = relations(webnaviorAiCapabilitySelections, ({ one }) => ({
  providerProfile: one(webnaviorAiProviderProfiles, {
    fields: [webnaviorAiCapabilitySelections.providerProfileId],
    references: [webnaviorAiProviderProfiles.id],
  }),
}))

export type WebnaviorAiProviderProfile = InferSelectModel<typeof webnaviorAiProviderProfiles>
export type NewWebnaviorAiProviderProfile = InferInsertModel<typeof webnaviorAiProviderProfiles>
export type WebnaviorAiCapabilitySelection = InferSelectModel<typeof webnaviorAiCapabilitySelections>
export type NewWebnaviorAiCapabilitySelection = InferInsertModel<typeof webnaviorAiCapabilitySelections>
export type KioskSpeechGuardSet = InferSelectModel<typeof kioskSpeechGuardSets>
export type KioskSpeechGuardPrototype = InferSelectModel<typeof kioskSpeechGuardPrototypes>
