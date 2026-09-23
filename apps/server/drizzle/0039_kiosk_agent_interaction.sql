ALTER TABLE "kiosk_visitor_sessions"
  ADD COLUMN "agent_interaction" jsonb NOT NULL DEFAULT '{"dismissedSubjectIds":[],"mode":"active","noProgressCount":0,"suggestedSubjectIds":[]}';
