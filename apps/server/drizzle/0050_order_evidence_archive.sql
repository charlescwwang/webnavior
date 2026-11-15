CREATE TABLE "order_evidence_policies" (
  "site_id" text PRIMARY KEY NOT NULL, "scope" text NOT NULL CHECK ("scope" = 'field-research'),
  "policy_version" text NOT NULL, "consent_reference" text, "disabled_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "order_evidence_bindings" (
  "id" text PRIMARY KEY NOT NULL, "site_id" text NOT NULL, "device_id" text NOT NULL,
  "visitor_session_id" text NOT NULL, "service_id" text NOT NULL, "document_id" text NOT NULL,
  "operation_id" text NOT NULL, "source" text NOT NULL CHECK ("source" IN ('ai', 'touch')),
  "merchant_origin" text NOT NULL, "merchant_store" text NOT NULL, "merchant_flow" text NOT NULL, "merchant_order_hash" text,
  "expected_digest" text NOT NULL, "registration_json" text NOT NULL, "policy_scope" text NOT NULL,
  "policy_version" text NOT NULL, "consent_reference" text, "created_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_evidence_binding_device_operation_uidx" ON "order_evidence_bindings" ("device_id", "operation_id");
CREATE INDEX "order_evidence_binding_session_idx" ON "order_evidence_bindings" ("visitor_session_id");
--> statement-breakpoint
CREATE TABLE "order_evidence_snapshots" (
  "id" text PRIMARY KEY NOT NULL, "binding_id" text NOT NULL REFERENCES "order_evidence_bindings"("id") ON DELETE RESTRICT,
  "payload_hash" text NOT NULL, "byte_size" integer NOT NULL CHECK ("byte_size" > 0 AND "byte_size" <= 1048576),
  "source" text NOT NULL CHECK ("source" IN ('page', 'readonly')), "source_path" text NOT NULL,
  "sanitizer_version" integer NOT NULL, "captured_at" timestamptz NOT NULL, "received_at" timestamptz NOT NULL, "stored_at" timestamptz NOT NULL,
  "retain_until" timestamptz NOT NULL, "scope" text NOT NULL, "policy_version" text NOT NULL,
  "consent_reference" text, "parse_state" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "order_evidence_snapshot_content_uidx" ON "order_evidence_snapshots" ("binding_id", "payload_hash");
CREATE INDEX "order_evidence_snapshot_retention_idx" ON "order_evidence_snapshots" ("retain_until");
--> statement-breakpoint
CREATE TABLE "order_evidence_aliases" (
  "device_id" text NOT NULL, "evidence_id" text NOT NULL,
  "snapshot_id" text NOT NULL REFERENCES "order_evidence_snapshots"("id") ON DELETE RESTRICT,
  "envelope_digest" text NOT NULL,
  CONSTRAINT "order_evidence_aliases_device_id_evidence_id_pk" PRIMARY KEY ("device_id", "evidence_id")
);
--> statement-breakpoint
CREATE TABLE "order_evidence_access" (
  "id" text PRIMARY KEY NOT NULL, "site_id" text NOT NULL, "device_id" text NOT NULL,
  "snapshot_id" text NOT NULL, "action" text NOT NULL, "created_at" timestamptz NOT NULL
);
