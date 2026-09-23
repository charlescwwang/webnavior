DROP TABLE IF EXISTS "webnavior_ai_capability_bindings";
--> statement-breakpoint
DROP TABLE IF EXISTS "webnavior_ai_connections";
--> statement-breakpoint
CREATE TABLE "webnavior_ai_provider_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "capability" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "base_url" text NOT NULL,
  "api_key_ciphertext" text,
  "timeout_ms" integer DEFAULT 5000 NOT NULL,
  "model_id" text,
  "voice" text,
  "discovered_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "discovered_at" timestamp,
  "last_checked_at" timestamp,
  "last_check_error" text,
  "verified_at" timestamp,
  "last_verification_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webnavior_ai_capability_selections" (
  "capability" text PRIMARY KEY NOT NULL,
  "provider_profile_id" text NOT NULL REFERENCES "webnavior_ai_provider_profiles"("id") ON DELETE RESTRICT,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "webnavior_ai_provider_profiles_capability_name_uidx" ON "webnavior_ai_provider_profiles" USING btree ("capability", "name");
--> statement-breakpoint
CREATE INDEX "webnavior_ai_provider_profiles_capability_idx" ON "webnavior_ai_provider_profiles" USING btree ("capability");
--> statement-breakpoint
CREATE INDEX "webnavior_ai_capability_selections_profile_idx" ON "webnavior_ai_capability_selections" USING btree ("provider_profile_id");
