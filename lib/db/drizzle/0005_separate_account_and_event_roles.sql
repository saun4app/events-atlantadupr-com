-- Persist event responsibilities on the event assignment, rather than on the
-- account.  Every statement is safe to re-run after an interrupted deploy.
ALTER TABLE "atl_dupr_event_roles"
  ADD COLUMN IF NOT EXISTS "event_role" text;
--> statement-breakpoint
-- Only captain and court-leader links had an unambiguous event responsibility.
-- Organizers deliberately receive no inferred assignment; directors and admins
-- already have global access from their account roles.
UPDATE "atl_dupr_event_roles" AS assignment
SET "event_role" = CASE user_account."role"
  WHEN 'event_captain' THEN 'event_captain'
  WHEN 'court_leader' THEN 'court_leader'
  ELSE assignment."event_role"
END
FROM "app_users" AS user_account
WHERE user_account."id" = assignment."user_id"
  AND assignment."event_role" IS NULL;
--> statement-breakpoint
DELETE FROM "atl_dupr_event_roles" AS assignment
USING "app_users" AS user_account
WHERE user_account."id" = assignment."user_id"
  AND (
    assignment."event_role" IS NULL
    OR user_account."role" IN ('app_admin', 'club_director', 'event_organizer', 'club_member')
  );
--> statement-breakpoint
ALTER TABLE "atl_dupr_event_roles"
  ALTER COLUMN "event_role" SET NOT NULL;
--> statement-breakpoint
UPDATE "app_users"
SET "role" = 'club_member'
WHERE "role" IN ('event_organizer', 'event_captain', 'court_leader', 'event_participant');
--> statement-breakpoint
ALTER TABLE "app_users"
  ALTER COLUMN "role" SET DEFAULT 'club_member';