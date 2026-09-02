CREATE TABLE "app_uses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'event_participant' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_uses_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "atl_dupr_member_list" (
	"dupr_id" text PRIMARY KEY NOT NULL,
	"player_name" text NOT NULL,
	"double_rating" text,
	"double_reliability" integer,
	"single_rating" text,
	"single_reliability" integer,
	"self_rating" text,
	"email" text,
	"phone" text
);
--> statement-breakpoint
CREATE TABLE "atl_dupr_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" text,
	"name" text NOT NULL,
	"description" text,
	"start_datetime" timestamp NOT NULL,
	"end_datetime" timestamp NOT NULL,
	"location_name" text NOT NULL,
	"location_address" text DEFAULT '' NOT NULL,
	"team_format" text NOT NULL,
	"rating_type_required" text DEFAULT 'none' NOT NULL,
	"rating_config" jsonb,
	"min_participants" integer DEFAULT 4 NOT NULL,
	"max_participants" integer DEFAULT 16 NOT NULL,
	"waitlist_enabled" boolean DEFAULT true NOT NULL,
	"require_approval" text DEFAULT 'none' NOT NULL,
	"signup_start_datetime" timestamp NOT NULL,
	"signup_end_datetime" timestamp NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"court_fee_enabled" boolean DEFAULT false NOT NULL,
	"member_fee" real DEFAULT 0 NOT NULL,
	"non_member_fee" real DEFAULT 0 NOT NULL,
	"contact_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atl_dupr_signups" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"member_dupr_id" text NOT NULL,
	"partner_dupr_id" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"event_role" text,
	"is_new" text DEFAULT 'false',
	"assigned_rating" double precision,
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"approved_by" integer,
	"cancelled_at" timestamp,
	"cancelled_by" text
);
--> statement-breakpoint
CREATE TABLE "atl_dupr_event_roles" (
	"user_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "atl_dupr_event_roles_user_id_event_id_pk" PRIMARY KEY("user_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_timezone" text DEFAULT 'America/New_York' NOT NULL,
	"rotating_partners_description" text DEFAULT '' NOT NULL,
	"fixed_partner_description" text DEFAULT '' NOT NULL,
	"min_participants" integer DEFAULT 8 NOT NULL,
	"max_participants" integer DEFAULT 24 NOT NULL,
	"min_teams" integer DEFAULT 4 NOT NULL,
	"max_teams" integer DEFAULT 12 NOT NULL,
	"contact_persons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"default_event_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"event_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_event_duration_hours" integer DEFAULT 2 NOT NULL,
	"default_rating_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rating_requirements_config" jsonb,
	"join_instructions" text DEFAULT '' NOT NULL,
	"event_contact_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guidelines_and_rules" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atl_dupr_email_verification_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "atl_dupr_email_verification_codes_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "atl_dupr_email_send_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_address" text NOT NULL,
	"event_name" text,
	"error_message" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "atl_dupr_signups" ADD CONSTRAINT "atl_dupr_signups_event_id_atl_dupr_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."atl_dupr_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atl_dupr_signups" ADD CONSTRAINT "atl_dupr_signups_member_dupr_id_atl_dupr_member_list_dupr_id_fk" FOREIGN KEY ("member_dupr_id") REFERENCES "public"."atl_dupr_member_list"("dupr_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atl_dupr_signups" ADD CONSTRAINT "atl_dupr_signups_approved_by_app_uses_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_uses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atl_dupr_event_roles" ADD CONSTRAINT "atl_dupr_event_roles_user_id_app_uses_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_uses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "atl_dupr_event_roles" ADD CONSTRAINT "atl_dupr_event_roles_event_id_atl_dupr_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."atl_dupr_events"("id") ON DELETE cascade ON UPDATE no action;