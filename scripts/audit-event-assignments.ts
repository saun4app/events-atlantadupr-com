/**
 * Audit and optionally remove staff assignments whose event no longer exists.
 *
 * The assignment table cannot use a normal foreign key because event_id points
 * at one of two format-specific event tables. This script is the repeatable
 * integrity check for that polymorphic relationship.
 *
 * By default this is read-only:
 *   pnpm run audit:event-assignments
 *
 * Review the reported rows, then explicitly apply the same orphan predicate in
 * a single transaction:
 *   pnpm run audit:event-assignments -- --apply
 */

import { db, pool, sql } from "../lib/db/src/index.js";

const orphanPredicate = sql`
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

type OrphanAssignment = {
  user_id: number;
  event_id: number;
  event_type: string;
  assigned_at: string;
  reason: string;
};

function printRows(rows: OrphanAssignment[]) {
  if (rows.length === 0) {
    console.log("No orphan event assignment rows found.");
    return;
  }

  console.log(`Found ${rows.length} orphan event assignment row(s):`);
  console.log(JSON.stringify(rows, null, 2));
}

async function audit(): Promise<OrphanAssignment[]> {
  const result = await db.execute(sql`
    SELECT
      r.user_id,
      r.event_id,
      r.event_type,
      r.assigned_at,
      CASE
        WHEN r.event_type NOT IN ('rotating', 'fixed_partner')
          THEN 'unsupported event_type'
        ELSE 'missing event row'
      END AS reason
    FROM atl_dupr_event_roles r
    WHERE ${orphanPredicate}
    ORDER BY r.event_type, r.event_id, r.user_id
  `);

  return result.rows as OrphanAssignment[];
}

async function removeConfirmedOrphans(): Promise<OrphanAssignment[]> {
  const result = await db.transaction(async (tx) =>
    tx.execute(sql`
      DELETE FROM atl_dupr_event_roles r
      WHERE ${orphanPredicate}
      RETURNING
        r.user_id,
        r.event_id,
        r.event_type,
        r.assigned_at,
        CASE
          WHEN r.event_type NOT IN ('rotating', 'fixed_partner')
            THEN 'unsupported event_type'
          ELSE 'missing event row'
        END AS reason
    `),
  );

  return result.rows as OrphanAssignment[];
}

function usage(): never {
  console.error("Usage: audit-event-assignments [--apply]");
  process.exit(2);
}

async function main() {
  // `pnpm run ... -- --apply` forwards the separator to the nested `tsx`
  // process, so accept and discard one standalone separator.
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => arg !== "--apply")) usage();

  const apply = args.includes("--apply");
  const rows = apply ? await removeConfirmedOrphans() : await audit();

  if (apply) {
    console.log(
      `Removed ${rows.length} confirmed orphan event assignment row(s).`,
    );
  } else {
    printRows(rows);
  }
}

main()
  .catch((error) => {
    console.error("Event assignment audit failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
