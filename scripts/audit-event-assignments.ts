/**
 * Audit and optionally remove registrations and staff assignments whose event
 * no longer exists.
 *
 * These tables cannot use a normal foreign key because event_id points at one
 * of two format-specific event tables. The durable event identity is the
 * (event_type, event_id) pair. This script is the repeatable integrity check
 * for those polymorphic relationships.
 *
 * By default this is read-only:
 *   pnpm run audit:event-assignments
 *
 * For release and maintenance checks, fail if any orphan rows are found:
 *   pnpm run audit:event-assignments -- --check
 *
 * Scheduled maintenance:
 *   Configure a Replit Scheduled Deployment to run
 *   `pnpm run maintenance:event-integrity` daily at 03:00 UTC. The scheduled
 *   deployment reports a failed run to its maintainers when orphan rows are
 *   found, while this command only reads and reports the rows.
 *
 * Review the reported rows, then explicitly apply the same format-specific
 * orphan predicates in a single transaction. The cleanup is what prevents an
 * assignment from being reused if a future event receives the same numeric
 * id:
 *   pnpm run audit:event-assignments -- --apply
 */

import { db, pool, sql } from "../lib/db/src/index.js";

const orphanRegistrationPredicate = sql`
  (
    (s.event_type = 'rotating' AND NOT EXISTS (
      SELECT 1
      FROM atl_dupr_events_rotating rotating
      WHERE rotating.id = s.event_id
    ))
    OR
    (s.event_type = 'fixed_partner' AND NOT EXISTS (
      SELECT 1
      FROM atl_dupr_events_fixed fixed
      WHERE fixed.id = s.event_id
    ))
    OR s.event_type NOT IN ('rotating', 'fixed_partner')
  )
`;

const orphanAssignmentPredicate = sql`
  (
    (r.event_type = 'rotating' AND NOT EXISTS (
      SELECT 1
      FROM atl_dupr_events_rotating rotating
      WHERE rotating.id = r.event_id
    ))
    OR
    (r.event_type = 'fixed_partner' AND NOT EXISTS (
      SELECT 1
      FROM atl_dupr_events_fixed fixed
      WHERE fixed.id = r.event_id
    ))
    OR r.event_type NOT IN ('rotating', 'fixed_partner')
  )
`;

type OrphanRecord = {
  record_type: "registration" | "assignment";
  registration_id: number | null;
  user_id: number | null;
  event_id: number;
  event_type: string;
  recorded_at: string;
  reason: string;
};

function printRows(rows: OrphanRecord[]) {
  if (rows.length === 0) {
    console.log("No orphan event registration or assignment rows found.");
    return;
  }

  console.log(
    `Found ${rows.length} orphan event registration or assignment row(s):`,
  );
  console.log(JSON.stringify(rows, null, 2));
}

async function audit(): Promise<OrphanRecord[]> {
  const result = await db.execute(sql`
    SELECT
      'registration' AS record_type,
      s.id AS registration_id,
      NULL::integer AS user_id,
      s.event_id,
      s.event_type,
      s.registered_at AS recorded_at,
      CASE
        WHEN s.event_type NOT IN ('rotating', 'fixed_partner')
          THEN 'unsupported event_type'
        ELSE 'missing event row'
      END AS reason
    FROM atl_dupr_signups s
    WHERE ${orphanRegistrationPredicate}

    UNION ALL

    SELECT
      'assignment' AS record_type,
      NULL::integer AS registration_id,
      r.user_id,
      r.event_id,
      r.event_type,
      r.assigned_at AS recorded_at,
      CASE
        WHEN r.event_type NOT IN ('rotating', 'fixed_partner')
          THEN 'unsupported event_type'
        ELSE 'missing event row'
      END AS reason
    FROM atl_dupr_event_roles r
    WHERE ${orphanAssignmentPredicate}

    ORDER BY record_type, event_type, event_id, registration_id, user_id
  `);

  return result.rows as OrphanRecord[];
}

async function removeConfirmedOrphans(): Promise<OrphanRecord[]> {
  return db.transaction(async (tx) => {
    const registrations = await tx.execute(sql`
      DELETE FROM atl_dupr_signups s
      WHERE ${orphanRegistrationPredicate}
      RETURNING
        'registration' AS record_type,
        s.id AS registration_id,
        NULL::integer AS user_id,
        s.event_id,
        s.event_type,
        s.registered_at AS recorded_at,
        CASE
          WHEN s.event_type NOT IN ('rotating', 'fixed_partner')
            THEN 'unsupported event_type'
          ELSE 'missing event row'
        END AS reason
    `);

    const assignments = await tx.execute(sql`
      DELETE FROM atl_dupr_event_roles r
      WHERE ${orphanAssignmentPredicate}
      RETURNING
        'assignment' AS record_type,
        NULL::integer AS registration_id,
        r.user_id,
        r.event_id,
        r.event_type,
        r.assigned_at AS recorded_at,
        CASE
          WHEN r.event_type NOT IN ('rotating', 'fixed_partner')
            THEN 'unsupported event_type'
          ELSE 'missing event row'
        END AS reason
    `);

    return [
      ...(registrations.rows as OrphanRecord[]),
      ...(assignments.rows as OrphanRecord[]),
    ];
  });
}

function usage(): never {
  console.error("Usage: audit-event-assignments [--check|--apply]");
  process.exit(2);
}

async function main() {
  // `pnpm run ... -- --apply` forwards the separator to the nested `tsx`
  // process, so accept and discard one standalone separator.
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => arg !== "--apply" && arg !== "--check")) usage();

  const apply = args.includes("--apply");
  const check = args.includes("--check");
  if (apply && check) usage();
  const rows = apply ? await removeConfirmedOrphans() : await audit();

  if (apply) {
    const registrationCount = rows.filter(
      ({ record_type }) => record_type === "registration",
    ).length;
    const assignmentCount = rows.filter(
      ({ record_type }) => record_type === "assignment",
    ).length;
    console.log(
      `Removed ${registrationCount} confirmed orphan registration row(s).`,
    );
    console.log(
      `Removed ${assignmentCount} confirmed orphan assignment row(s).`,
    );
  } else {
    printRows(rows);
    if (check && rows.length > 0) {
      console.error(
        "Event assignment integrity check failed; review the reported rows before release. No rows were deleted.",
      );
      process.exitCode = 1;
    }
  }
}

main()
  .catch((error) => {
    console.error("Event assignment audit failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
