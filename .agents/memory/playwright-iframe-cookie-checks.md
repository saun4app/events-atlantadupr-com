---
name: Playwright iframe cookie checks
description: Safely verify cookie-only authentication inside a cross-site preview iframe
---

For a cross-site iframe auth check, observe network responses through the owning Playwright `Page` and filter by `response.frame()`. Use `Frame.waitForURL()` and `Frame.goto()` for frame navigation. `request.headers()` omits cookie headers; use `await request.allHeaders()` to confirm a session cookie was sent, but log only whether it was present, never its value.

**Why:** A successful reload alone can be misleading when the app also stores a bearer token in local storage. The test must prove the HttpOnly cookie authenticates the request without exposing its value.

**How to apply:** After sign-in, clear local storage inside the iframe, reload a protected route, then assert `/api/auth/me` succeeds with the session cookie and without an authorization header. Disable traces and screenshots, and remove the disposable account and session after the test.
