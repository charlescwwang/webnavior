CREATE TABLE "kiosk_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_device_profile_assignments" (
	"device_id" text PRIMARY KEY NOT NULL,
	"profile_release_id" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"label" text NOT NULL,
	"registration_method" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_interaction_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_profile_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_site_members" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_visitor_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"device_id" text NOT NULL,
	"profile_release_id" text NOT NULL,
	"service_id" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"ended_at" timestamp,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kiosk_audit_logs" ADD CONSTRAINT "kiosk_audit_logs_site_id_kiosk_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."kiosk_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_audit_logs" ADD CONSTRAINT "kiosk_audit_logs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_device_profile_assignments" ADD CONSTRAINT "kiosk_device_profile_assignments_device_id_kiosk_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."kiosk_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_device_profile_assignments" ADD CONSTRAINT "kiosk_device_profile_assignments_profile_release_id_kiosk_profile_releases_id_fk" FOREIGN KEY ("profile_release_id") REFERENCES "public"."kiosk_profile_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_site_id_kiosk_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."kiosk_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_interaction_entries" ADD CONSTRAINT "kiosk_interaction_entries_visitor_session_id_kiosk_visitor_sessions_id_fk" FOREIGN KEY ("visitor_session_id") REFERENCES "public"."kiosk_visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_profile_releases" ADD CONSTRAINT "kiosk_profile_releases_site_id_kiosk_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."kiosk_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_site_members" ADD CONSTRAINT "kiosk_site_members_site_id_kiosk_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."kiosk_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_site_members" ADD CONSTRAINT "kiosk_site_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_visitor_sessions" ADD CONSTRAINT "kiosk_visitor_sessions_site_id_kiosk_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."kiosk_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_visitor_sessions" ADD CONSTRAINT "kiosk_visitor_sessions_device_id_kiosk_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."kiosk_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_visitor_sessions" ADD CONSTRAINT "kiosk_visitor_sessions_profile_release_id_kiosk_profile_releases_id_fk" FOREIGN KEY ("profile_release_id") REFERENCES "public"."kiosk_profile_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kiosk_audit_logs_site_created_idx" ON "kiosk_audit_logs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "kiosk_devices_site_idx" ON "kiosk_devices" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_interaction_entries_session_sequence_uidx" ON "kiosk_interaction_entries" USING btree ("visitor_session_id","sequence");--> statement-breakpoint
CREATE INDEX "kiosk_interaction_entries_session_idx" ON "kiosk_interaction_entries" USING btree ("visitor_session_id");--> statement-breakpoint
CREATE INDEX "kiosk_profile_releases_site_idx" ON "kiosk_profile_releases" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kiosk_site_members_site_user_uidx" ON "kiosk_site_members" USING btree ("site_id","user_id");--> statement-breakpoint
CREATE INDEX "kiosk_site_members_user_idx" ON "kiosk_site_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kiosk_visitor_sessions_site_created_idx" ON "kiosk_visitor_sessions" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "kiosk_visitor_sessions_device_created_idx" ON "kiosk_visitor_sessions" USING btree ("device_id","created_at");