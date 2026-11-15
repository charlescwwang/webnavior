import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/** Only explicitly enrolled research Sites collect evidence under this policy. */
export const orderEvidencePolicies = pgTable('order_evidence_policies', {
  siteId: text('site_id').primaryKey(),
  scope: text('scope').notNull(),
  policyVersion: text('policy_version').notNull(),
  consentReference: text('consent_reference'),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
})

/** Retained ownership has no cascading FK to operational visitors, devices or Sites. */
export const orderEvidenceBindings = pgTable('order_evidence_bindings', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull(),
  visitorSessionId: text('visitor_session_id').notNull(),
  serviceId: text('service_id').notNull(),
  documentId: text('document_id').notNull(),
  operationId: text('operation_id').notNull(),
  source: text('source').notNull(),
  merchantOrigin: text('merchant_origin').notNull(),
  merchantStore: text('merchant_store').notNull(),
  merchantFlow: text('merchant_flow').notNull(),
  merchantOrderHash: text('merchant_order_hash'),
  expectedDigest: text('expected_digest').notNull(),
  registrationJson: text('registration_json').notNull(),
  policyScope: text('policy_scope').notNull(),
  policyVersion: text('policy_version').notNull(),
  consentReference: text('consent_reference'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, table => [uniqueIndex('order_evidence_binding_device_operation_uidx').on(table.deviceId, table.operationId), index('order_evidence_binding_session_idx').on(table.visitorSessionId)])

/** One immutable content snapshot; observation is not proof of merchant acceptance. */
export const orderEvidenceSnapshots = pgTable('order_evidence_snapshots', {
  id: text('id').primaryKey(),
  bindingId: text('binding_id').notNull().references(() => orderEvidenceBindings.id, { onDelete: 'restrict' }),
  payloadHash: text('payload_hash').notNull(),
  byteSize: integer('byte_size').notNull(),
  source: text('source').notNull(),
  sourcePath: text('source_path').notNull(),
  sanitizerVersion: integer('sanitizer_version').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  storedAt: timestamp('stored_at', { withTimezone: true }).notNull(),
  retainUntil: timestamp('retain_until', { withTimezone: true }).notNull(),
  scope: text('scope').notNull(),
  policyVersion: text('policy_version').notNull(),
  /** Unrecorded consent remains unknown; device uploads cannot assert it. */
  consentReference: text('consent_reference'),
  parseState: text('parse_state').notNull().default('pending'),
}, table => [uniqueIndex('order_evidence_snapshot_content_uidx').on(table.bindingId, table.payloadHash), index('order_evidence_snapshot_retention_idx').on(table.retainUntil)])

/** Aliases bind retried evidence IDs to immutable content without duplicating a business snapshot. */
export const orderEvidenceAliases = pgTable('order_evidence_aliases', {
  deviceId: text('device_id').notNull(),
  evidenceId: text('evidence_id').notNull(),
  snapshotId: text('snapshot_id').notNull().references(() => orderEvidenceSnapshots.id, { onDelete: 'restrict' }),
  envelopeDigest: text('envelope_digest').notNull(),
}, table => [primaryKey({ columns: [table.deviceId, table.evidenceId] })])

/** Access audit survives operational deletion together with the research archive. */
export const orderEvidenceAccess = pgTable('order_evidence_access', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull(),
  deviceId: text('device_id').notNull(),
  snapshotId: text('snapshot_id').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})
