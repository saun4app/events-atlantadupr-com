---
name: Running node:test in api-server
description: How API tests are wired in artifacts/api-server and why the process needs --test-force-exit
---

The api-server has no test framework dependency; tests run on Node's built-in
runner via `node --import tsx/esm --test --test-force-exit --test-concurrency=1
"src/**/*.test.ts"` (exposed as the package `test` script). tsx is a catalog
devDependency.

**`--test-force-exit` is required**, not optional. Two module-level handles keep
the event loop alive after tests finish, so without it the run hangs ~60s and the
file is reported as a pending/cancelled promise even though every assertion
passed:
- a `setInterval` in `lib/rate-limit.ts` (in-memory counter sweeper)
- the shared pg `pool` from `@workspace/db` (call `pool.end()` in an `after` hook,
  but force-exit is still needed for the rate-limit timer)

API integration tests run with `NODE_ENV=test` and require `TEST_DATABASE_URL`;
the DB package refuses to fall back to `DATABASE_URL`. `TEST_DATABASE_SCHEMA`
may select a dedicated non-public schema when a separate database is not used.
Each integration suite calls `assertTestDatabase()` before setup/cleanup, which
checks the live database/schema and refuses destructive cleanup if the target is
unrecognized. Tests run with `--test-concurrency=1` because rotating and fixed
event tables have independent serial IDs but share the registrations table.

**Why:** these are unref-less long-lived handles; node:test waits for the loop to
drain before printing its summary. The explicit test target prevents interrupted
fixtures from touching development data, while serial file execution avoids
cross-suite ID collisions in the shared test database.

**How to apply:** create rows with unique ids and clean them up in `afterEach`/`after`
(the registrations table has no uniqueness constraint, so leftovers corrupt later
runs). To exercise the
create-registration handler without verification codes or rate limits, plant a
`sessions` row with `{role:"admin"}` and send it as `Authorization: Bearer
<token>` — the staff path bypasses the code/window/rate-limit branches while the
dedup, reactivation and capacity/approval status logic still run identically.
