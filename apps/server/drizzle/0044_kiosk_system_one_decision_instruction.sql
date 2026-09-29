ALTER TABLE "kiosk_system_one_policies"
  ADD COLUMN IF NOT EXISTS "decision_instruction" text DEFAULT '' NOT NULL;
