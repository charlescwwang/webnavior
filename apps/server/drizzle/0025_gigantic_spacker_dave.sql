ALTER TABLE "kiosk_profile_drafts" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "kiosk_profile_drafts" SET "id" = "site_id" WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "kiosk_profile_drafts" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "kiosk_profile_drafts" DROP CONSTRAINT "kiosk_profile_drafts_pkey";--> statement-breakpoint
ALTER TABLE "kiosk_profile_drafts" ADD CONSTRAINT "kiosk_profile_drafts_pkey" PRIMARY KEY("id");--> statement-breakpoint
CREATE INDEX "kiosk_profile_drafts_site_idx" ON "kiosk_profile_drafts" USING btree ("site_id");
