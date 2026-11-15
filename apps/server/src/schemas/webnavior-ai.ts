import type { ChatResponseMode } from '@proj-airi/stage-shared/ai-provider'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import { relations, sql } from 'drizzle-orm'
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { nanoid } from '../utils/id'

/** A Server-managed protocol family for one capability-specific provider profile. */
export type WebnaviorAiConnectionKind = 'llama-cpp' | 'ollama' | 'openai-compatible'
/** AI responsibilities managed centrally for all Webnavior Kiosks. */
export type WebnaviorAiCapability = 'chat' | 'vision' | 'asr' | 'tts'
/** A Jev-wire-compatible System One server implementation. */
export type KioskSystemOneImplementation = 'dasein' | 'lookski' | 'slm' | 'openai-decisions'

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
  /** Chat OpenAI-compatible profiles only; forwarded to the model chat template. */
  enableThinking: boolean('enable_thinking').notNull().default(false),
  /** Chat only; auto preserves the requesting endpoint's current transport. */
  responseMode: text('response_mode').$type<ChatResponseMode>().notNull().default('auto'),
  /** TTS only; omitted for every other capability. */
  voice: text('voice'),
  /** OpenAI-compatible TTS synthesis multiplier; null uses the standard1x speed. */
  speed: doublePrecision('speed'),
  discoveredModels: jsonb('discovered_models').$type<WebnaviorAiDiscoveredModel[]>().notNull().default([]),
  discoveredAt: timestamp('discovered_at'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastCheckError: text('last_check_error'),
  verifiedAt: timestamp('verified_at'),
  lastVerificationError: text('last_verification_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
}, table => [
  check('webnavior_ai_provider_profiles_response_mode', sql`${table.responseMode} IN ('auto', 'json', 'sse')`),
  check('webnavior_ai_provider_profiles_speed_range', sql`${table.speed} IS NULL OR (${table.speed} >= 0.25 AND ${table.speed} <= 4)`),
  uniqueIndex('webnavior_ai_provider_profiles_capability_name_uidx').on(table.capability, table.name),
  index('webnavior_ai_provider_profiles_capability_idx').on(table.capability),
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

/**
 * One Server-owned System One connection selectable for Kiosk Fast Path. It is
 * deliberately separate from AI capability profiles: it answers typed decisions
 * rather than serving chat, speech, vision, or embeddings.
 */
export const kioskSystemOneProfiles = pgTable('kiosk_system_one_profiles', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  name: text('name').notNull(),
  // Existing System One profiles were Dasein-only before implementation became
  // explicit. The database default preserves those profiles during `db:push`.
  implementation: text('implementation').$type<KioskSystemOneImplementation>().notNull().default('dasein'),
  baseURL: text('base_url').notNull(),
  apiKeyCiphertext: text('api_key_ciphertext'),
  modelId: text('model_id').notNull(),
  timeoutMs: integer('timeout_ms').notNull().default(5_000),
  isActive: boolean('is_active').notNull().default(false),
  verifiedAt: timestamp('verified_at'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastCheckError: text('last_check_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
}, table => [
  uniqueIndex('kiosk_system_one_profiles_name_uidx').on(table.name),
  index('kiosk_system_one_profiles_active_idx').on(table.isActive),
])

/**
 * Store-specific System One policy. An empty decision instruction means the
 * current Server default, allowing it to evolve without rewriting every row.
 */
export const kioskSystemOnePolicies = pgTable('kiosk_system_one_policies', {
  decisionInstruction: text('decision_instruction').notNull().default(''),
  id: text('id').primaryKey(),
  storeInstruction: text('store_instruction').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
})

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
export type KioskSystemOneProfile = InferSelectModel<typeof kioskSystemOneProfiles>
export type NewKioskSystemOneProfile = InferInsertModel<typeof kioskSystemOneProfiles>
export type KioskSystemOnePolicy = InferSelectModel<typeof kioskSystemOnePolicies>
export type NewKioskSystemOnePolicy = InferInsertModel<typeof kioskSystemOnePolicies>
