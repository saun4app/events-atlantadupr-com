---
name: ATL DUPR Pickleball App Architecture
description: Key quirks for session, password, CSV upload, proxy, and build order for this specific app
---

# ATL DUPR Pickleball App — Durable Architecture Notes

## API Server Must Be Rebuilt When Route Files Are Added
The API server uses esbuild to compile to `dist/index.mjs` before starting. If route files are added AFTER a previous build, the dist is stale. Always restart the API Server workflow after adding/changing backend route files. The dist will only include what existed at build time.

**Why:** The dev workflow runs `build && start` — it doesn't watch for file changes.

## Vite Proxy Required for API Calls
The frontend (`artifacts/atl-dupr-pickleball`) proxies `/api` to `http://localhost:8080` via Vite's `server.proxy` config. Without this, all API calls hit Vite's port (20563) and return 404.

**How to apply:** `server.proxy: { "/api": { target: "http://localhost:8080", changeOrigin: true } }` in `vite.config.ts`.

## Session Management
Custom in-memory Map with signed cookies (`cookie-parser`), no express-session. Cookie name `sid`, secret `atl_dupr_salt`. Session stored on `(req as any).session`. Set/cleared via a `res.json` interceptor in `app.ts`.

## Password Hashing
SHA-256 with salt string `atl_dupr_salt` (not bcrypt — intentional simplicity). See `artifacts/api-server/src/lib/auth.ts`.

## CSV Upload
Uses `text/plain` content type (not multipart). Frontend reads file with FileReader as text, sends raw CSV string via `useUploadMembersCsv().mutate({ data: csvText })`. Backend uses `express.text({ type: "text/plain" })`.

## Seeding
Seed data uses raw SQL strings (not parameterized) because executeSql param count must match exactly. Static string interpolation works reliably.

## Role Enum
`admin`, `event_organizer`, `event_participant`, `event_captain`, `court_leader`

## Registration Status Enum
`confirmed`, `waitlisted`, `pending_approval`, `rejected`

## Event Format/Status
- Format: `fixed_partner`, `rotating`
- Status: `upcoming`, `closed`, `ended`
