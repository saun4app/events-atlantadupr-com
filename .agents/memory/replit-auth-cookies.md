---
name: Replit proxy auth cookies
description: What it takes for session cookies to work end-to-end in Replit's iframe preview proxy
---

Three conditions are all required for cookie-based auth to work in Replit's dev preview:

1. **`credentials: "include"` in every fetch call** — without it the browser silently discards Set-Cookie responses and never sends cookies on subsequent requests.

2. **`sameSite: "none", secure: true` on the server cookie** — Replit previews run inside an iframe on a different origin. `sameSite: "lax"` cookies are blocked in cross-site iframe contexts; `none` + `secure` is required.

3. **Use `queryClient.setQueryData(key, user)` (not `invalidateQueries`) immediately after login** — `invalidateQueries` triggers an async background refetch; if the redirect fires before it resolves, the auth guard sees stale `isAuthenticated: false` and bounces the user back to login. Setting the data synchronously in the cache eliminates the race.

**Why:** All three must coexist — fixing only one or two still causes a broken auth loop.

**How to apply:** Any time cookie/session auth is added to a Replit-hosted Express + React app using a Vite proxy.
