CREATE TABLE IF NOT EXISTS "webnavior_ai_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "base_url" text NOT NULL,
  "api_key_ciphertext" text,
  "timeout_ms" integer DEFAULT 5000 NOT NULL,
  "discovered_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "discovered_at" timestamp,
  "last_checked_at" timestamp,
  "last_check_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webnavior_ai_capability_bindings" (
  "id" text PRIMARY KEY NOT NULL,
  "capability" text NOT NULL,
  "connection_id" text NOT NULL REFERENCES "webnavior_ai_connections"("id") ON DELETE RESTRICT,
  "model_id" text NOT NULL,
  "voice" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webnavior_ai_connections_name_uidx" ON "webnavior_ai_connections" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webnavior_ai_connections_kind_idx" ON "webnavior_ai_connections" USING btree ("kind");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webnavior_ai_capability_bindings_capability_uidx" ON "webnavior_ai_capability_bindings" USING btree ("capability");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webnavior_ai_capability_bindings_connection_idx" ON "webnavior_ai_capability_bindings" USING btree ("connection_id");
--> statement-breakpoint
ALTER TABLE "kiosk_sites" DROP COLUMN IF EXISTS "model_overrides";
