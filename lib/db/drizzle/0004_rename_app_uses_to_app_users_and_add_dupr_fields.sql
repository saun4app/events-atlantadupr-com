ALTER TABLE "app_uses" RENAME TO "app_users";
--> statement-breakpoint
ALTER TABLE "app_users" RENAME CONSTRAINT "app_uses_username_unique" TO "app_users_username_unique";
--> statement-breakpoint
ALTER TABLE "atl_dupr_signups" RENAME CONSTRAINT "atl_dupr_signups_approved_by_app_uses_id_fk" TO "atl_dupr_signups_approved_by_app_users_id_fk";
--> statement-breakpoint
ALTER TABLE "atl_dupr_event_roles" RENAME CONSTRAINT "atl_dupr_event_roles_user_id_app_uses_id_fk" TO "atl_dupr_event_roles_user_id_app_users_id_fk";
--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "dupr_id" text;
--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "dupr_fullname" text;