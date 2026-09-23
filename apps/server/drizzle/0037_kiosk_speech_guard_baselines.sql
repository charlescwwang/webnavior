CREATE TABLE "kiosk_speech_guard_sets" (
  "id" text PRIMARY KEY NOT NULL,
  "embedding_profile_id" text NOT NULL REFERENCES "webnavior_ai_provider_profiles"("id") ON DELETE CASCADE,
  "embedding_model_id" text NOT NULL,
  "source_hash" text NOT NULL,
  "source_version" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_speech_guard_prototypes" (
  "id" text PRIMARY KEY NOT NULL,
  "set_id" text NOT NULL REFERENCES "kiosk_speech_guard_sets"("id") ON DELETE CASCADE,
  "source_id" text NOT NULL,
  "label" text NOT NULL,
  "requires_context" boolean NOT NULL,
  "embedding" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_speech_guard_sets_profile_model_hash_uidx" ON "kiosk_speech_guard_sets" USING btree ("embedding_profile_id","embedding_model_id","source_hash");
--> statement-breakpoint
CREATE INDEX "kiosk_speech_guard_sets_profile_model_idx" ON "kiosk_speech_guard_sets" USING btree ("embedding_profile_id","embedding_model_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_speech_guard_prototypes_set_source_uidx" ON "kiosk_speech_guard_prototypes" USING btree ("set_id","source_id");
--> statement-breakpoint
CREATE INDEX "kiosk_speech_guard_prototypes_set_idx" ON "kiosk_speech_guard_prototypes" USING btree ("set_id");
