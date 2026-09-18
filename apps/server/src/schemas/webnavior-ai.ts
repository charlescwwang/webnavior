import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { nanoid } from '../utils/id'

/** A Server-managed upstream that may provide one or more AI capabilities. */
export type WebnaviorAiConnectionKind = 'ollama' | 'openai-compatible'
/** AI responsibilities managed centrally for all Webnavior Kiosks. */
export type WebnaviorAiCapability = 'chat' | 'vision' | 'asr' | 'tts' | 'embedding'

/** A cached model record discovered from an upstream's catalog. */
export interface WebnaviorAiDiscoveredModel {
  id: string
}

/**
 * One reusable upstream connection. Credentials remain ciphertext-only and
 * are never exposed to management clients after this record is created.
 */
export const webnaviorAiConnections = pgTable('webnavior_ai_connections', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  name: text('name').notNull(),
  kind: text('kind').$type<WebnaviorAiConnectionKind>().notNull(),
  baseURL: text('base_url').notNull(),
  apiKeyCiphertext: text('api_key_ciphertext'),
  timeoutMs: integer('timeout_ms').notNull().default(5000),
  discoveredModels: jsonb('discovered_models').$type<WebnaviorAiDiscoveredModel[]>().notNull().default([]),
  discoveredAt: timestamp('discovered_at'),
  lastCheckedAt: timestamp('last_checked_at'),
  lastCheckError: text('last_check_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
}, table => [
  uniqueIndex('webnavior_ai_connections_name_uidx').on(table.name),
  index('webnavior_ai_connections_kind_idx').on(table.kind),
])

/**
 * The single live choice for one system capability. A capability references a
 * connection rather than duplicating endpoint or credential configuration.
 */
export const webnaviorAiCapabilityBindings = pgTable('webnavior_ai_capability_bindings', {
  id: text('id').primaryKey().$defaultFn(() => nanoid()),
  capability: text('capability').$type<WebnaviorAiCapability>().notNull(),
  connectionId: text('connection_id').notNull().references(() => webnaviorAiConnections.id, { onDelete: 'restrict' }),
  modelId: text('model_id').notNull(),
  /** TTS only; omitted for every other capability. */
  voice: text('voice'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => /* @__PURE__ */ new Date()).notNull(),
}, table => [
  uniqueIndex('webnavior_ai_capability_bindings_capability_uidx').on(table.capability),
  index('webnavior_ai_capability_bindings_connection_idx').on(table.connectionId),
])

export const webnaviorAiConnectionsRelations = relations(webnaviorAiConnections, ({ many }) => ({
  capabilityBindings: many(webnaviorAiCapabilityBindings),
}))

export const webnaviorAiCapabilityBindingsRelations = relations(webnaviorAiCapabilityBindings, ({ one }) => ({
  connection: one(webnaviorAiConnections, {
    fields: [webnaviorAiCapabilityBindings.connectionId],
    references: [webnaviorAiConnections.id],
  }),
}))

export type WebnaviorAiConnection = InferSelectModel<typeof webnaviorAiConnections>
export type NewWebnaviorAiConnection = InferInsertModel<typeof webnaviorAiConnections>
export type WebnaviorAiCapabilityBinding = InferSelectModel<typeof webnaviorAiCapabilityBindings>
export type NewWebnaviorAiCapabilityBinding = InferInsertModel<typeof webnaviorAiCapabilityBindings>
