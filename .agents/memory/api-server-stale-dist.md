---
name: api-server stale dist after backend/schema edits
description: Why the api-server can serve old code (querying dropped tables) until its workflow is restarted
---

The `artifacts/api-server` dev workflow runs `build && start` (esbuild bundle, then
`node dist/index.mjs`). It does NOT watch for changes. After editing backend routes
or `lib/db` schema, the running server keeps serving the previously-bundled dist.

**Symptom:** runtime errors that reference code/tables that no longer exist in source
(e.g. a query `from "atl_dupr_events"` at a line number that doesn't match current
source, or `params: NaN`) even though typecheck passes.

**Why:** the bundle is stale; the server was never rebuilt.

**How to apply:** after any backend route or schema change, restart the
`artifacts/api-server: API Server` workflow so it rebuilds. Also rebuild db
declarations with `pnpm --filter @workspace/db exec tsc -b --force` after schema
edits — api-server typechecks against `lib/db/dist/*.d.ts`.
