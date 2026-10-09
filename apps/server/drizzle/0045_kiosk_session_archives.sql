ALTER TABLE "kiosk_visitor_sessions" ADD COLUMN IF NOT EXISTS "access_released_at" timestamp;
--> statement-breakpoint
ALTER TABLE "kiosk_visitor_media" ADD COLUMN IF NOT EXISTS "sha256" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kiosk_session_associations" (
  "id" text PRIMARY KEY NOT NULL,
  "visitor_session_id" text NOT NULL REFERENCES "kiosk_visitor_sessions"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "authority" text NOT NULL,
  "external_reference" text NOT NULL,
  "evidence_reference" text NOT NULL,
  "verified_at" timestamp NOT NULL,
  "link_released_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_session_associations_verified_uidx"
  ON "kiosk_session_associations" ("visitor_session_id", "kind", "authority", "external_reference");
