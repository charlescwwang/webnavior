CREATE TABLE "kiosk_character_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"card" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kiosk_character_assets" ADD CONSTRAINT "kiosk_character_assets_site_id_kiosk_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."kiosk_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kiosk_character_assets_site_idx" ON "kiosk_character_assets" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_character_assets_site_hash_uidx" ON "kiosk_character_assets" USING btree ("site_id","sha256");