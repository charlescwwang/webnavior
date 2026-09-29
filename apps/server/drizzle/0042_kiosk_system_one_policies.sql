CREATE TABLE IF NOT EXISTS "kiosk_system_one_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "store_instruction" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
