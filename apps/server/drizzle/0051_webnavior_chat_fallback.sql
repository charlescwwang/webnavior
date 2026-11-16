ALTER TABLE "webnavior_ai_capability_selections" ADD COLUMN "fallback_provider_profile_id" text;
--> statement-breakpoint
ALTER TABLE "webnavior_ai_capability_selections" ADD CONSTRAINT "webnavior_ai_capability_selections_fallback_provider_profile_id_webnavior_ai_provider_profiles_id_fk" FOREIGN KEY ("fallback_provider_profile_id") REFERENCES "public"."webnavior_ai_provider_profiles"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "webnavior_ai_capability_selections_fallback_idx" ON "webnavior_ai_capability_selections" USING btree ("fallback_provider_profile_id");
--> statement-breakpoint
ALTER TABLE "webnavior_ai_capability_selections" ADD CONSTRAINT "webnavior_ai_capability_selections_chat_fallback" CHECK ("fallback_provider_profile_id" IS NULL OR ("capability" = 'chat' AND "fallback_provider_profile_id" <> "provider_profile_id"));
