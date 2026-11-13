---
name: Prod data migrations (drizzle-kit push, no migration files)
description: How to write production data migrations in this monorepo since schema is applied via drizzle-kit push with no migration files
---

This project applies schema changes with `drizzle-kit push` (dev: `pnpm --filter @workspace/db run push`, or `push-force` for destructive drops). There are NO generated migration files, so any data movement (backfills, table splits, column moves) needs a hand-written one-off script under `scripts/` (the `@workspace/scripts` package).

**Rule:** a prod data migration must be idempotent AND non-destructive, and must run BEFORE `drizzle-kit push --force`.

**Why:** push --force drops removed tables/columns immediately and non-interactively. If push runs before the data is copied, the source is gone and data is lost. So the script must be safe to run while the OLD schema is still intact.

**How to apply (pattern that passed review):**
- Script creates its own destination tables/columns with `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (additive, mirrors the Drizzle schema) so it works on the old prod schema before push.
- Copy data with `ON CONFLICT (id) DO NOTHING` (preserve PKs so FK-like references in other tables still resolve); bump serial sequences with setval afterward.
- Write a durable completion marker (a `schema_migrations` table row) as the LAST step. Gate a preflight hard-fail on `source table missing AND marker absent` — NOT on row counts (row-count guards false-positive when there were legitimately zero rows to migrate).
- Runbook order: run the script first, verify the marker row, then `drizzle-kit push --force` to drop the now-redundant old objects.

**Running one-off scripts:** tsx is only a dep of `@workspace/scripts` and `@workspace/db`. A script in `scripts/` that imports `../lib/db/src/index.js` must run with the db package's resolution context: `pnpm --filter @workspace/db exec tsx ../../scripts/<file>.ts`. Import `sql` from `@workspace/db` (re-exported there), not directly from `drizzle-orm`, or module resolution fails from the scripts dir.
