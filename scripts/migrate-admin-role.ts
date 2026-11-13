/**
 * Idempotently converts legacy stored admin role values to app_admin.
 *
 * Run with the intended DATABASE_URL:
 *   pnpm --filter @workspace/db exec tsx ../../scripts/migrate-admin-role.ts
 *
 * This is a data-only update. It preserves user IDs, credentials, relationships,
 * and every role other than the legacy admin value.
 */

import { db, pool, sql } from "../lib/db/src/index.js";

try {
  const result = await db.execute(sql`
    UPDATE app_users
    SET role = 'app_admin'
    WHERE role = 'admin'
  `);
  console.log(`Converted ${result.rowCount ?? 0} legacy admin role row(s) to app_admin.`);
} finally {
  await pool.end();
}