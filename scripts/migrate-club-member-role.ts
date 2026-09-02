/**
 * Idempotently converts legacy stored event_participant role values to
 * club_member.
 *
 * Run with the intended DATABASE_URL:
 *   pnpm --filter @workspace/db exec tsx ../../scripts/migrate-club-member-role.ts
 *
 * This is a data-only update. It preserves user IDs, credentials, relationships,
 * and every role other than the legacy event_participant value.
 */

import { db, pool, sql } from "../lib/db/src/index.js";

try {
  const result = await db.execute(sql`
    UPDATE app_users
    SET role = 'club_member'
    WHERE role = 'event_participant'
  `);
  console.log(`Converted ${result.rowCount ?? 0} legacy event_participant role row(s) to club_member.`);
} finally {
  await pool.end();
}