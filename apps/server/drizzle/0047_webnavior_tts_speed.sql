ALTER TABLE "webnavior_ai_provider_profiles" ADD COLUMN "speed" double precision;
--> statement-breakpoint
ALTER TABLE "webnavior_ai_provider_profiles" ADD CONSTRAINT "webnavior_ai_provider_profiles_speed_range" CHECK ("speed" IS NULL OR ("speed" >= 0.25 AND "speed" <= 4));
