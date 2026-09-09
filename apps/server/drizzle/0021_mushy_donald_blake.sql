ALTER TABLE "kiosk_sites" ADD COLUMN "interaction_retention_days" integer DEFAULT 180 NOT NULL;--> statement-breakpoint
ALTER TABLE "kiosk_visitor_sessions" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
UPDATE "kiosk_visitor_sessions" SET "expires_at" = "created_at" + interval '180 days' WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "kiosk_visitor_sessions" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "kiosk_visitor_sessions_expiry_idx" ON "kiosk_visitor_sessions" USING btree ("expires_at");
