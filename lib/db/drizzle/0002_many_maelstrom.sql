ALTER TABLE "atl_dupr_signups" DROP CONSTRAINT "atl_dupr_signups_member_dupr_id_atl_dupr_member_list_dupr_id_fk";
--> statement-breakpoint
ALTER TABLE "atl_dupr_signups" ADD CONSTRAINT "atl_dupr_signups_member_dupr_id_atl_dupr_member_list_dupr_id_fk" FOREIGN KEY ("member_dupr_id") REFERENCES "public"."atl_dupr_member_list"("dupr_id") ON DELETE no action ON UPDATE no action;