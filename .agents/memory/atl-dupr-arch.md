---
name: ATL DUPR Pickleball App Architecture
description: Key quirks for session, password, CSV upload, proxy, and build order for this specific app
---

# ATL DUPR Pickleball App — Durable Architecture Notes

## API Server Must Be Rebuilt When Route Files Are Added
The API server uses esbuild to compile to `dist/index.mjs` before starting. If route files are added AFTER a previous build, the dist is stale. Always restart the API Server workflow after adding/changing backend route files.

**Why:** The dev workflow runs `build && start` — it doesn't watch for file changes.

## Vite Proxy Required for API Calls
The frontend proxies `/api` to `http://localhost:8080` via Vite's `server.proxy` config. Without this, all API calls hit Vite's port (20563) and return 404.

**How to apply:** `server.proxy: { "/api": { target: "http://localhost:8080", changeOrigin: true } }` in `vite.config.ts`.

## Session Management Module
Sessions live in `artifacts/api-server/src/lib/session.ts` (a shared Map). Imported in both `app.ts` (middleware) and `auth.ts` (logout cleanup). Cookie name `sid`, signed cookies via cookie-parser.

**Why:** Logout uses `res.send()` (204 no content) — not `res.json()`. The res.json interceptor in app.ts wouldn't run, so logout must call `deleteSession()` directly.

## CSV Upload
Uses `text/plain` content type (not multipart). Frontend reads file with FileReader as text, sends raw CSV string via `useUploadMembersCsv().mutate({ data: csvText })`.

## Seed Data
Run `pnpm --filter @workspace/db run seed` (or via the seed SQL in `lib/db/src/seed.ts`) to restore initial data (admin/organizer users, 10 members, 3 events, 6 registrations). Event IDs 1-3.

## Role Enum
`admin`, `event_organizer`, `event_participant`, `event_captain`, `court_leader`

## RBAC Rules
- admin → all admin pages
- event_organizer, event_captain, court_leader → /admin/events only (captain/court_leader scoping to designated events is future work)
- event_participant → NO admin pages, redirect to /

## Registration Status Enum
`confirmed`, `waitlisted`, `pending_approval`, `rejected`

## Event Format/Status
- Format: `fixed_partner`, `rotating`
- Status: `upcoming`, `closed`, `ended`
