-- Preserve the effective device policy before removing per-field delegation.
-- Undelegated local values never took effect and must not become active here.
UPDATE "kiosk_devices"
SET "settings" = jsonb_build_object(
  'version', ("settings"->>'version')::integer + 1,
  'overrides', "settings"->'overrides' || COALESCE((
    SELECT jsonb_object_agg(entry.key, entry.value)
    FROM jsonb_each("settings"->'localOverrides') AS entry
    WHERE ("settings"->'localControls') ? entry.key
  ), '{}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "kiosk_devices" ALTER COLUMN "settings" SET DEFAULT '{"version":1,"overrides":{}}'::jsonb;
