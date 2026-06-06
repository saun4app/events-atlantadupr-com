/**
 * migrate-decouple-and-split.ts
 *
 * One-time, IDEMPOTENT, NON-DESTRUCTIVE production data migration for the
 * "decouple registrations + split event formats" change.
 *
 * It reproduces, in code, the steps that were applied manually to the dev
 * database so they can be run safely against production. Every step is guarded
 * so the script is a no-op when re-run (or when a step has already happened).
 *
 * PRODUCTION RUNBOOK ORDER (important):
 *   1. Run THIS script FIRST, against the OLD prod schema. It creates the new
 *      destination tables itself (additive, `CREATE TABLE IF NOT EXISTS`) and
 *      copies all data across. It never drops or alters anything, so it is safe
 *      to run before any schema reconciliation.
 *   2. THEN run `drizzle-kit push --force`, which drops the now-redundant old
 *      `atl_dupr_events` table and the old `app_settings` capacity columns. By
 *      that point all data has already been copied, so the drop is safe.
 *
 *   Running push FIRST would drop the old table before this script can read it.
 *   To guard against that mistake, a preflight check hard-fails if the old
 *   table is gone AND the destination tables are still empty (i.e. data was
 *   never migrated).
 *
 * Steps:
 *   0. Preflight: refuse to run if the old table is missing but no data has
 *      been migrated yet (prevents silent data loss from wrong run order).
 *   1. Create destination tables if missing (additive, non-destructive).
 *   2. Split the old unified `atl_dupr_events` table into the two
 *      self-contained format tables. Skipped if the old table no longer exists.
 *      Rows are inserted with `ON CONFLICT (id) DO NOTHING` (ids are preserved)
 *      so re-runs never duplicate.
 *      Old event ids are preserved so existing `atl_dupr_signups` keep pointing
 *      at the right event.
 *   3. Backfill registrant/partner JSONB snapshots on `atl_dupr_signups` from
 *      the member list, only for rows whose snapshot is still NULL.
 *   4. Seed per-format rows in `atl_dupr_event_defaults` from the old
 *      `app_settings` capacity columns (if those columns still exist), else
 *      from sensible defaults. Uses ON CONFLICT DO NOTHING.
 *
 * Run: pnpm --filter @workspace/db exec tsx ../../scripts/migrate-decouple-and-split.ts
 */

import { db, sql } from "../lib/db/src/index.js";

async function tableExists(name: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT to_regclass(${"public." + name}) IS NOT NULL AS present`,
  );
  return Boolean((res.rows[0] as { present: boolean }).present);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    ) AS present
  `);
  return Boolean((res.rows[0] as { present: boolean }).present);
}

async function rowCount(table: string): Promise<number> {
  if (!(await tableExists(table))) return 0;
  const res = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${table}`));
  return Number((res.rows[0] as { n: number }).n);
}

const MIGRATION_NAME = "decouple-and-split";

async function migrationApplied(): Promise<boolean> {
  if (!(await tableExists("schema_migrations"))) return false;
  const res = await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = ${MIGRATION_NAME}) AS present
  `);
  return Boolean((res.rows[0] as { present: boolean }).present);
}

async function preflight() {
  const oldExists = await tableExists("atl_dupr_events");
  const alreadyApplied = await migrationApplied();
  // The only dangerous state is: the source table is gone AND we have no record
  // that this migration ever completed — meaning a destructive `push` likely ran
  // before the data was copied. A completed marker makes reruns a safe no-op
  // even when there were legitimately zero historical events to copy.
  if (!oldExists && !alreadyApplied) {
    throw new Error(
      "[0] Preflight failed: old `atl_dupr_events` table is missing AND this migration has " +
        "no completion marker. This usually means `drizzle-kit push --force` was run BEFORE " +
        "this migration and dropped the source data. Restore from a backup, then run THIS " +
        "script before pushing schema changes.",
    );
  }
  console.log("[0/4] Preflight OK.");
}

async function recordCompletion() {
  await db.execute(sql`
    INSERT INTO schema_migrations (name) VALUES (${MIGRATION_NAME})
    ON CONFLICT (name) DO NOTHING
  `);
}

async function createDestinationSchema() {
  // Additive, non-destructive DDL that mirrors the Drizzle schema. Running this
  // before `drizzle-kit push` lets the migration copy data while the old schema
  // is still intact; push later reconciles (drops the old table/columns).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS atl_dupr_events_rotating (
      id serial PRIMARY KEY,
      series_id text,
      name text NOT NULL,
      description text,
      event_description text,
      start_datetime timestamp NOT NULL,
      end_datetime timestamp NOT NULL,
      location_name text NOT NULL,
      location_address text NOT NULL DEFAULT '',
      rating_type_required text NOT NULL DEFAULT 'none',
      rating_config jsonb,
      min_participants integer NOT NULL DEFAULT 4,
      max_participants integer NOT NULL DEFAULT 16,
      waitlist_enabled boolean NOT NULL DEFAULT true,
      require_approval text NOT NULL DEFAULT 'none',
      signup_start_datetime timestamp NOT NULL,
      signup_end_datetime timestamp NOT NULL,
      status text NOT NULL DEFAULT 'upcoming',
      court_fee_enabled boolean NOT NULL DEFAULT false,
      member_fee real NOT NULL DEFAULT 0,
      non_member_fee real NOT NULL DEFAULT 0,
      contact_email text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS atl_dupr_events_fixed (
      id serial PRIMARY KEY,
      series_id text,
      name text NOT NULL,
      description text,
      event_description text,
      start_datetime timestamp NOT NULL,
      end_datetime timestamp NOT NULL,
      location_name text NOT NULL,
      location_address text NOT NULL DEFAULT '',
      rating_type_required text NOT NULL DEFAULT 'none',
      rating_config jsonb,
      min_teams integer NOT NULL DEFAULT 2,
      max_teams integer NOT NULL DEFAULT 8,
      waitlist_enabled boolean NOT NULL DEFAULT true,
      require_approval text NOT NULL DEFAULT 'none',
      signup_start_datetime timestamp NOT NULL,
      signup_end_datetime timestamp NOT NULL,
      status text NOT NULL DEFAULT 'upcoming',
      court_fee_enabled boolean NOT NULL DEFAULT false,
      member_fee real NOT NULL DEFAULT 0,
      non_member_fee real NOT NULL DEFAULT 0,
      contact_email text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS atl_dupr_event_defaults (
      event_type text PRIMARY KEY,
      min_capacity integer NOT NULL DEFAULT 8,
      max_capacity integer NOT NULL DEFAULT 24
    )
  `);

  // Snapshot columns on the registrations table (added non-destructively in
  // case push has not yet run against an old prod schema).
  await db.execute(sql`ALTER TABLE atl_dupr_signups ADD COLUMN IF NOT EXISTS player_snapshot jsonb`);
  await db.execute(sql`ALTER TABLE atl_dupr_signups ADD COLUMN IF NOT EXISTS partner_snapshot jsonb`);

  // Format discriminator on the registration + assignment tables. In the OLD
  // schema these referenced the single `atl_dupr_events` table by `event_id`
  // only. Runtime now scopes every query by (event_id, event_type), so the
  // column must exist (additively, before push) and be backfilled from each
  // row's owning event format — otherwise push adds it defaulting to 'rotating'
  // and historical fixed-partner rows become orphaned for fixed events.
  await db.execute(
    sql`ALTER TABLE atl_dupr_signups ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'rotating'`,
  );
  await db.execute(
    sql`ALTER TABLE atl_dupr_event_roles ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'rotating'`,
  );

  // Durable completion marker so reruns are a safe no-op even when there were
  // legitimately zero historical events to copy.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  console.log("[1/4] Destination schema ensured (non-destructive).");
}

async function splitEvents() {
  if (!(await tableExists("atl_dupr_events"))) {
    console.log("[2/4] Old `atl_dupr_events` table absent — split already done, skipping.");
    return;
  }

  // Rotating events keep participant-based capacity columns 1:1.
  const rotRes = await db.execute(sql`
    INSERT INTO atl_dupr_events_rotating (
      id, series_id, name, description, event_description, start_datetime, end_datetime,
      location_name, location_address, rating_type_required, rating_config,
      min_participants, max_participants, waitlist_enabled, require_approval,
      signup_start_datetime, signup_end_datetime, status, court_fee_enabled,
      member_fee, non_member_fee, contact_email, created_at
    )
    SELECT
      id, series_id, name, description, event_description, start_datetime, end_datetime,
      location_name, location_address, rating_type_required, rating_config,
      min_participants, max_participants, waitlist_enabled, require_approval,
      signup_start_datetime, signup_end_datetime, status, court_fee_enabled,
      member_fee, non_member_fee, contact_email, created_at
    FROM atl_dupr_events old
    WHERE old.team_format = 'rotating'
    ON CONFLICT (id) DO NOTHING
  `);

  // Fixed-partner events: in the OLD unified model every event stored
  // participant counts, and fixed-partner team capacity was DERIVED as
  // floor(participants / 2) (a team is 2 players). The new fixed table stores
  // team counts directly, so convert participants -> teams here. Copying the
  // raw participant counts would double effective team capacity.
  const fixRes = await db.execute(sql`
    INSERT INTO atl_dupr_events_fixed (
      id, series_id, name, description, event_description, start_datetime, end_datetime,
      location_name, location_address, rating_type_required, rating_config,
      min_teams, max_teams, waitlist_enabled, require_approval,
      signup_start_datetime, signup_end_datetime, status, court_fee_enabled,
      member_fee, non_member_fee, contact_email, created_at
    )
    SELECT
      id, series_id, name, description, event_description, start_datetime, end_datetime,
      location_name, location_address, rating_type_required, rating_config,
      GREATEST(FLOOR(min_participants::numeric / 2)::int, 1),
      GREATEST(FLOOR(max_participants::numeric / 2)::int, 1),
      waitlist_enabled, require_approval,
      signup_start_datetime, signup_end_datetime, status, court_fee_enabled,
      member_fee, non_member_fee, contact_email, created_at
    FROM atl_dupr_events old
    WHERE old.team_format = 'fixed_partner'
    ON CONFLICT (id) DO NOTHING
  `);

  // Keep the serial sequences ahead of the ids we copied over.
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('atl_dupr_events_rotating', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM atl_dupr_events_rotating), 1)
    )
  `);
  await db.execute(sql`
    SELECT setval(
      pg_get_serial_sequence('atl_dupr_events_fixed', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM atl_dupr_events_fixed), 1)
    )
  `);

  console.log(
    `[2/4] Split events: inserted ${rotRes.rowCount ?? 0} rotating, ${fixRes.rowCount ?? 0} fixed (re-runs are no-ops).`,
  );
}

async function backfillEventTypes() {
  // Must run while the OLD `atl_dupr_events` table still exists, because the
  // correct format for each historical signup/assignment lives in its
  // `team_format` column. Once push drops the old table this is a no-op (the
  // values were already written on the first run).
  if (!(await tableExists("atl_dupr_events"))) {
    console.log(
      "[3a/4] Old `atl_dupr_events` table absent — event_type backfill already done, skipping.",
    );
    return;
  }

  let signupRows = 0;
  if (await tableExists("atl_dupr_signups")) {
    const res = await db.execute(sql`
      UPDATE atl_dupr_signups s
      SET event_type = old.team_format
      FROM atl_dupr_events old
      WHERE s.event_id = old.id
        AND old.team_format IN ('rotating', 'fixed_partner')
        AND s.event_type IS DISTINCT FROM old.team_format
    `);
    signupRows = res.rowCount ?? 0;
  }

  let roleRows = 0;
  if (await tableExists("atl_dupr_event_roles")) {
    const res = await db.execute(sql`
      UPDATE atl_dupr_event_roles r
      SET event_type = old.team_format
      FROM atl_dupr_events old
      WHERE r.event_id = old.id
        AND old.team_format IN ('rotating', 'fixed_partner')
        AND r.event_type IS DISTINCT FROM old.team_format
    `);
    roleRows = res.rowCount ?? 0;
  }

  console.log(
    `[3a/4] Backfilled event_type: ${signupRows} signup, ${roleRows} assignment row(s) (re-runs are no-ops).`,
  );
}

async function backfillSnapshots() {
  if (!(await tableExists("atl_dupr_signups"))) {
    console.log("[3/4] `atl_dupr_signups` absent, skipping snapshot backfill.");
    return;
  }

  const playerRes = await db.execute(sql`
    UPDATE atl_dupr_signups s
    SET player_snapshot = jsonb_build_object(
      'playerName', m.player_name,
      'doubleRating', m.double_rating,
      'singleRating', m.single_rating,
      'selfRating', m.self_rating,
      'email', m.email,
      'phone', m.phone
    )
    FROM atl_dupr_member_list m
    WHERE s.member_dupr_id = m.dupr_id
      AND s.player_snapshot IS NULL
  `);

  const partnerRes = await db.execute(sql`
    UPDATE atl_dupr_signups s
    SET partner_snapshot = jsonb_build_object(
      'partnerName', m.player_name,
      'partnerDoubleRating', m.double_rating
    )
    FROM atl_dupr_member_list m
    WHERE s.partner_dupr_id = m.dupr_id
      AND s.partner_dupr_id IS NOT NULL
      AND s.partner_snapshot IS NULL
  `);

  console.log(
    `[3/4] Backfilled snapshots: ${playerRes.rowCount ?? 0} player, ${partnerRes.rowCount ?? 0} partner.`,
  );
}

async function seedEventDefaults() {

  // Default values, overridden by old app_settings capacity columns if present.
  let rotating = { min: 8, max: 24 };
  let fixed = { min: 4, max: 12 };

  const hasOldCapacity =
    (await columnExists("app_settings", "min_participants")) &&
    (await columnExists("app_settings", "max_participants")) &&
    (await columnExists("app_settings", "min_teams")) &&
    (await columnExists("app_settings", "max_teams"));

  if (hasOldCapacity) {
    const res = await db.execute(sql`
      SELECT min_participants, max_participants, min_teams, max_teams
      FROM app_settings
      ORDER BY id
      LIMIT 1
    `);
    const row = res.rows[0] as
      | { min_participants: number; max_participants: number; min_teams: number; max_teams: number }
      | undefined;
    if (row) {
      rotating = { min: row.min_participants, max: row.max_participants };
      fixed = { min: row.min_teams, max: row.max_teams };
      console.log("[4/4] Sourced capacity defaults from existing app_settings columns.");
    }
  }

  const res = await db.execute(sql`
    INSERT INTO atl_dupr_event_defaults (event_type, min_capacity, max_capacity)
    VALUES
      ('rotating', ${rotating.min}, ${rotating.max}),
      ('fixed_partner', ${fixed.min}, ${fixed.max})
    ON CONFLICT (event_type) DO NOTHING
  `);

  console.log(`[4/4] Seeded event defaults: ${res.rowCount ?? 0} new row(s) (re-runs are no-ops).`);
}

async function main() {
  console.log("Running decouple-and-split data migration...");
  await preflight();
  await createDestinationSchema();
  await splitEvents();
  await backfillEventTypes();
  await backfillSnapshots();
  await seedEventDefaults();
  await recordCompletion();
  console.log("Migration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
