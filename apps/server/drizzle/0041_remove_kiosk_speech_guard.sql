DELETE FROM "webnavior_ai_capability_selections" WHERE "capability" = 'embedding';
--> statement-breakpoint
DELETE FROM "webnavior_ai_provider_profiles" WHERE "capability" = 'embedding';
--> statement-breakpoint
DROP TABLE IF EXISTS "kiosk_speech_guard_prototypes";
--> statement-breakpoint
DROP TABLE IF EXISTS "kiosk_speech_guard_sets";
