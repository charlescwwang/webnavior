CREATE TABLE "kiosk_visitor_media" (
  "id" text PRIMARY KEY NOT NULL,
  "visitor_session_id" text NOT NULL REFERENCES "kiosk_visitor_sessions"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "mime_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "started_at" timestamp,
  "ended_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "kiosk_visitor_media_session_created_idx" ON "kiosk_visitor_media" ("visitor_session_id", "created_at");
