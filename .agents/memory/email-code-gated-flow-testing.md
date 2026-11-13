---
name: Testing email-code-gated public flows (atl-dupr-pickleball)
description: How to deterministically e2e-test the verification-code-gated signup/cancel flows without relying on real email delivery
---

The public registration and self-cancel forms only reveal the 6-digit code-entry field when the request-code endpoint responds `sent:true`. Normally that requires a real email send (Resend), which is flaky/non-deterministic for fake `.local` addresses.

**Deterministic bypass:** `issueCode` returns `null` while a code row is still within its ~30s send cooldown, and the request-code endpoint then responds `sent:true` WITHOUT attempting an email. So:
1. Pre-insert (upsert) a verification-code row for the email with `last_sent_at = now()` and a known `code_hash` BEFORE clicking Request/Send Code.
2. Click the button once → cooldown path → `sent:true`, no email, your planted hash stays intact → code field appears.
3. Type the matching plaintext code, submit.

**Why:** avoids depending on external email delivery; makes the e2e test reproducible.

**How to apply:** the code hash is `sha256("<plaintext>:<SESSION_SECRET>")` (pgcrypto not installed — compute in Node). After a SUCCESSFUL register the code row is consumed/deleted, so re-plant before the cancel step. The request-code endpoint is also IP rate-limited (in-memory, ~3/hour) — restart the api-server workflow to reset and run code-gated tests sequentially (same IP).
