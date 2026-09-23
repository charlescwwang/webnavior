ALTER TABLE "webnavior_ai_provider_profiles" ALTER COLUMN "timeout_ms" SET DEFAULT 30000;
--> statement-breakpoint
UPDATE "webnavior_ai_provider_profiles" SET "timeout_ms" = 30000 WHERE "timeout_ms" = 5000;
