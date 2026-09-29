CREATE TABLE IF NOT EXISTS "kiosk_system_one_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "base_url" text NOT NULL,
  "api_key_ciphertext" text,
  "model_id" text NOT NULL,
  "timeout_ms" integer DEFAULT 5000 NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp,
  "last_checked_at" timestamp,
  "last_check_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kiosk_system_one_profiles_name_uidx" ON "kiosk_system_one_profiles" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kiosk_system_one_profiles_active_idx" ON "kiosk_system_one_profiles" USING btree ("is_active");
