CREATE TABLE "kiosk_device_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "kiosk_device_credentials_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "kiosk_sites" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "kiosk_device_credentials" ADD CONSTRAINT "kiosk_device_credentials_device_id_kiosk_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."kiosk_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kiosk_device_credentials_device_idx" ON "kiosk_device_credentials" USING btree ("device_id");--> statement-breakpoint
ALTER TABLE "kiosk_sites" ADD CONSTRAINT "kiosk_sites_slug_unique" UNIQUE("slug");