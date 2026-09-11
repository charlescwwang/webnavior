ALTER TABLE "kiosk_visitor_media" ADD COLUMN "interaction_entry_id" text REFERENCES "kiosk_interaction_entries"("id") ON DELETE SET NULL;
CREATE INDEX "kiosk_visitor_media_entry_idx" ON "kiosk_visitor_media" ("interaction_entry_id");
