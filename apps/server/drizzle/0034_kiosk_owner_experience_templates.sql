ALTER TABLE "kiosk_sites" ADD COLUMN "owner_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT;

CREATE TABLE "kiosk_owner_experience_drafts" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "kiosk_owner_experience_drafts_owner_user_id_unique" UNIQUE("owner_user_id")
);

CREATE TABLE "kiosk_owner_experience_releases" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "revision" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "kiosk_owner_experience_releases_owner_revision_uidx" UNIQUE("owner_user_id", "revision")
);

CREATE INDEX "kiosk_owner_experience_releases_owner_idx" ON "kiosk_owner_experience_releases" USING btree ("owner_user_id");
ALTER TABLE "kiosk_profile_releases" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "kiosk_profile_releases" ADD COLUMN "source_template_release_id" text REFERENCES "kiosk_owner_experience_releases"("id") ON DELETE SET NULL;
ALTER TABLE "kiosk_profile_releases" ADD COLUMN "parent_site_release_id" text REFERENCES "kiosk_profile_releases"("id") ON DELETE SET NULL;
ALTER TABLE "kiosk_profile_releases" ADD COLUMN "change_scope" text DEFAULT 'site_override' NOT NULL;
