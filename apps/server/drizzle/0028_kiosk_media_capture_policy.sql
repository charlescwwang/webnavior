ALTER TABLE "kiosk_sites" ADD COLUMN "media_capture_policy" jsonb NOT NULL DEFAULT '{"mode":"triggered"}'::jsonb;
