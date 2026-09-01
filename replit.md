# Atlanta DUPR Pickleball — Events App

This is the **Events** app for Atlanta DUPR Pickleball, served at `events.atlantadupr.com`. It handles event registration, round robin scheduling, and DUPR-rated player management.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/atl-dupr-pickleball run dev` — run the web frontend (port 20563)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run check:event-integrity` — read-only event-link audit; runs at the start of release builds and blocks on orphan rows
- `pnpm run audit:event-assignments` — inspect orphan event-link rows without changing data
- `pnpm run audit:event-assignments -- --apply` — explicitly reviewed, transactional cleanup of confirmed orphan rows
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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
