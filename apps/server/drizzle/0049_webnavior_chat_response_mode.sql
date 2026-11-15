ALTER TABLE "webnavior_ai_provider_profiles" ADD COLUMN "response_mode" text DEFAULT 'auto' NOT NULL;
ALTER TABLE "webnavior_ai_provider_profiles" ADD CONSTRAINT "webnavior_ai_provider_profiles_response_mode" CHECK ("response_mode" IN ('auto', 'json', 'sse'));
