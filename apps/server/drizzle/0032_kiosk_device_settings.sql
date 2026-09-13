ALTER TABLE "kiosk_devices" ADD COLUMN "settings" jsonb NOT NULL DEFAULT '{"version":1,"localControls":[],"overrides":{},"localOverrides":{}}'::jsonb;
