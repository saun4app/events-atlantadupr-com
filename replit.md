# Atlanta DUPR Pickleball — Events App

This is the **Events** app for Atlanta DUPR Pickleball, served at `events.atlantadupr.com`. It handles event registration, round robin scheduling, and DUPR-rated player management.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run test:api` — run API integration tests; set `TEST_DATABASE_URL` to an isolated PostgreSQL database first (or pair it with a dedicated non-public `TEST_DATABASE_SCHEMA`)
- `pnpm run test:api:isolated` — provision a disposable local PostgreSQL cluster, initialize its schema, run API tests, and remove the cluster; requires PostgreSQL tools on PATH and never uses existing application data
- `pnpm run test:e2e:isolated` — provision a disposable local PostgreSQL cluster, initialize its schema, run desktop and mobile browser tests, and remove the cluster; requires PostgreSQL tools on PATH and never uses existing application data
- `pnpm --filter @workspace/atl-dupr-pickleball run dev` — run the web frontend (port 20563)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run check:event-integrity` — read-only event-link audit; runs at the start of release builds and blocks on orphan rows
- `pnpm run check:production-schema` — read-only production users-table/schema audit; runs before release builds and blocks on schema or rename-risk findings
- `pnpm run audit:event-assignments` — inspect orphan event-link rows without changing data
- `pnpm run audit:production-schema` — inspect the expected `app_users` shape, DUPR constraints, rename risk, and preserved user count without changing data
- `pnpm run audit:event-assignments -- --apply` — explicitly reviewed, transactional cleanup of confirmed orphan rows
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- API tests require `TEST_DATABASE_URL`; they refuse to use `DATABASE_URL` or the `public` schema for destructive fixture cleanup

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Frontend: `artifacts/atl-dupr-pickleball/`
- Backend API: `artifacts/api-server/`
- OpenAPI spec: `lib/api-spec/openapi.yaml`
- DB schema: `lib/db/src/schema.ts`
- Shared API client: `lib/api-client-react/`
- Zod schemas: `lib/api-zod/`

## Architecture decisions

- Single monorepo with shared API server and frontend
- Frontend is a React + Vite SPA with static build in production
- API routes live under `/api/` path
- Auth uses sessions with role-based access control

## Security configuration

- Production browser origins are restricted to the published custom and Replit domains. Additional trusted origins can be explicitly configured with comma-separated `CORS_ALLOWED_ORIGINS`; do not use wildcards.
- Session cookies are HttpOnly and Secure in production. Development iframe previews use SameSite=None with Secure; local HTTP tests use SameSite=Lax. Server-side sessions expire after seven days.
- Demo seeding refuses production and requires `ALLOW_DESTRUCTIVE_SEED=true` in development because it deletes existing development data. Demo users receive random, unreported passwords, not fixed default credentials.

## Product

- Public event browsing with registration, DUPR rating checks, and waitlist
- Fixed-partner and rotating formats supported
- Admin event management with participant roster, CSV/PDF export, email notifications
- Court fee collection and member/non-member pricing

## User preferences

- None yet

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- Frontend builds to `artifacts/atl-dupr-pickleball/dist/public` for production
- The `BASE_PATH` env var must match the `previewPath` in artifact.toml

## Deployment

- Custom domain: `events.atlantadupr.com` (primary)
- Fallback: `atlanta-dupr-pickleball.replit.app` (auto-generated from Replit name)
- To rename the Replit (and thus the `.replit.app` URL): go to Replit dashboard → rename the repl
