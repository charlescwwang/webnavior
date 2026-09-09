CREATE TABLE "kiosk_profile_drafts" (
	"site_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kiosk_profile_drafts" ADD CONSTRAINT "kiosk_profile_drafts_site_id_kiosk_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."kiosk_sites"("id") ON DELETE cascade ON UPDATE no action;