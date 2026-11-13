---
name: orval path+query param naming collision
description: Why an operation with BOTH a path param and query params breaks codegen typecheck in lib/api-zod
---

When an OpenAPI operation has BOTH a path parameter and query parameters, orval's
two generators name things inconsistently and collide in the api-zod barrel:
- the zod generator emits a VALUE `const <Op>Params` for the PATH params
- the types generator emits a TYPE `<Op>Params` for the QUERY params
Two `export *` re-exporting the same name → TS2308 in `lib/api-zod/src/index.ts`.

Note the generated `types/` enums are VALUE exports (const objects), so a blanket
`export type *` is NOT a valid fix — it would drop those runtime enum objects.

**Fix used:** remove the query params from that operation in `openapi.yaml` (the
backend can still read `req.query.*`; filter client-side). A path-only operation
does not generate a `<Op>Params` query type, so the collision disappears.

**How to apply:** avoid giving the same operation both a path param and query
params in this repo's spec, or expect to drop the query params and filter on the
client. Regenerate with `pnpm --filter @workspace/api-spec run codegen`.
